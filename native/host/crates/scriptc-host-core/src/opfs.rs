//! The origin private file system (`navigator.storage.getDirectory()`), as a browser keeps it: a tree of directories
//! and files private to the page, here a directory on disk.
//!
//! - The root: <PREFIX>OPFS_DIR, else an `opfs` directory beside the local storage file (<PREFIX>LOCAL_STORAGE), else
//!   the app's folder's (`%APPDATA%\<app>\opfs`, `~/Library/Application Support/<app>/opfs`).
//! - A name is the page's own (case-sensitive, any characters but `/` and `\`): on disk each byte outside `a-z 0-9 . _
//!   -` is written `%XX`, so names that differ only in case, or that a file system refuses, stay apart.
//! - FileSystemDirectoryHandle: kind, name, getDirectoryHandle / getFileHandle (`{ create }`), removeEntry
//!   (`{ recursive }`), resolve, isSameEntry, remove. FileSystemFileHandle: kind, name, getFile (a File), createWritable
//!   (`{ keepExistingData }`: a FileSystemWritableFileStream whose close() replaces the file at once), isSameEntry,
//!   remove, and off the main thread (a worker's) createSyncAccessHandle (read / write `{ at }`, truncate, getSize,
//!   flush, close; one open per file). StorageManager: getDirectory, estimate, persist, persisted.
//! - Failures reject with the DOMException a browser gives (NotFoundError, TypeMismatchError,
//!   InvalidModificationError, NoModificationAllowedError, InvalidStateError), or a TypeError for a name not allowed.

use std::cell::RefCell;
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Mutex;

use crate::objects::{self, Value};
use crate::values;

/// A file or directory handle: its path from the root (each segment a page name) and its kind.
#[derive(Clone)]
pub struct Handle {
    segments: Vec<String>,
    dir: bool,
}

/// A FileSystemWritableFileStream: the file's new contents until close().
pub struct Writable {
    target: Vec<String>,
    state: RefCell<WritableState>,
}

struct WritableState {
    data: Vec<u8>,
    cursor: usize,
    closed: bool,
}

/// A FileSystemSyncAccessHandle: the open file, until close().
pub struct SyncHandle {
    key: PathBuf,
    file: RefCell<Option<std::fs::File>>,
}

/// The files a sync access handle has open (one per file, process-wide, as a browser locks it).
static SYNC_OPEN: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

/// The root directory on disk.
fn root() -> PathBuf {
    if let Some(dir) = crate::config::var_os("OPFS_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(file) = crate::config::var_os("LOCAL_STORAGE").filter(|f| !f.is_empty())
        && let Some(parent) = Path::new(&file).parent()
    {
        return parent.join("opfs");
    }
    crate::app_dir().unwrap_or_else(std::env::temp_dir).join("opfs")
}

/// A page name as it is written on disk.
fn disk_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for b in name.bytes() {
        if b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    // "." and ".." are not allowed names; a name of dots only is kept off the file system's own meanings.
    if out.bytes().all(|b| b == b'.') {
        out = out.replace('.', "%2E");
    }
    out
}

/// A name read back from disk (None for one this module did not write).
fn page_name(disk: &str) -> Option<String> {
    let mut out = Vec::with_capacity(disk.len());
    let bytes = disk.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn path_of(segments: &[String]) -> PathBuf {
    let mut p = root();
    for s in segments {
        p.push(disk_name(s));
    }
    p
}

fn dom_error(name: &str, message: &str) -> Value {
    values::new_error(name, message)
}

fn settled(result: Result<Value, Value>) -> Value {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    match result {
        Ok(v) => values::settle(r, false, &v),
        Err(e) => values::settle(r, true, &e),
    }
    promise
}

/// A name the page may give an entry.
fn valid_name(name: &str) -> Result<(), Value> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err(values::new_error("TypeError", &format!("Name '{name}' is not allowed.")));
    }
    Ok(())
}

