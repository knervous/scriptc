//! Blob, a byte ReadableStream, CompressionStream / DecompressionStream and a Response made from a body: the part of
//! the Streams and File APIs a page's code reaches (a PNG codec's `new Response(new Blob([bytes]).stream()
//! .pipeThrough(new DecompressionStream("deflate"))).arrayBuffer()`, and its encoder's CompressionStream twin; gzipped
//! content files: `.pipeThrough(new DecompressionStream("gzip"))`). A stream holds its bytes
//! whole and a transform runs in one step (flate2): what the page does chunk by chunk, natively at once, with the same
//! results. A stream is read once: piping or wrapping it locks it, as a browser's does. `getReader()` locks it too and
//! hands its bytes to a default reader, whose `read()` resolves them as one chunk (a Uint8Array), then
//! `{ done: true }`.
//!
//! A transform of [`OFF_THREAD_BYTES`] or more runs on the host's worker threads (Windows; modules.rs `submit_then`),
//! as a browser's runs off its page: `pipeThrough` returns at once with a stream whose bytes are pending (2.3-9.4 ms of
//! gzip per content file kept the page's thread from its frames). What reads it asynchronously (a reader's `read()`, a
//! Response's body read through [`response_body_bytes`]) settles once the bytes are there, the pending transforms'
//! readers in the order the transforms began, on a later turn, as a browser's would; what reads it synchronously
//! ([`response_body`]) waits for them.

use std::cell::RefCell;
use std::io::{Read, Write};
use std::rc::Rc;

use crate::objects::{self, Value};
use crate::values;

/// `URL.createObjectURL(blob)`'s URLs and the bytes and media type each names, until revoked. Process-wide (a page's blob
/// URL store is its agent's), so the network threads' reads of one (a fetch, an `Audio` element's source, a document's
/// image) find it.
static OBJECT_URLS: std::sync::Mutex<Option<std::collections::HashMap<String, (std::sync::Arc<Vec<u8>>, String)>>> = std::sync::Mutex::new(None);

/// `URL.createObjectURL(blob)`: `blob:<the page's origin>/<uuid>`, naming a copy of the blob's bytes.
pub fn create_object_url(blob: &Blob) -> Result<String, String> {
    let url = format!("blob:{}/{}", crate::modules::page().origin().ascii_serialization(), crate::web::random_uuid()?);
    let bytes = std::sync::Arc::new(blob.bytes.as_ref().clone());
    OBJECT_URLS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(url.clone(), (bytes, blob.kind.clone()));
    Ok(url)
}

/// `URL.revokeObjectURL(url)`: the URL names nothing from now on (a load already reading it keeps its bytes).
pub fn revoke_object_url(url: &str) {
    if let Some(urls) = OBJECT_URLS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        urls.remove(url);
    }
}

/// The bytes and media type a live `blob:` URL names (its fragment ignored, as a fetch of it ignores it).
pub fn object_url(url: &str) -> Option<(std::sync::Arc<Vec<u8>>, String)> {
    let url = url.split('#').next().unwrap_or(url);
    OBJECT_URLS.lock().unwrap_or_else(|e| e.into_inner()).as_ref()?.get(url).cloned()
}

/// The bytes a live `blob:` URL names.
pub fn object_url_bytes(url: &str) -> Option<std::sync::Arc<Vec<u8>>> {
    object_url(url).map(|(bytes, _)| bytes)
}

/// A Blob's bytes and media type; a File's also its name and last modification (ms since the epoch).
pub struct Blob {
    pub bytes: Rc<Vec<u8>>,
    pub kind: String,
    pub file: Option<(String, f64)>,
}

/// A byte stream: its bytes (or the transform making them) until something reads it (a pipe, a Response, a reader),
/// then none. A reader (`getReader()`) is one of these too, holding the stream's bytes until its first read.
pub struct ByteStream {
    bytes: RefCell<Option<BodyBytes>>,
    pub reader: bool,
}

impl ByteStream {
    fn new(bytes: BodyBytes, reader: bool) -> ByteStream {
        ByteStream { bytes: RefCell::new(Some(bytes)), reader }
    }
}

/// A body's bytes: here, or being made by a transform on a worker thread.
pub enum BodyBytes {
    Ready(Vec<u8>),
    Pending(PendingBytes),
}

impl BodyBytes {
    /// The bytes, waiting for a pending transform to end (its error is the stream's).
    pub fn wait(self) -> Result<Vec<u8>, String> {
        match self {
            BodyBytes::Ready(b) => Ok(b),
            BodyBytes::Pending(p) => p.wait(),
        }
    }