fn option_flag(options: Option<&Value>, key: &str) -> bool {
    match options {
        Some(Value::Object(o)) => matches!(objects::get(*o, key), Ok(Value::Bool(true))),
        _ => false,
    }
}

fn not_found(what: &str) -> Value {
    dom_error("NotFoundError", &format!("A requested file or directory could not be found at the time an operation was processed. ({what})"))
}

fn io_error(e: std::io::Error) -> Value {
    match e.kind() {
        std::io::ErrorKind::NotFound => not_found("gone"),
        _ => dom_error("InvalidStateError", &format!("The file system refused the operation: {e}")),
    }
}

// ── StorageManager ─────────────────────────────────────────────────────

pub fn storage_has_method(name: &str) -> bool {
    matches!(name, "getDirectory" | "estimate" | "persist" | "persisted")
}

/// navigator.storage's methods.
pub fn storage_call(name: &str) -> Result<Value, String> {
    Ok(match name {
        "getDirectory" => settled(
            std::fs::create_dir_all(root()).map(|()| objects::new_fs_handle(Handle { segments: Vec::new(), dir: true })).map_err(io_error),
        ),
        "estimate" => {
            let estimate = values::new_object();
            if let Value::Object(e) = estimate {
                values::set(e, "usage", Value::Number(disk_usage(&root()) as f64))?;
                // What a browser grants an origin on a large disk: a share of it; a fixed generous figure here.
                values::set(e, "quota", Value::Number(10_737_418_240.0))?;
            }
            settled(Ok(estimate))
        }
        // The files are kept until the page removes them.
        "persist" | "persisted" => settled(Ok(Value::Bool(true))),
        _ => return Err(format!("{name} is not a function")),
    })
}

fn disk_usage(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => disk_usage(&e.path()),
            _ => e.metadata().map_or(0, |m| m.len()),
        })
        .sum()
}

// ── handles ────────────────────────────────────────────────────────────

pub fn is_directory(h: &Handle) -> bool {
    h.dir
}

pub fn handle_get(h: &Handle, name: &str) -> Option<Value> {
    Some(match name {
        "kind" => Value::Str(if h.dir { "directory" } else { "file" }.into()),
        "name" => Value::Str(h.segments.last().cloned().unwrap_or_default()),
        _ => return None,
    })
}

pub fn handle_has_method(h: &Handle, name: &str) -> bool {
    match name {
        "isSameEntry" | "remove" => true,
        "getDirectoryHandle" | "getFileHandle" | "removeEntry" | "resolve" => h.dir,
        "getFile" | "createWritable" => !h.dir,
        // A dedicated worker's only (a render thread here), as Chrome exposes it.
        "createSyncAccessHandle" => !h.dir && !crate::render_thread::is_main_thread(),
        _ => false,
    }
}

fn handle_arg(v: Option<&Value>) -> Option<Rc<Handle>> {
    match v {
        Some(Value::Object(r)) => objects::fs_handle_of(*r),
        _ => None,
    }
}

pub fn handle_call(h: &Handle, name: &str, args: &[Value]) -> Result<Value, String> {
    if !handle_has_method(h, name) {
        return Err(format!("{name} is not a function"));
    }
    let arg = args.first().map(objects::to_display).unwrap_or_else(|| "undefined".into());
    Ok(match name {
        "getDirectoryHandle" | "getFileHandle" => settled(child(h, &arg, name == "getDirectoryHandle", option_flag(args.get(1), "create"))),
        "removeEntry" => settled(remove_entry(h, &arg, option_flag(args.get(1), "recursive"))),
        "remove" => settled(remove_self(h, option_flag(args.first(), "recursive"))),
        "isSameEntry" => settled(Ok(Value::Bool(handle_arg(args.first()).is_some_and(|o| o.dir == h.dir && o.segments == h.segments)))),
        "resolve" => settled(Ok(match handle_arg(args.first()) {
            Some(o) if o.segments.starts_with(&h.segments) => {
                let rest: Vec<Value> = o.segments[h.segments.len()..].iter().map(|s| Value::Str(s.clone())).collect();
                values::new_array(&rest)
            }
            _ => Value::Null,
        })),
        "getFile" => settled(get_file(h)),
        "createWritable" => settled(create_writable(h, option_flag(args.first(), "keepExistingData"))),
        "createSyncAccessHandle" => settled(create_sync(h)),
        _ => return Err(format!("{name} is not a function")),
    })
}