    /// `then` with the bytes, on this (the loop's) thread: at once when they are here, else once the transform ended,
    /// after the transforms begun before it have reached theirs. (A Response's body read, modules.rs, once its body
    /// keeps these.)
    #[allow(dead_code)]
    pub fn then(self, then: impl FnOnce(Result<Vec<u8>, String>) + 'static) {
        match self {
            BodyBytes::Ready(b) => then(Ok(b)),
            BodyBytes::Pending(p) => p.then(then),
        }
    }
}

/// Transforms of this many input bytes or more run on a worker thread (smaller ones cost less than the hand-off).
pub const OFF_THREAD_BYTES: usize = 16 << 10;

/// A transform's result, left by its worker thread.
#[derive(Default)]
struct Slot {
    result: std::sync::Mutex<Option<Result<Vec<u8>, String>>>,
    ready: std::sync::Condvar,
}

/// The bytes a transform is making on a worker thread (or made, queued behind ones that are): one consumer takes them
/// ([`BodyBytes::wait`] or [`BodyBytes::then`]); dropped unread, they hold no other reader up.
pub struct PendingBytes {
    id: u64,
    slot: std::sync::Arc<Slot>,
    consumed: bool,
}

thread_local! {
    /// The loop thread's pending transforms in the order they began, and what reads each ([`PendingBytes::then`]):
    /// reads are delivered in this order, as the page's synchronous transforms delivered theirs.
    static PENDING: RefCell<std::collections::VecDeque<Pending>> = const { RefCell::new(std::collections::VecDeque::new()) };
    static NEXT_PENDING: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

struct Pending {
    id: u64,
    slot: std::sync::Arc<Slot>,
    /// The worker has ended (its slot holds the result).
    ended: bool,
    /// What reads it, once it ended and those before it were delivered.
    then: Option<Box<dyn FnOnce(Result<Vec<u8>, String>)>>,
    /// Read synchronously, or dropped unread: nothing to deliver.
    passed: bool,
}

impl PendingBytes {
    fn wait(mut self) -> Result<Vec<u8>, String> {
        self.consumed = true;
        let mut result = self.slot.result.lock().unwrap_or_else(|e| e.into_inner());
        while result.is_none() {
            result = self.slot.ready.wait(result).unwrap_or_else(|e| e.into_inner());
        }
        let r = result.take().unwrap_or_else(|| Err("the stream was already read".into()));
        drop(result);
        pass(self.id);
        r
    }

    fn then(mut self, then: impl FnOnce(Result<Vec<u8>, String>) + 'static) {
        self.consumed = true;
        PENDING.with(|p| {
            if let Some(entry) = p.borrow_mut().iter_mut().find(|e| e.id == self.id) {
                entry.then = Some(Box::new(then));
            }
        });
        deliver();
    }
}

impl Drop for PendingBytes {
    fn drop(&mut self) {
        if !self.consumed {
            pass(self.id);
        }
    }
}

/// Transform `id` needs no delivery (read synchronously, or dropped unread). Nothing is delivered here (a drop may
/// come in the middle of the host's own bookkeeping): with no read of its own, it never held another read up.
fn pass(id: u64) {
    let _ = PENDING.try_with(|p| {
        if let Some(entry) = p.borrow_mut().iter_mut().find(|e| e.id == id) {
            entry.passed = true;
        }
    });
}

/// A new transform in the queue (`ended`: its result is already in `slot`).
fn queue(slot: std::sync::Arc<Slot>, ended: bool) -> PendingBytes {
    let id = NEXT_PENDING.with(|n| {
        n.set(n.get() + 1);
        n.get()
    });
    PENDING.with(|p| p.borrow_mut().push_back(Pending { id, slot: slot.clone(), ended, then: None, passed: false }));
    PendingBytes { id, slot, consumed: false }
}

/// `codec` over `input`: on a worker thread for a large input (Windows), its bytes pending; else here, its bytes ready
/// (queued behind pending ones while there are any, so reads settle in the order the transforms began) or its error.
fn transform_bytes(codec: Codec, input: Vec<u8>) -> Result<BodyBytes, String> {
    #[cfg(windows)]
    if input.len() >= OFF_THREAD_BYTES {
        let slot = std::sync::Arc::new(Slot::default());
        let pending = queue(slot.clone(), false);
        let id = pending.id;
        crate::modules::submit_then(Box::new(move || -> Box<dyn FnOnce() + Send> {
            // A panic in the codec is the stream's error, not the worker's end.
            let result = std::panic::catch_unwind(|| transform(codec, &input)).unwrap_or_else(|_| Err("DecompressionStream: the codec panicked".into()));
            *slot.result.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
            slot.ready.notify_all();
            // On the loop's thread once the pool's completion is settled there: the reads waiting for it.
            Box::new(move || ended(id))
        }));
        return Ok(BodyBytes::Pending(pending));
    }
    let out = transform(codec, &input)?;
    if PENDING.with(|p| p.borrow().is_empty()) {
        return Ok(BodyBytes::Ready(out));
    }
    let slot = std::sync::Arc::new(Slot::default());
    *slot.result.lock().unwrap_or_else(|e| e.into_inner()) = Some(Ok(out));
    Ok(BodyBytes::Pending(queue(slot, true)))
}

/// Transform `id`'s worker ended (on the loop's thread).
fn ended(id: u64) {
    PENDING.with(|p| {
        if let Some(entry) = p.borrow_mut().iter_mut().find(|e| e.id == id) {
            entry.ended = true;
        }
    });
    deliver();
}

/// The reads of the transforms that ended, in the order the transforms began: a read waits for the transforms begun
/// before its own that are still running and have a read of their own; one with no read yet (a body not read so far,
/// or never) holds nothing up, nor one read synchronously or dropped.
fn deliver() {
    loop {
        let next = PENDING.with(|p| {
            let mut p = p.borrow_mut();
            p.retain(|e| !e.passed);
            let at = p.iter().position(|e| e.then.is_some())?;
            if !p[at].ended {
                return None;
            }
            let entry = p.remove(at)?;
            let result = entry.slot.result.lock().unwrap_or_else(|e| e.into_inner()).take();
            Some((entry.then?, result.unwrap_or_else(|| Err("the stream was already read".into()))))
        });
        // Outside the borrow: the read's reaction may begin another transform.
        let Some((then, result)) = next else { return };
        then(result);
    }
}

/// The formats CompressionStream and DecompressionStream take.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Deflate,
    DeflateRaw,
    Gzip,
}

/// A CompressionStream (true) or DecompressionStream (false) of a format.
#[derive(Clone, Copy)]
pub struct Codec {
    pub format: Format,
    pub compress: bool,
}

fn format_of(v: Option<&Value>, ctor: &str) -> Result<Format, String> {
    let text = v.map(objects::to_display).unwrap_or_else(|| "undefined".into());
    Ok(match text.as_str() {
        "deflate" => Format::Deflate,
        "deflate-raw" => Format::DeflateRaw,
        "gzip" => Format::Gzip,
        _ => return Err(format!("Failed to construct '{ctor}': Unsupported compression format: '{text}'")),
    })
}

/// `new Blob(parts, options)`: the parts' bytes in order (typed arrays and ArrayBuffers, strings as UTF-8, other
/// Blobs), and `options.type`.
pub fn construct_blob(args: &[Value]) -> Result<Value, String> {
    let mut bytes = Vec::new();
    if let Some(Value::Object(parts)) = args.first() {
        if !values::is_array(*parts) {
            return Err("Failed to construct 'Blob': The provided value cannot be converted to a sequence.".into());
        }
        for key in values::own_keys(*parts).iter().filter(|k| k.parse::<usize>().is_ok()) {
            match objects::get(*parts, key)? {
                Value::Object(p) => match objects::blob_of(p) {
                    Some(b) => bytes.extend_from_slice(&b.bytes),
                    None => match values::bytes_of(p) {
                        Some((_, b)) => bytes.extend_from_slice(&b),
                        None => bytes.extend_from_slice(objects::to_display(&Value::Object(p)).as_bytes()),
                    },
                },
                other => bytes.extend_from_slice(objects::to_display(&other).as_bytes()),
            }
        }
    }
    let kind = match args.get(1) {
        Some(Value::Object(o)) => match objects::get(*o, "type")? {
            Value::Undefined => String::new(),
            t => objects::to_display(&t).to_ascii_lowercase(),
        },
        _ => String::new(),
    };
    Ok(objects::new_blob(Blob { bytes: Rc::new(bytes), kind, file: None }))
}

pub fn construct_codec(args: &[Value], compress: bool) -> Result<Value, String> {
    let format = format_of(args.first(), if compress { "CompressionStream" } else { "DecompressionStream" })?;
    Ok(objects::new_codec(Codec { format, compress }))
}