fn child(h: &Handle, name: &str, dir: bool, create: bool) -> Result<Value, Value> {
    valid_name(name)?;
    let mut segments = h.segments.clone();
    segments.push(name.to_string());
    let path = path_of(&segments);
    match std::fs::metadata(&path) {
        Ok(m) if m.is_dir() != dir => {
            return Err(dom_error("TypeMismatchError", "The path supplied exists, but was not an entry of requested type."));
        }
        Ok(_) => {}
        Err(_) if !create => return Err(not_found(name)),
        Err(_) => {
            let made = if dir { std::fs::create_dir_all(&path) } else { std::fs::File::create(&path).map(|_| ()) };
            made.map_err(io_error)?;
        }
    }
    Ok(objects::new_fs_handle(Handle { segments, dir }))
}

fn remove_path(path: &Path, recursive: bool) -> Result<(), Value> {
    let meta = std::fs::metadata(path).map_err(|_| not_found("remove"))?;
    if meta.is_dir() {
        let empty = std::fs::read_dir(path).map_err(io_error)?.next().is_none();
        if !empty && !recursive {
            return Err(dom_error("InvalidModificationError", "The object can not be modified in this way."));
        }
        std::fs::remove_dir_all(path).map_err(io_error)
    } else {
        if sync_open(path) {
            return Err(dom_error("NoModificationAllowedError", "An attempt was made to remove a file that is open for synchronous access."));
        }
        std::fs::remove_file(path).map_err(io_error)
    }
}

fn remove_entry(h: &Handle, name: &str, recursive: bool) -> Result<Value, Value> {
    valid_name(name)?;
    let mut segments = h.segments.clone();
    segments.push(name.to_string());
    remove_path(&path_of(&segments), recursive)?;
    Ok(Value::Undefined)
}

fn remove_self(h: &Handle, recursive: bool) -> Result<Value, Value> {
    if h.segments.is_empty() {
        // The root is emptied, never removed itself.
        let root = root();
        for e in std::fs::read_dir(&root).map_err(io_error)?.flatten() {
            remove_path(&e.path(), recursive)?;
        }
        return Ok(Value::Undefined);
    }
    remove_path(&path_of(&h.segments), recursive)?;
    Ok(Value::Undefined)
}

fn get_file(h: &Handle) -> Result<Value, Value> {
    let path = path_of(&h.segments);
    let bytes = std::fs::read(&path).map_err(io_error)?;
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64);
    let name = h.segments.last().cloned().unwrap_or_default();
    Ok(objects::new_blob(crate::streams::Blob { bytes: Rc::new(bytes), kind: String::new(), file: Some((name, modified)) }))
}

fn create_writable(h: &Handle, keep: bool) -> Result<Value, Value> {
    let path = path_of(&h.segments);
    if !path.is_file() {
        return Err(not_found("createWritable"));
    }
    if sync_open(&path) {
        return Err(dom_error("NoModificationAllowedError", "The file is open for synchronous access."));
    }
    let data = if keep { std::fs::read(&path).map_err(io_error)? } else { Vec::new() };
    Ok(objects::new_fs_writable(Writable { target: h.segments.clone(), state: RefCell::new(WritableState { data, cursor: 0, closed: false }) }))
}

fn sync_open(path: &Path) -> bool {
    SYNC_OPEN.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|s| s.contains(path))
}