pub fn blob_get(b: &Blob, name: &str) -> Option<Value> {
    Some(match name {
        "size" => Value::Number(b.bytes.len() as f64),
        "type" => Value::Str(b.kind.clone()),
        "name" => Value::Str(b.file.as_ref()?.0.clone()),
        "lastModified" => Value::Number(b.file.as_ref()?.1),
        "webkitRelativePath" => Value::Str(b.file.as_ref().map(|_| String::new())?),
        _ => return None,
    })
}

pub fn blob_has_method(name: &str) -> bool {
    matches!(name, "arrayBuffer" | "bytes" | "text" | "stream" | "slice")
}

/// A Blob's reads: arrayBuffer, bytes and text as promises, stream() a fresh stream of its bytes, slice() a Blob.
pub fn blob_call(b: &Blob, name: &str, args: &[Value]) -> Result<Value, String> {
    Ok(match name {
        "arrayBuffer" | "bytes" => resolved(values::new_bytes(values::U8, b.bytes.to_vec())),
        "text" => resolved(Value::Str(String::from_utf8_lossy(&b.bytes).into_owned())),
        "stream" => objects::new_byte_stream(ByteStream::new(BodyBytes::Ready(b.bytes.to_vec()), false)),
        "slice" => {
            let len = b.bytes.len() as f64;
            // Relative indices, as Array.prototype.slice takes them.
            let at = |i: usize, default: f64| match args.get(i) {
                Some(Value::Number(n)) if n.is_finite() => if *n < 0.0 { (len + n.trunc()).max(0.0) } else { n.trunc().min(len) },
                _ => default,
            };
            let (start, end) = (at(0, 0.0) as usize, at(1, len) as usize);
            let kind = args.get(2).map(objects::to_display).unwrap_or_default();
            objects::new_blob(Blob { bytes: Rc::new(b.bytes[start..end.max(start)].to_vec()), kind, file: None })
        }
        _ => return Err(format!("Blob.{name} is not a function")),
    })
}

pub fn stream_get(s: &ByteStream, name: &str) -> Option<Value> {
    if s.reader {
        // A reader's `closed` settles once it has been read to the end; natively the read is one step.
        return None;
    }
    (name == "locked").then(|| Value::Bool(s.bytes.borrow().is_none()))
}

pub fn stream_has_method(s: &ByteStream, name: &str) -> bool {
    if s.reader {
        matches!(name, "read" | "releaseLock" | "cancel")
    } else {
        matches!(name, "pipeThrough" | "getReader")
    }
}

/// A reader's `read()`: the bytes as one chunk, then done.
fn reader_call(s: &ByteStream, name: &str) -> Result<Value, String> {
    match name {
        "read" => match s.bytes.borrow_mut().take() {
            None => Ok(resolved(read_result(None)?)),
            Some(BodyBytes::Ready(b)) => Ok(resolved(read_result(Some(b))?)),
            // A transform still running: the read settles once its bytes are there (its error rejects it, as a
            // browser's errored stream rejects its read).
            Some(BodyBytes::Pending(pending)) => {
                let promise = values::new_promise();
                let Value::Object(r) = promise else { unreachable!() };
                objects::retain(r);
                pending.then(move |bytes| {
                    match bytes.map_err(|m| values::new_error("TypeError", &m)).and_then(|b| read_result(Some(b)).map_err(|m| values::new_error("TypeError", &m))) {
                        Ok(v) => values::settle(r, false, &v),
                        Err(e) => values::settle(r, true, &e),
                    }
                    objects::release(r);
                });
                Ok(promise)
            }
        },
        "cancel" => {
            s.bytes.borrow_mut().take();
            Ok(resolved(Value::Undefined))
        }
        "releaseLock" => Ok(Value::Undefined),
        _ => Err(format!("ReadableStreamDefaultReader.{name} is not a function")),
    }
}

/// A read's `{ value, done }`: the bytes as one chunk, or done (none, or none left).
fn read_result(chunk: Option<Vec<u8>>) -> Result<Value, String> {
    let chunk = chunk.filter(|b| !b.is_empty());
    let result = values::new_object();
    if let Value::Object(r) = result {
        let done = chunk.is_none();
        values::set(r, "value", chunk.map_or(Value::Undefined, |b| values::new_bytes(values::U8, b)))?;
        values::set(r, "done", Value::Bool(done))?;
    }
    Ok(result)
}