fn create_sync(h: &Handle) -> Result<Value, Value> {
    let path = path_of(&h.segments);
    {
        let mut open = SYNC_OPEN.lock().unwrap_or_else(|e| e.into_inner());
        let open = open.get_or_insert_with(HashSet::new);
        if open.contains(&path) {
            return Err(dom_error("NoModificationAllowedError", "Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file."));
        }
        if !path.is_file() {
            return Err(not_found("createSyncAccessHandle"));
        }
        open.insert(path.clone());
    }
    match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
        Ok(file) => Ok(objects::new_fs_sync(SyncHandle { key: path, file: RefCell::new(Some(file)) })),
        Err(e) => {
            release_sync(&path);
            Err(io_error(e))
        }
    }
}

fn release_sync(path: &Path) {
    if let Some(open) = SYNC_OPEN.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        open.remove(path);
    }
}

// ── FileSystemWritableFileStream ───────────────────────────────────────

pub fn writable_has_method(name: &str) -> bool {
    matches!(name, "write" | "seek" | "truncate" | "close" | "abort")
}

/// What `write` takes as data: a string (UTF-8), a typed array or ArrayBuffer, a Blob.
fn data_bytes(v: &Value) -> Result<Vec<u8>, Value> {
    match v {
        Value::Str(s) => Ok(s.as_bytes().to_vec()),
        Value::Object(r) => {
            if let Some(b) = objects::blob_of(*r) {
                return Ok(b.bytes.to_vec());
            }
            if let Some((_, b)) = values::bytes_of(*r) {
                return Ok(b);
            }
            Err(values::new_error("TypeError", "Failed to execute 'write' on 'FileSystemWritableFileStream': The provided value is not of type '(ArrayBuffer or ArrayBufferView or Blob or USVString or WriteParams)'."))
        }
        _ => Ok(objects::to_display(v).into_bytes()),
    }
}

fn number_of(v: Value) -> Option<usize> {
    match v {
        Value::Number(n) if n.is_finite() && n >= 0.0 => Some(n as usize),
        _ => None,
    }
}