/// `stream.pipeThrough(codec)`: the codec's output as a new stream (this one locked), pending while a large input's
/// transform runs on a worker thread. `stream.getReader()`: a reader holding its bytes (this one locked).
pub fn stream_call(s: &ByteStream, name: &str, args: &[Value]) -> Result<Value, String> {
    if s.reader {
        return reader_call(s, name);
    }
    if name == "getReader" {
        let bytes = s.bytes.borrow_mut().take().ok_or("Failed to execute 'getReader' on 'ReadableStream': ReadableStreamDefaultReader constructor can only accept readable streams that are not yet locked to a reader")?;
        return Ok(objects::new_byte_stream(ByteStream::new(bytes, true)));
    }
    if name != "pipeThrough" {
        return Err(format!("ReadableStream.{name} is not a function"));
    }
    let codec = match args.first() {
        Some(Value::Object(c)) => objects::codec_of(*c),
        _ => None,
    }
    .ok_or("Failed to execute 'pipeThrough' on 'ReadableStream': the transform is not a CompressionStream or DecompressionStream")?;
    let bytes = s.bytes.borrow_mut().take().ok_or("Failed to execute 'pipeThrough' on 'ReadableStream': the stream is locked")?;
    // A pipe from a pipe still running waits for it (no caller chains them).
    let out = transform_bytes(codec, bytes.wait()?)?;
    Ok(objects::new_byte_stream(ByteStream::new(out, false)))
}

/// The codec over the whole input: deflate is zlib-wrapped (RFC 1950), deflate-raw bare (RFC 1951), gzip RFC 1952.
fn transform(codec: Codec, input: &[u8]) -> Result<Vec<u8>, String> {
    use flate2::Compression;
    let mut out = Vec::new();
    let failed = |e: std::io::Error| format!("{}: {e}", if codec.compress { "CompressionStream" } else { "DecompressionStream" });
    if codec.compress {
        match codec.format {
            Format::Deflate => {
                let mut enc = flate2::write::ZlibEncoder::new(&mut out, Compression::default());
                enc.write_all(input).and_then(|()| enc.finish().map(|_| ())).map_err(failed)?;
            }
            Format::DeflateRaw => {
                let mut enc = flate2::write::DeflateEncoder::new(&mut out, Compression::default());
                enc.write_all(input).and_then(|()| enc.finish().map(|_| ())).map_err(failed)?;
            }
            Format::Gzip => {
                let mut enc = flate2::write::GzEncoder::new(&mut out, Compression::default());
                enc.write_all(input).and_then(|()| enc.finish().map(|_| ())).map_err(failed)?;
            }
        }
    } else {
        match codec.format {
            Format::Deflate => flate2::read::ZlibDecoder::new(input).read_to_end(&mut out).map_err(failed)?,
            Format::DeflateRaw => flate2::read::DeflateDecoder::new(input).read_to_end(&mut out).map_err(failed)?,
            Format::Gzip => flate2::read::GzDecoder::new(input).read_to_end(&mut out).map_err(failed)?,
        };
    }
    Ok(out)
}

/// `new Response(body)`'s bytes: a stream (locked by it), a Blob, a typed array or ArrayBuffer, a string; none for
/// null or undefined. A stream's transform still running on a worker thread is waited for (a Response that reads its
/// body later takes [`response_body_bytes`] instead).
#[allow(dead_code)]
pub fn response_body(body: Option<&Value>) -> Result<Vec<u8>, String> {
    response_body_bytes(body)?.wait()
}

/// `new Response(body)`'s bytes as [`response_body`] takes them, a stream's pending transform left pending: its body
/// read (`text()`, `arrayBuffer()`, `bytes()`, `json()`) settles once the bytes are there ([`BodyBytes::then`]).
pub fn response_body_bytes(body: Option<&Value>) -> Result<BodyBytes, String> {
    Ok(BodyBytes::Ready(match body {
        None | Some(Value::Undefined | Value::Null) => Vec::new(),
        Some(Value::Object(b)) => {
            if let Some(s) = objects::byte_stream_of(*b).filter(|s| !s.reader) {
                return s.bytes.borrow_mut().take().ok_or_else(|| "Failed to construct 'Response': the body stream is locked".to_string());
            } else if let Some(blob) = objects::blob_of(*b) {
                blob.bytes.to_vec()
            } else if let Some((_, bytes)) = values::bytes_of(*b) {
                bytes
            } else {
                objects::to_display(&Value::Object(*b)).into_bytes()
            }
        }
        Some(other) => objects::to_display(other).into_bytes(),
    }))
}

fn resolved(value: Value) -> Value {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    values::settle(r, false, &value);
    promise
}