pub fn writable_call(w: &Writable, name: &str, args: &[Value]) -> Result<Value, String> {
    let result = (|| -> Result<Value, Value> {
        let mut s = w.state.borrow_mut();
        if s.closed {
            return Err(values::new_error("TypeError", &format!("Cannot {name} a closed writable stream")));
        }
        let arg = args.first().cloned().unwrap_or(Value::Undefined);
        // write(params): { type: "write" | "seek" | "truncate", data, position, size }.
        let params = match &arg {
            Value::Object(r) if name == "write" && objects::blob_of(*r).is_none() && values::bytes_of(*r).is_none() => Some(*r),
            _ => None,
        };
        let get = |r: u64, k: &str| objects::get(r, k).unwrap_or(Value::Undefined);
        let (op, data, position, size) = match params {
            Some(r) => (objects::to_display(&get(r, "type")), get(r, "data"), number_of(get(r, "position")), number_of(get(r, "size"))),
            None => match name {
                "seek" => ("seek".to_string(), Value::Undefined, number_of(arg.clone()), None),
                "truncate" => ("truncate".to_string(), Value::Undefined, None, number_of(arg.clone())),
                other => (other.to_string(), arg.clone(), None, None),
            },
        };
        match op.as_str() {
            "write" => {
                if let Some(p) = position {
                    s.cursor = p;
                }
                let bytes = data_bytes(&data)?;
                let at = s.cursor;
                if s.data.len() < at {
                    s.data.resize(at, 0);
                }
                let end = at + bytes.len();
                if s.data.len() < end {
                    s.data.resize(end, 0);
                }
                s.data[at..end].copy_from_slice(&bytes);
                s.cursor = end;
            }
            "seek" => s.cursor = position.ok_or_else(|| values::new_error("SyntaxError", "seek: a position is required"))?,
            "truncate" => {
                let n = size.ok_or_else(|| values::new_error("SyntaxError", "truncate: a size is required"))?;
                s.data.resize(n, 0);
                s.cursor = s.cursor.min(n);
            }
            "close" => {
                s.closed = true;
                // The swap file replaces the target at once (a browser's close() commits the same way).
                let path = path_of(&w.target);
                // Beside it, under a name no page name maps to ("%" not followed by two hex digits).
                let tmp = path.with_file_name(format!("{}%swap", path.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
                std::fs::write(&tmp, &s.data).map_err(io_error)?;
                std::fs::rename(&tmp, &path).map_err(io_error)?;
            }
            "abort" => s.closed = true,
            other => return Err(values::new_error("TypeError", &format!("write: unknown type '{other}'"))),
        }
        Ok(Value::Undefined)
    })();
    Ok(settled(result))
}

// ── FileSystemSyncAccessHandle ─────────────────────────────────────────

pub fn sync_has_method(name: &str) -> bool {
    matches!(name, "read" | "write" | "truncate" | "getSize" | "flush" | "close")
}

pub fn sync_call(h: &SyncHandle, name: &str, args: &[Value]) -> Result<Value, String> {
    let closed = || crate::abi::throw(values::new_error("InvalidStateError", "The access handle was closed"));
    if name == "close" {
        if h.file.borrow_mut().take().is_some() {
            release_sync(&h.key);
        }
        return Ok(Value::Undefined);
    }
    let mut file = h.file.borrow_mut();
    let Some(f) = file.as_mut() else { return Err(closed()) };
    let io = |e: std::io::Error| crate::abi::throw(io_error(e));
    let at = match args.get(1) {
        Some(Value::Object(o)) => number_of(objects::get(*o, "at")?),
        _ => None,
    };
    Ok(match name {
        "getSize" => Value::Number(f.metadata().map_err(io)?.len() as f64),
        "flush" => {
            f.sync_all().map_err(io)?;
            Value::Undefined
        }
        "truncate" => {
            let n = args.first().cloned().and_then(number_of).unwrap_or(0);
            f.set_len(n as u64).map_err(io)?;
            Value::Undefined
        }
        "read" | "write" => {
            let Some(Value::Object(buffer)) = args.first() else {
                return Err(format!("Failed to execute '{name}' on 'FileSystemSyncAccessHandle': parameter 1 is not of type 'ArrayBufferView'."));
            };
            if let Some(p) = at {
                f.seek(SeekFrom::Start(p as u64)).map_err(io)?;
            }
            if name == "write" {
                let bytes = values::bytes_of(*buffer).map(|(_, b)| b).unwrap_or_default();
                f.write_all(&bytes).map_err(io)?;
                Value::Number(bytes.len() as f64)
            } else {
                // Into the program's own array (in place, as the page's read fills its buffer).
                let Some((ptr, len)) = values::bytes_storage(*buffer) else {
                    return Err("FileSystemSyncAccessHandle.read: the buffer is not the program's own typed array".into());
                };
                // SAFETY: the program's storage, len bytes, alive while its host value is (the call's argument).
                let out = unsafe { std::slice::from_raw_parts_mut(ptr, len) };
                let mut read = 0;
                while read < out.len() {
                    match f.read(&mut out[read..]).map_err(io)? {
                        0 => break,
                        n => read += n,
                    }
                }
                Value::Number(read as f64)
            }
        }
        _ => return Err(format!("{name} is not a function")),
    })
}

impl Drop for SyncHandle {
    fn drop(&mut self) {
        if self.file.get_mut().take().is_some() {
            release_sync(&self.key);
        }
    }
}

/// A directory's entries' page names (for a later iteration API; unused names on disk are skipped).
#[allow(dead_code)]
fn entries(h: &Handle) -> Vec<(String, bool)> {
    let Ok(read) = std::fs::read_dir(path_of(&h.segments)) else { return Vec::new() };
    read.flatten()
        .filter_map(|e| Some((page_name(e.file_name().to_str()?)?, e.file_type().ok()?.is_dir())))
        .collect()
}
