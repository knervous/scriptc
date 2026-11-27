//! The host's object table and its JavaScript-facing surface: the global names a page program reads (window,
//! document, console, performance, the timer functions), each object's properties and methods, and function objects
//! for methods read as values (`const log = console.log`). Plain values (objects, arrays, typed arrays, promises)
//! are `Kind::Value` entries whose data lives in values.rs.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use crate::dom::{self, NodeId};
use crate::timers;
use crate::values;

/// A value as the host holds it. `Object` and `Closure` references are borrowed unless the holder retained them.
#[derive(Clone, Debug)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Object(u64),
    Closure(u64),
    /// A compiled value the program handed over by reference (a class instance): opaque here, counted like a closure
    /// (the runtime's closure table holds it), and the same value when it goes back.
    Program(u64),
}

#[derive(Clone)]
enum Kind {
    Window,
    Console,
    Performance,
    Node(NodeId),
    /// A live list of a node's element children (`el.children`).
    Children(NodeId),
    /// A host function: a global (`setTimeout`), or a method read off its receiver.
    Function(Func),
    /// A DOM object that is not a node (dom.rs): a style, a class list, a node list, an event.
    Aux(dom::Aux),
    /// A plain value (values.rs holds its data under this reference).
    Value,
    /// A builtin namespace the program reads as a global: JSON, Object, Array (their statics, values.rs), and the
    /// host's constructors (URL).
    Builtin(&'static str),
    /// A WHATWG URL (`new URL(input, base)`), parsed by the `url` crate as the page's URL is by the browser.
    Url(url::Url),
    /// A fetch() Response (modules.rs: read in full by the network layer; the body is taken once).
    Response(std::rc::Rc<crate::modules::FetchResponse>),
    /// A Response's (or an init's) Headers: names lowercased, in order.
    Headers(std::rc::Rc<Vec<(String, String)>>),
    /// One of the window's plain objects (page.rs: location, navigator, storage, a MediaQueryList, ...).
    Page(crate::page::PageObj),
    /// A ResizeObserver (true) or MutationObserver (false): its index in observers.rs.
    Observer(u32, bool),
    /// A Blob, a byte ReadableStream, a CompressionStream or DecompressionStream (streams.rs).
    Blob(std::rc::Rc<crate::streams::Blob>),
    ByteStream(std::rc::Rc<crate::streams::ByteStream>),
    Codec(crate::streams::Codec),
    /// A URLSearchParams: its name/value pairs, in order.
    SearchParams(std::rc::Rc<RefCell<Vec<(String, String)>>>),
    /// A URL's `searchParams`: a URLSearchParams over that URL object's query (it holds a count on the URL), read
    /// from the query on each call and written back to it when a call changes the pairs.
    UrlParams(u64),
    /// `getComputedStyle(el)`: the element's resolved style (getPropertyValue).
    Computed(NodeId),
    /// An ImageBitmap (a layer's image decode; bitmap.rs): its pixels until `close()`.
    Image(std::rc::Rc<crate::bitmap::Bitmap>),
    /// An OffscreenCanvas (render_thread.rs): a canvas the page handed a render thread, or one the program made.
    Canvas(std::rc::Rc<crate::render_thread::Canvas>),
    /// A MessageChannel (channels.rs): its two ports' objects, held while it lives.
    Channel(u64, u64),
    /// A MessagePort, by its id in channels.rs.
    Port(u32),
    /// A BroadcastChannel, by its id in channels.rs.
    Broadcast(u32),
    /// The origin private file system's handles and streams (opfs.rs).
    FsHandle(std::rc::Rc<crate::opfs::Handle>),
    FsWritable(std::rc::Rc<crate::opfs::Writable>),
    FsSync(std::rc::Rc<crate::opfs::SyncHandle>),
    /// A worker piece's constructor (a `?worker` import's default export; workers.rs), by the piece's name.
    WorkerCtor(std::rc::Rc<str>),
    /// A Worker, by its id on this (its owner's) thread.
    Worker(u32),
    /// An Intl formatter (intl.rs): a NumberFormat, PluralRules or ListFormat.
    Intl(std::rc::Rc<crate::intl::Formatter>),
    /// An AbortController (its signal's state, and the signal's object, held while it lives) and an AbortSignal
    /// (abort.rs).
    AbortController(std::rc::Rc<crate::abort::Signal>, u64),
    AbortSignal(std::rc::Rc<crate::abort::Signal>),
    /// An RTCPeerConnection and an RTCDataChannel, by their ids in rtc.rs.
    #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
    RtcPeer(u32),
    #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
    RtcChannel(u32),
    /// A Web Audio object (audio.rs): an AudioContext, a node, a param, the listener, a buffer.
    #[cfg(all(windows, feature = "audio"))]
    Audio(crate::audio::Handle),
}

thread_local! {
    /// The page objects' references, one each for the page's life (identity: `location === location`).
    static PAGE_OBJECTS: RefCell<HashMap<crate::page::PageObj, u64>> = RefCell::new(HashMap::new());
}

/// The host object for one of the page's objects (a borrowed reference to the one kept for identity).
pub fn page_object(p: crate::page::PageObj) -> Value {
    let r = PAGE_OBJECTS.with(|m| *m.borrow_mut().entry(p).or_insert_with(|| TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Page(p)))));
    Value::Object(r)
}

/// A fresh host object of `kind`: its allocation's count drops when the current operation ends (as a plain value's
/// does), so it lives as long as someone holds it.
fn fresh(kind: Kind) -> u64 {
    let r = TABLE.with(|t| alloc(&mut t.borrow_mut(), kind));
    release_after_return(r);
    r
}

/// A new host object for a Response.
pub fn new_response(r: crate::modules::FetchResponse) -> Value {
    Value::Object(fresh(Kind::Response(std::rc::Rc::new(r))))
}

/// New host objects for streams.rs: a Blob, a byte stream, a codec.
pub fn new_blob(b: crate::streams::Blob) -> Value {
    Value::Object(fresh(Kind::Blob(std::rc::Rc::new(b))))
}
pub fn new_byte_stream(s: crate::streams::ByteStream) -> Value {
    Value::Object(fresh(Kind::ByteStream(std::rc::Rc::new(s))))
}
pub fn new_codec(c: crate::streams::Codec) -> Value {
    Value::Object(fresh(Kind::Codec(c)))
}
pub fn blob_of(r: u64) -> Option<std::rc::Rc<crate::streams::Blob>> {
    match kind_of(r) {
        Some(Kind::Blob(b)) => Some(b),
        _ => None,
    }
}
pub fn byte_stream_of(r: u64) -> Option<std::rc::Rc<crate::streams::ByteStream>> {
    match kind_of(r) {
        Some(Kind::ByteStream(s)) => Some(s),
        _ => None,
    }
}
/// A new host object for an OffscreenCanvas.
pub fn new_canvas(c: crate::render_thread::Canvas) -> Value {
    Value::Object(fresh(Kind::Canvas(std::rc::Rc::new(c))))
}
/// New host objects for opfs.rs: a file or directory handle, a writable stream, a sync access handle.
pub fn new_fs_handle(h: crate::opfs::Handle) -> Value {
    Value::Object(fresh(Kind::FsHandle(std::rc::Rc::new(h))))
}
pub fn new_fs_writable(w: crate::opfs::Writable) -> Value {
    Value::Object(fresh(Kind::FsWritable(std::rc::Rc::new(w))))
}
pub fn new_fs_sync(s: crate::opfs::SyncHandle) -> Value {
    Value::Object(fresh(Kind::FsSync(std::rc::Rc::new(s))))
}
thread_local! {
    /// The worker constructors, one per piece (identity), held for the thread's life.
    static WORKER_CTORS: RefCell<HashMap<String, u64>> = RefCell::new(HashMap::new());
}

/// A worker piece's constructor (workers.rs page_import).
pub fn worker_constructor(name: &str) -> Value {
    let r = WORKER_CTORS.with(|w| {
        *w.borrow_mut().entry(name.to_string()).or_insert_with(|| TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::WorkerCtor(name.into()))))
    });
    Value::Object(r)
}

/// A new Worker object (workers.rs construct).
pub fn new_worker(id: u32) -> Value {
    Value::Object(fresh(Kind::Worker(id)))
}

/// The signal an AbortSignal object is, if it is one (fetch's init.signal).
pub fn abort_signal_of(r: u64) -> Option<std::rc::Rc<crate::abort::Signal>> {
    match kind_of(r) {
        Some(Kind::AbortSignal(s)) => Some(s),
        _ => None,
    }
}

/// A new Web Audio object (audio.rs).
#[cfg(all(windows, feature = "audio"))]
pub fn new_audio(h: crate::audio::Handle) -> Value {
    Value::Object(fresh(Kind::Audio(h)))
}

/// The Web Audio object a reference is, if it is one.
#[cfg(all(windows, feature = "audio"))]
pub fn audio_of(r: u64) -> Option<crate::audio::Handle> {
    match kind_of(r) {
        Some(Kind::Audio(h)) => Some(h),
        _ => None,
    }
}

/// A new RTCDataChannel object (rtc.rs: one per channel, made when it is created or announced).
#[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
pub fn new_rtc_channel(id: u32) -> Value {
    Value::Object(fresh(Kind::RtcChannel(id)))
}

pub fn fs_handle_of(r: u64) -> Option<std::rc::Rc<crate::opfs::Handle>> {
    match kind_of(r) {
        Some(Kind::FsHandle(h)) => Some(h),
        _ => None,
    }
}
pub fn canvas_of(r: u64) -> Option<std::rc::Rc<crate::render_thread::Canvas>> {
    match kind_of(r) {
        Some(Kind::Canvas(c)) => Some(c),
        _ => None,
    }
}
pub fn codec_of(r: u64) -> Option<crate::streams::Codec> {
    match kind_of(r) {
        Some(Kind::Codec(c)) => Some(c),
        _ => None,
    }
}

/// A Headers object's pairs, or a URL's href, when `v` is one (fetch's init and input).
pub fn headers_of(v: &Value) -> Option<std::rc::Rc<Vec<(String, String)>>> {
    match v {
        Value::Object(r) => match kind_of(*r) {
            Some(Kind::Headers(h)) => Some(h),
            _ => None,
        },
        _ => None,
    }
}

pub fn url_href(v: &Value) -> Option<String> {
    match v {
        Value::Object(r) => match kind_of(*r) {
            Some(Kind::Url(u)) => Some(u.to_string()),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Clone)]
enum Func {
    Global(&'static str),
    Method { receiver: u64, name: String },
}

struct Entry {
    rc: u64,
    kind: Kind,
}

#[derive(Default)]
struct Table {
    entries: Vec<Option<Entry>>,
    free: Vec<usize>,
    /// One reference per singleton and per node, for the object's life (identity).
    window: u64,
    console: u64,
    performance: u64,
    globals: HashMap<&'static str, u64>,
    nodes: HashMap<NodeId, u64>,
}

thread_local! {
    static TABLE: RefCell<Table> = RefCell::new(Table::default());
    /// Properties the program set on `window` (a page's expandos, e.g. a debug global): globals from then on.
    static WINDOW_PROPS: RefCell<Vec<(String, Value)>> = const { RefCell::new(Vec::new()) };
}

fn window_prop(name: &str) -> Option<Value> {
    WINDOW_PROPS.with(|p| p.borrow().iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()))
}

fn alloc(t: &mut Table, kind: Kind) -> u64 {
    let entry = Entry { rc: 1, kind };
    match t.free.pop() {
        Some(i) => { t.entries[i] = Some(entry); i as u64 + 1 }
        None => { t.entries.push(Some(entry)); t.entries.len() as u64 }
    }
}

fn kind_of(r: u64) -> Option<Kind> {
    TABLE.with(|t| t.borrow().entries.get((r as usize).wrapping_sub(1))?.as_ref().map(|e| e.kind.clone()))
}

pub fn retain(r: u64) {
    TABLE.with(|t| {
        if let Some(Some(e)) = t.borrow_mut().entries.get_mut((r as usize).wrapping_sub(1)) {
            e.rc += 1;
        }
    })
}

pub fn release(r: u64) {
    let freed = TABLE.with(|t| {
        let mut t = t.borrow_mut();
        let i = (r as usize).wrapping_sub(1);
        let Some(Some(e)) = t.entries.get_mut(i) else { return None };
        e.rc -= 1;
        if e.rc > 0 {
            return None;
        }
        let kind = t.entries[i].take().map(|e| e.kind);
        t.free.push(i);
        if let Some(Kind::Node(n)) = &kind {
            t.nodes.remove(n);
        }
        kind
    });
    if freed.is_some() {
        crate::abi::object_disposed(r);
    }
    match freed {
        // A method function holds its receiver.
        Some(Kind::Function(Func::Method { receiver, .. })) => release(receiver),
        Some(Kind::UrlParams(url)) => release(url),
        Some(Kind::Aux(a)) => dom::aux_freed(&a),
        Some(Kind::Value) => values::free(r),
        Some(Kind::Channel(a, b)) => {
            release(a);
            release(b);
        }
        Some(Kind::Port(id)) => crate::channels::port_freed(id),
        Some(Kind::Worker(id)) => crate::workers::worker_freed(id),
        Some(Kind::Broadcast(id)) => crate::channels::broadcast_freed(id),
        Some(Kind::AbortController(_, signal)) => release(signal),
        Some(Kind::AbortSignal(s)) => s.freed(),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Some(Kind::RtcPeer(id)) => crate::rtc::peer_freed(id),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Some(Kind::RtcChannel(id)) => crate::rtc::channel_freed(id),
        #[cfg(all(windows, feature = "audio"))]
        Some(Kind::Audio(h)) => crate::audio::freed(h),
        _ => {}
    }
}

/// A fresh plain value's reference (its data is the caller's to store in values.rs); the allocation count is the
/// current operation's, dropped once its result is out.
pub fn alloc_value() -> u64 {
    let r = TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Value));
    release_after_return(r);
    r
}

pub fn is_value(r: u64) -> bool {
    matches!(kind_of(r), Some(Kind::Value))
}

/// A singleton's reference, made on first use and held by the table (so it is never freed).
fn singleton(pick: fn(&mut Table) -> &mut u64, kind: Kind) -> u64 {
    TABLE.with(|t| {
        let mut t = t.borrow_mut();
        if *pick(&mut t) == 0 {
            let r = alloc(&mut t, kind);
            *pick(&mut t) = r;
        }
        *pick(&mut t)
    })
}

/// A host function global (render_thread.rs's hooks), as a value.
pub fn global_function_value(name: &'static str) -> Value {
    Value::Object(global_function(name))
}

fn global_function(name: &'static str) -> u64 {
    TABLE.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(r) = t.globals.get(name) {
            return *r;
        }
        let r = alloc(&mut t, Kind::Function(Func::Global(name)));
        t.globals.insert(name, r);
        r
    })
}

/// A builtin namespace's one reference (held by the table, like the singletons).
fn builtin(name: &'static str) -> u64 {
    TABLE.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(r) = t.globals.get(name) {
            return *r;
        }
        let r = alloc(&mut t, Kind::Builtin(name));
        t.globals.insert(name, r);
        r
    })
}

/// The one reference for a node (identity), made on first use. The table's own count is the node's.
/// The node a host object is, if it is one.
pub fn node_of(r: u64) -> Option<NodeId> {
    match kind_of(r) {
        Some(Kind::Node(n)) => Some(n),
        _ => None,
    }
}

pub fn node_ref(n: NodeId) -> u64 {
    TABLE.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(r) = t.nodes.get(&n) {
            return *r;
        }
        let r = alloc(&mut t, Kind::Node(n));
        t.nodes.insert(n, r);
        r
    })
}

pub fn node_id(r: u64) -> Option<NodeId> {
    match kind_of(r) {
        Some(Kind::Node(n)) => Some(n),
        _ => None,
    }
}

const GLOBAL_FUNCTIONS: &[&str] = &["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask", "fetch", "parseInt", "parseFloat", "atob", "btoa", "matchMedia", "getComputedStyle", "requestIdleCallback", "cancelIdleCallback", "scrollTo", "scroll", "scrollBy"];

/// An IdleDeadline's timeRemaining (requestIdleCallback's deadline object): a host function, not a global.
const IDLE_TIME_REMAINING: &str = "IdleDeadline.timeRemaining";

/// The longest idle period a browser grants an idle callback (the spec's 50 ms).
const IDLE_PERIOD_MS: f64 = 50.0;

pub fn global(name: &str) -> Result<Value, String> {
    // Off the main thread (a render thread, as the web's worker): the page hooks (render_thread.rs), and a worker's scope, so no
    // window, document or AppKit is ever made there.
    let off_main = !crate::render_thread::is_main_thread();
    // A worker's scope (workers.rs): its handler and functions read bare (`onmessage`, `postMessage(...)`).
    if crate::workers::in_worker() {
        if let Some(v) = crate::workers::scope_get(name) {
            return Ok(v);
        }
        if crate::workers::SCOPE_METHODS.contains(&name) {
            let scope = singleton(|t| &mut t.window, Kind::Window);
            retain(scope);
            let f = TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Function(Func::Method { receiver: scope, name: name.to_string() })));
            release_after_return(f);
            return Ok(Value::Object(f));
        }
    } else if let Some(v) = crate::layer::get().global(name) {
        return Ok(v);
    }
    if off_main {
        crate::render_thread::trace_global(name);
        if crate::render_thread::hides(name) {
            return Err(format!("{name} is not defined"));
        }
    }
    if let Some(v) = window_prop(name) {
        return Ok(v);
    }
    if let Some(p) = crate::page::window_object(name).filter(|_| !off_main || matches!(name, "location" | "navigator" | "crypto")) {
        return Ok(page_object(p));
    }
    // The window's own numbers read bare (`innerWidth`), as on the page; a worker has only its scope's
    // (WorkerGlobalScope's crossOriginIsolated, isSecureContext, origin).
    if let Some(v) = crate::page::window_get(name).filter(|_| !off_main || matches!(name, "crossOriginIsolated" | "isSecureContext" | "origin")) {
        return Ok(v);
    }
    Ok(match name {
        "window" | "globalThis" | "self" => Value::Object(singleton(|t| &mut t.window, Kind::Window)),
        // The document is Blitz's root node (one reference, as every node).
        "document" => Value::Object(node_ref(dom::document())),
        "console" => Value::Object(singleton(|t| &mut t.console, Kind::Console)),
        "performance" => Value::Object(singleton(|t| &mut t.performance, Kind::Performance)),
        "JSON" => Value::Object(builtin("JSON")),
        "Object" => Value::Object(builtin("Object")),
        "Array" => Value::Object(builtin("Array")),
        "URL" => Value::Object(builtin("URL")),
        "Uint8Array" => Value::Object(builtin("Uint8Array")),
        "Int8Array" => Value::Object(builtin("Int8Array")),
        "Uint8ClampedArray" => Value::Object(builtin("Uint8ClampedArray")),
        "Uint16Array" => Value::Object(builtin("Uint16Array")),
        "Int16Array" => Value::Object(builtin("Int16Array")),
        "Uint32Array" => Value::Object(builtin("Uint32Array")),
        "Int32Array" => Value::Object(builtin("Int32Array")),
        "Float32Array" => Value::Object(builtin("Float32Array")),
        "Float64Array" => Value::Object(builtin("Float64Array")),
        "ArrayBuffer" => Value::Object(builtin("ArrayBuffer")),
        "ResizeObserver" => Value::Object(builtin("ResizeObserver")),
        "MutationObserver" => Value::Object(builtin("MutationObserver")),
        "URLSearchParams" => Value::Object(builtin("URLSearchParams")),
        // ECMA-402's formatters (intl.rs).
        "Intl" => Value::Object(builtin("Intl")),
        "Blob" => Value::Object(builtin("Blob")),
        "Response" => Value::Object(builtin("Response")),
        "CompressionStream" => Value::Object(builtin("CompressionStream")),
        "DecompressionStream" => Value::Object(builtin("DecompressionStream")),
        "OffscreenCanvas" => Value::Object(builtin("OffscreenCanvas")),
        // A window's and a worker's both (channels.rs).
        "MessageChannel" => Value::Object(builtin("MessageChannel")),
        // The DOMException interface (an Error of a DOM name: instanceof and the constructor).
        "DOMException" => Value::Object(builtin("DOMException")),
        // The native error constructors (instanceof and `new`): the host's own errors (a rejected fetch's TypeError, a
        // DOMException) are these, so a page tests them as it does in a browser.
        n if ERROR_CTORS.contains(&n) => Value::Object(builtin(ERROR_CTORS.iter().copied().find(|c| *c == n).expect("an error constructor"))),
        // The Gamepad API's event interface (the window's).
        "GamepadEvent" if !off_main => Value::Object(builtin("GamepadEvent")),
        "BroadcastChannel" => Value::Object(builtin("BroadcastChannel")),
        // abort.rs.
        "AbortController" => Value::Object(builtin("AbortController")),
        "AbortSignal" => Value::Object(builtin("AbortSignal")),
        // WebRTC's data channels (rtc.rs).
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        "RTCPeerConnection" => Value::Object(builtin("RTCPeerConnection")),
        // Web Audio (audio.rs): the page's main thread, once an output engine could be made.
        #[cfg(all(windows, feature = "audio"))]
        "AudioContext" if !off_main && crate::audio::available() => Value::Object(builtin("AudioContext")),
        // HTMLAudioElement's constructor (`new Audio()`; audio.rs), on the same output.
        #[cfg(all(windows, feature = "audio"))]
        "Audio" if !off_main && crate::audio::available() => Value::Object(builtin("Audio")),
        // Hidden unless SCRIPTC_HOST_WORKER_GLOBAL=1 and this executable has worker pieces to run (workers.rs), on
        // every platform: with it defined, a page's decoder that checks `typeof Worker === 'undefined'` leaves its
        // main-thread path for a real worker that may not run it (a dynamic island limit: "an 'unknown' value holding
        // a runtime handle cannot enter dynamically-executed code", "setting 'log' on a dynamic console is not
        // supported yet"). The `?worker` imports
        // (workers.rs page_import) do not need the global, and the one-thread build (no worker pieces) never had it.
        "Worker" if crate::workers::any() && std::env::var_os("SCRIPTC_HOST_WORKER_GLOBAL").is_some() => Value::Object(builtin("Worker")),
        // The DOM's interface objects (instanceof targets, as a browser's window members).
        _ if dom::INTERFACES.contains(&name) => Value::Object(builtin(dom::INTERFACES.iter().find(|i| **i == name).copied().unwrap())),
        _ => match GLOBAL_FUNCTIONS.iter().find(|g| **g == name) {
            Some(g) => Value::Object(global_function(g)),
            // The window's own methods read bare (`addEventListener(...)`), bound to the window.
            None if !off_main && (dom::window_has_method(name) || crate::page::is_window_method(name)) => {
                let window = singleton(|t| &mut t.window, Kind::Window);
                retain(window);
                let f = TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Function(Func::Method { receiver: window, name: name.to_string() })));
                release_after_return(f);
                Value::Object(f)
            }
            None => {
                unanswered(&format!("global {name}"));
                return Err(format!("{name} is not defined"));
            }
        },
    })
}

pub fn get(obj: u64, name: &str) -> Result<Value, String> {
    let kind = kind_of(obj).ok_or_else(|| format!("a released host object (reading {name})"))?;
    let property = match &kind {
        // A render thread's global object reads as a worker's (global's filter), the page's members not among them.
        Kind::Window if crate::workers::in_worker() && crate::workers::scope_get(name).is_some() => crate::workers::scope_get(name),
        Kind::Window if !crate::render_thread::is_main_thread() => global(name).ok(),
        Kind::Window => crate::page::window_get(name).or_else(|| global(name).ok()),
        Kind::Page(p) => crate::page::get(*p, name),
        Kind::Performance => None,
        Kind::Console => None,
        Kind::Node(n) => dom::get(*n, name)?,
        Kind::Aux(a) => dom::aux_get(a, name)?,
        Kind::Children(n) => {
            let children = dom::element_children(*n);
            if name == "length" {
                Some(Value::Number(children.len() as f64))
            } else {
                name.parse::<usize>().ok().map(|i| children.get(i).map_or(Value::Undefined, |c| Value::Object(node_ref(*c))))
            }
        }
        Kind::Function(_) => match name {
            "name" => Some(Value::Str(String::new())),
            _ => None,
        },
        Kind::Value => values::get(obj, name)?,
        // Intl's constructors (`Intl.PluralRules`).
        Kind::Builtin("Intl") => crate::intl::namespace_get(name).map(|ctor| Value::Object(builtin(ctor))),
        Kind::Intl(_) => None,
        // Node's constants on the DOM's interface objects (`Node.TEXT_NODE`).
        Kind::Builtin(interface) => dom::node_constant(interface, name).map(Value::Number),
        // A view over this URL's query, holding the URL (a fresh view per read: the pairs live in the URL).
        Kind::Url(_) if name == "searchParams" => {
            retain(obj);
            Some(Value::Object(fresh(Kind::UrlParams(obj))))
        }
        Kind::Url(u) => url_get(u, name)?,
        Kind::Response(r) => match name {
            "headers" => Some(Value::Object(fresh(Kind::Headers(r.headers.clone())))),
            _ => crate::modules::response_get(r, name),
        },
        Kind::Headers(_) => None,
        Kind::Blob(b) => crate::streams::blob_get(b, name),
        Kind::ByteStream(s) => crate::streams::stream_get(s, name),
        Kind::Codec(_) => None,
        Kind::Canvas(c) => crate::render_thread::canvas_get(c, name),
        Kind::Channel(a, b) => match name {
            "port1" => Some(Value::Object(*a)),
            "port2" => Some(Value::Object(*b)),
            _ => None,
        },
        Kind::Port(id) => crate::channels::port_get(*id, name),
        Kind::Broadcast(id) => crate::channels::broadcast_get(*id, name),
        Kind::FsHandle(h) => crate::opfs::handle_get(h, name),
        Kind::FsWritable(_) | Kind::FsSync(_) | Kind::WorkerCtor(_) => None,
        Kind::Worker(id) => crate::workers::worker_get(*id, name),
        Kind::AbortController(_, signal) => (name == "signal").then_some(Value::Object(*signal)),
        Kind::AbortSignal(s) => crate::abort::signal_get(s, name),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcPeer(id) => crate::rtc::peer_get(*id, name),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcChannel(id) => crate::rtc::channel_get(*id, name),
        #[cfg(all(windows, feature = "audio"))]
        Kind::Audio(h) => crate::audio::get(*h, name)?,
        // An observer has methods only.
        Kind::Observer(..) => None,
        Kind::SearchParams(p) => (name == "size").then(|| Value::Number(p.borrow().len() as f64)),
        Kind::UrlParams(url) => (name == "size").then(|| Value::Number(url_pairs(*url).len() as f64)),
        // A property read by name (`style.visibility`, `style.backgroundColor`): the resolved value of its kebab-case
        // property, as getPropertyValue answers it (`cssFloat` is `float`).
        Kind::Computed(n) if name != "getPropertyValue" => Some(Value::Str(dom::resolved_style(*n, &css_property_name(name)))),
        Kind::Computed(_) => None,
        // Its size, 0 once closed.
        Kind::Image(b) => {
            let size = b.borrow().as_ref().map_or((0, 0), |p| (p.width, p.height));
            match name {
                "width" => Some(Value::Number(f64::from(size.0))),
                "height" => Some(Value::Number(f64::from(size.1))),
                _ => None,
            }
        }
    };
    if let Some(v) = property {
        return Ok(v);
    }
    // A method read as a value: a function bound to its receiver.
    if has_method(&kind, name) || (matches!(kind, Kind::Value) && values::has_method(obj, name)) {
        retain(obj);
        let f = TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Function(Func::Method { receiver: obj, name: name.to_string() })));
        // The new function's only count is the caller's: hand it over without another retain.
        let v = Value::Object(f);
        release_after_return(f);
        return Ok(v);
    }
    trace_undefined(&kind, name);
    Ok(Value::Undefined)
}

/// A CSSStyleDeclaration member's property name: camelCase to kebab-case (`webkitTransform` to `-webkit-transform`).
fn css_property_name(name: &str) -> String {
    if name == "cssFloat" {
        return "float".into();
    }
    let mut out = String::with_capacity(name.len() + 4);
    if name.starts_with("webkit") || name.starts_with("moz") {
        out.push('-');
    }
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// SCRIPTC_HOST_TRACE_UNDEFINED=1 (or SCRIPTC_HOST_TRACE_UNANSWERED=1): each member a host object (not a plain value)
/// answers undefined, once per kind and name, on stderr. A compiled `expected number, got undefined` does not say what
/// it read; this names the candidates.
fn trace_undefined(kind: &Kind, name: &str) {
    if matches!(kind, Kind::Value) {
        return;
    }
    unanswered(&format!("property {}.{name}", kind_label(kind)));
}

/// A host object's kind as the call trace names it (abi.rs `calls`; SCRIPTC_HOST_TRACE_CALLS only).
pub fn trace_label(r: u64) -> String {
    match kind_of(r) {
        Some(Kind::Value) => match values::trace_kind(r) {
            Some(k) => k.to_string(),
            None => "value".to_string(),
        },
        Some(k) => kind_label(&k),
        None => "released".to_string(),
    }
}

/// A host object's kind as the unanswered trace names it.
fn kind_label(kind: &Kind) -> String {
    match kind {
        Kind::Value => "value".to_string(),
        Kind::Window => "window".to_string(),
        Kind::Console => "console".to_string(),
        Kind::Performance => "performance".to_string(),
        Kind::Node(n) => format!("node <{}>", dom::tag_of(*n).unwrap_or_default()),
        Kind::Children(_) => "children".to_string(),
        Kind::Function(Func::Global(g)) => format!("function {g}"),
        Kind::Function(Func::Method { name, .. }) => format!("function {name}"),
        Kind::Aux(dom::Aux::ClassList(_)) => "DOMTokenList".to_string(),
        Kind::Aux(a) => dom::aux_display(a).trim_start_matches("[object ").trim_end_matches(']').to_string(),
        Kind::Builtin(b) => format!("builtin {b}"),
        Kind::Url(_) => "URL".to_string(),
        Kind::Response(_) => "Response".to_string(),
        Kind::Blob(_) => "Blob".to_string(),
        Kind::ByteStream(s) => if s.reader { "ReadableStreamDefaultReader" } else { "ReadableStream" }.to_string(),
        Kind::Codec(c) => if c.compress { "CompressionStream" } else { "DecompressionStream" }.to_string(),
        Kind::Headers(_) => "Headers".to_string(),
        Kind::Page(p) => format!("page {p:?}"),
        Kind::Observer(..) => "observer".to_string(),
        Kind::SearchParams(_) | Kind::UrlParams(_) => "URLSearchParams".to_string(),
        Kind::Computed(_) => "computed style".to_string(),
        Kind::Image(_) => "ImageBitmap".to_string(),
        Kind::Canvas(_) => "OffscreenCanvas".to_string(),
        Kind::Channel(..) => "MessageChannel".to_string(),
        Kind::Port(_) => "MessagePort".to_string(),
        Kind::Broadcast(_) => "BroadcastChannel".to_string(),
        Kind::FsHandle(_) => "FileSystemHandle".to_string(),
        Kind::FsWritable(_) => "FileSystemWritableFileStream".to_string(),
        Kind::FsSync(_) => "FileSystemSyncAccessHandle".to_string(),
        Kind::WorkerCtor(n) => format!("worker constructor {n}"),
        Kind::Worker(_) => "Worker".to_string(),
        Kind::Intl(_) => "Intl formatter".to_string(),
        Kind::AbortController(..) => "AbortController".to_string(),
        Kind::AbortSignal(_) => "AbortSignal".to_string(),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcPeer(_) => "RTCPeerConnection".to_string(),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcChannel(_) => "RTCDataChannel".to_string(),
        #[cfg(all(windows, feature = "audio"))]
        Kind::Audio(h) => crate::audio::interface(*h).to_string(),
    }
}

/// SCRIPTC_HOST_TRACE_UNANSWERED=1 (SCRIPTC_HOST_TRACE_UNDEFINED=1 too): what the program asked of the host that it
/// did not answer (an absent global, a host object's property read as undefined, a method it has not, a constructor it
/// does not make), once per thread kind and item, process-wide, on stderr.
pub fn unanswered(what: &str) {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let on = *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE_UNANSWERED").is_some() || std::env::var_os("SCRIPTC_HOST_TRACE_UNDEFINED").is_some());
    if !on {
        return;
    }
    static SEEN: std::sync::Mutex<Option<std::collections::HashSet<String>>> = std::sync::Mutex::new(None);
    let thread = if crate::render_thread::is_main_thread() { "main" } else { "render" };
    let key = format!("[{thread}] {what}");
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    if seen.get_or_insert_with(Default::default).insert(key.clone()) {
        eprintln!("scriptc-host: unanswered {key}");
    }
}

/// A fresh object handed out as a result carries one count from its allocation; the result conversion adds the
/// receiver's own, so the allocation count is dropped once the result is out.
fn release_after_return(r: u64) {
    release_value_after_return(Value::Object(r));
}

/// A count the current operation hands over with its result (a fresh object's allocation, an element popped off an
/// array), dropped once the result is out.
pub fn release_value_after_return(v: Value) {
    PENDING_RELEASE.with(|p| p.borrow_mut().push((DEPTH.get(), v)));
}

thread_local! {
    /// Counts to drop, each tagged with the depth of the operation that made it.
    static PENDING_RELEASE: RefCell<Vec<(u32, Value)>> = const { RefCell::new(Vec::new()) };
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// One host operation (a vtable call, a loop turn). Operations nest when a callback the host runs calls back into
/// the host; each drops only the counts made at its depth or deeper, when it ends (after its result is converted).
pub struct Op(());

impl Op {
    pub fn enter() -> Op {
        DEPTH.set(DEPTH.get() + 1);
        Op(())
    }
}

impl Drop for Op {
    fn drop(&mut self) {
        settle();
        DEPTH.set(DEPTH.get() - 1);
    }
}

/// Drops the counts the current operation (and any it ran) handed over.
pub fn settle() {
    let depth = DEPTH.get();
    let pending: Vec<Value> = PENDING_RELEASE.with(|p| {
        let mut p = p.borrow_mut();
        let keep = p.iter().position(|(d, _)| *d >= depth).unwrap_or(p.len());
        p.drain(keep..).map(|(_, v)| v).collect()
    });
    for v in pending {
        values::release_value(v);
    }
}

fn has_method(kind: &Kind, name: &str) -> bool {
    match kind {
        Kind::Console => matches!(name, "log" | "info" | "warn" | "error" | "debug"),
        Kind::Performance => name == "now",
        Kind::Node(n) => dom::has_method(*n, name),
        Kind::Aux(a) => dom::aux_has_method(a, name),
        // A render thread's global scope is a worker's: none of the window's own functions.
        Kind::Window if crate::workers::in_worker() && crate::workers::SCOPE_METHODS.contains(&name) => true,
        Kind::Window if !crate::render_thread::is_main_thread() && crate::render_thread::hides(name) => false,
        Kind::Window => GLOBAL_FUNCTIONS.contains(&name) || dom::window_has_method(name) || crate::page::is_window_method(name),
        Kind::Page(p) => crate::page::has_method(*p, name),
        Kind::Observer(_, resize) => crate::observers::has_method(*resize, name),
        Kind::Computed(_) => name == "getPropertyValue",
        Kind::SearchParams(_) | Kind::UrlParams(_) => matches!(name, "get" | "getAll" | "has" | "set" | "append" | "delete" | "sort" | "forEach" | "toString" | "keys" | "values" | "entries"),
        Kind::Builtin("JSON") => matches!(name, "stringify" | "parse"),
        Kind::Builtin("Object") => matches!(name, "keys" | "values" | "entries" | "assign" | "freeze" | "seal" | "preventExtensions" | "hasOwn"),
        Kind::Builtin("Array") => matches!(name, "isArray" | "of" | "from"),
        Kind::Builtin("URL") => matches!(name, "canParse" | "createObjectURL" | "revokeObjectURL"),
        Kind::Intl(f) => crate::intl::has_method(f, name),
        Kind::Url(_) => matches!(name, "toString" | "toJSON"),
        Kind::Response(_) => matches!(name, "text" | "json" | "arrayBuffer" | "bytes"),
        Kind::Blob(_) => crate::streams::blob_has_method(name),
        Kind::ByteStream(s) => crate::streams::stream_has_method(s, name),
        Kind::Headers(_) => matches!(name, "get" | "has"),
        Kind::Image(_) => name == "close",
        Kind::Canvas(_) => name == "getContext",
        Kind::Port(_) => crate::channels::PORT_METHODS.contains(&name),
        Kind::Broadcast(_) => crate::channels::BROADCAST_METHODS.contains(&name),
        Kind::FsHandle(h) => crate::opfs::handle_has_method(h, name),
        Kind::FsWritable(_) => crate::opfs::writable_has_method(name),
        Kind::FsSync(_) => crate::opfs::sync_has_method(name),
        Kind::Worker(_) => crate::workers::WORKER_METHODS.contains(&name),
        Kind::AbortController(..) => name == "abort",
        Kind::AbortSignal(_) => crate::abort::SIGNAL_METHODS.contains(&name),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcPeer(_) => crate::rtc::PEER_METHODS.contains(&name),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcChannel(_) => crate::rtc::CHANNEL_METHODS.contains(&name),
        #[cfg(all(windows, feature = "audio"))]
        Kind::Audio(h) => crate::audio::has_method(*h, name),
        _ => false,
    }
}

pub fn set(obj: u64, name: &str, value: Value) -> Result<(), String> {
    match kind_of(obj).ok_or_else(|| format!("a released host object (setting {name})"))? {
        Kind::Node(n) => dom::set(n, name, value),
        Kind::Aux(a) => dom::aux_set(&a, name, value),
        Kind::Value => values::set(obj, name, value),
        Kind::Url(_) => url_set(obj, name, &value),
        Kind::Canvas(c) => crate::render_thread::canvas_set(&c, name, &value),
        Kind::Port(id) => crate::channels::port_set(id, name, &value),
        Kind::Broadcast(id) => crate::channels::broadcast_set(id, name, &value),
        Kind::Worker(id) => crate::workers::worker_set(id, name, &value),
        Kind::AbortSignal(s) => crate::abort::signal_set(&s, name, &value),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcPeer(id) => crate::rtc::peer_set(id, name, &value),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcChannel(id) => crate::rtc::channel_set(id, name, &value),
        #[cfg(all(windows, feature = "audio"))]
        Kind::Audio(h) => crate::audio::set(h, name, &value),
        // A worker's scope takes its handlers (`self.onmessage = ...`).
        Kind::Window if crate::workers::in_worker() && crate::workers::scope_set(name, &value) => Ok(()),
        // A page's window takes any property (the host's own globals stay what they are underneath).
        Kind::Window => {
            values::retain_value(&value);
            let old = WINDOW_PROPS.with(|p| {
                let mut p = p.borrow_mut();
                match p.iter_mut().find(|(k, _)| k == name) {
                    Some((_, old)) => Some(std::mem::replace(old, value)),
                    None => {
                        p.push((name.into(), value));
                        None
                    }
                }
            });
            if let Some(old) = old {
                values::release_value(old);
            }
            Ok(())
        }
        _ => Err(format!("cannot set '{name}' on this host object")),
    }
}

pub fn call(f: u64, this: Option<u64>, args: &[Value]) -> Result<Value, String> {
    match kind_of(f).ok_or("a released host object")? {
        Kind::Function(Func::Global(name)) => call_global(name, args),
        // On `this` when given, except a plain object carrying this very function as its member (a structural copy
        // of the receiver the program made: `const scope: { postMessage(...) } = self`), which means the receiver.
        Kind::Function(Func::Method { receiver, name }) => {
            let target = match this {
                Some(t) if is_value(t) && matches!(values::get(t, &name), Ok(Some(Value::Object(g))) if g == f) => receiver,
                Some(t) => t,
                None => receiver,
            };
            call_method(target, &name, args)
        }
        _ => Err("not a function".into()),
    }
}

fn call_global(name: &str, args: &[Value]) -> Result<Value, String> {
    let delay = |i: usize| match args.get(i) { Some(Value::Number(n)) if n.is_finite() && *n > 0.0 => *n, _ => 0.0 };
    let callback = || match args.first() { Some(Value::Closure(c)) => Ok(*c), _ => Err(format!("{name}: the callback is not a function")) };
    let id = || match args.first() { Some(Value::Number(n)) => *n as u64, _ => 0 };
    Ok(match name {
        _ if crate::layer::get().global_function(name) => return crate::layer::get().call_global(name, args),
        // An idle callback (the window's, not a worker's): a task once the loop is idle, handed an IdleDeadline whose
        // timeRemaining is the time left before the window's next frame (at most the spec's 50 ms).
        "requestIdleCallback" => {
            let deadline = values::new_object();
            if let Value::Object(d) = deadline {
                values::set(d, "didTimeout", Value::Bool(false))?;
                values::set(d, "timeRemaining", Value::Object(global_function(IDLE_TIME_REMAINING)))?;
            }
            Value::Number(timers::add(callback()?, 0.0, false, vec![deadline]) as f64)
        }
        "cancelIdleCallback" => { timers::cancel(id()); Value::Undefined }
        IDLE_TIME_REMAINING => Value::Number(crate::window::frame_wait_ms().unwrap_or(IDLE_PERIOD_MS).clamp(0.0, IDLE_PERIOD_MS)),
        "fetch" => crate::modules::fetch_global(args),
        // window.scrollTo(x, y) / scroll / scrollBy, or with `{ left, top }`: the viewport's scroll, clamped to the page
        // (the About and Legal pages open at their top; it used to throw "scrollTo is not a function").
        "scrollTo" | "scroll" | "scrollBy" => {
            let by = name == "scrollBy";
            let num = |v: Option<Value>| match v { Some(Value::Number(n)) if n.is_finite() => Some(n), _ => None };
            let (x, y) = match args.first() {
                Some(Value::Object(r)) => (num(crate::values::get(*r, "left")?), num(crate::values::get(*r, "top")?)),
                first => (num(first.cloned()), num(args.get(1).cloned())),
            };
            let at = crate::dom::viewport_scroll();
            let (dx, dy) = if by { (x.unwrap_or(0.0), y.unwrap_or(0.0)) } else { (x.map_or(0.0, |x| x - at.0), y.map_or(0.0, |y| y - at.1)) };
            crate::dom::scroll_viewport(dx, dy);
            Value::Undefined
        }
        "matchMedia" => return crate::page::window_call(name, args).unwrap_or_else(|| Err(format!("{name} is not a function"))),
        "getComputedStyle" => match args.first().and_then(|a| if let Value::Object(r) = a { node_of(*r) } else { None }) {
            Some(n) => Value::Object(fresh(Kind::Computed(n))),
            None => return Err("Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.".into()),
        },
        "parseInt" => {
            let radix = match args.get(1) { Some(Value::Number(n)) => Some(*n), _ => None };
            Value::Number(crate::web::parse_int(&args.first().map(to_display).unwrap_or_else(|| "undefined".into()), radix))
        }
        "parseFloat" => Value::Number(crate::web::parse_float(&args.first().map(to_display).unwrap_or_else(|| "undefined".into()))),
        "atob" | "btoa" => {
            let units: Vec<u16> = args.first().map(to_display).unwrap_or_else(|| "undefined".into()).encode_utf16().collect();
            let out = if name == "btoa" { crate::web::btoa(&units) } else { crate::web::atob(&units) };
            match out {
                Some(u) => Value::Str(String::from_utf16_lossy(&u)),
                None => return Err(crate::abi::throw(values::new_error("InvalidCharacterError", if name == "btoa" {
                    "btoa: the string contains characters outside of the Latin1 range"
                } else {
                    "atob: the string to be decoded is not correctly encoded"
                }))),
            }
        }
        "setTimeout" => Value::Number(timers::add(callback()?, delay(1), false, args.get(2..).unwrap_or(&[]).to_vec()) as f64),
        "setInterval" => Value::Number(timers::add(callback()?, delay(1), true, args.get(2..).unwrap_or(&[]).to_vec()) as f64),
        "requestAnimationFrame" => Value::Number(timers::add_frame(callback()?) as f64),
        "queueMicrotask" => { timers::add(callback()?, 0.0, false, Vec::new()); Value::Undefined }
        "clearTimeout" | "clearInterval" | "cancelAnimationFrame" => { timers::cancel(id()); Value::Undefined }
        _ => return Err(format!("{name} is not a function")),
    })
}

/// SCRIPTC_HOST_CONSOLE_FILE: console output also appended to that file, whole (Android's log splits and drops long
/// lines, such as an error's stack).
fn console_file(level: &str, line: &str) {
    let Some(path) = std::env::var_os("SCRIPTC_HOST_CONSOLE_FILE") else { return };
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{:.3} {level}] {line}", timers::now_ms() / 1000.0);
    }
}

/// A method call on a host object (the vtable's call_method). One the host has no method for throws "is not a
/// function", as the page's would, and is named once under SCRIPTC_HOST_TRACE_UNANSWERED.
pub fn call_method(obj: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    let r = call_method_inner(obj, name, args);
    if let Err(e) = &r
        && e.ends_with("is not a function")
        && let Some(kind) = kind_of(obj)
        && !matches!(kind, Kind::Value)
    {
        unanswered(&format!("method {}.{name}()", kind_label(&kind)));
    }
    r
}

fn call_method_inner(obj: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    match kind_of(obj).ok_or_else(|| format!("a released host object (calling {name})"))? {
        Kind::Console => {
            let line = args.iter().map(|a| values::inspect(a, 0).unwrap_or_else(|| to_display(a))).collect::<Vec<_>>().join(" ");
            if matches!(name, "warn" | "error") { eprintln!("{line}") } else { println!("{line}") }
            console_file(name, &line);
            Ok(Value::Undefined)
        }
        Kind::Performance if name == "now" => Ok(Value::Number(timers::now_ms())),
        Kind::Node(n) => dom::call(n, name, args),
        Kind::Aux(a) => dom::aux_call(obj, &a, name, args),
        Kind::Window if crate::workers::in_worker() && crate::workers::SCOPE_METHODS.contains(&name) => crate::workers::scope_call(name, args),
        Kind::Window if dom::window_has_method(name) => dom::window_call(name, args),
        Kind::Window if crate::page::is_window_method(name) => crate::page::window_call(name, args).unwrap_or_else(|| Err(format!("{name} is not a function"))),
        Kind::Page(p) => crate::page::call(p, name, args),
        // The render thread draws through a layer's scene (its GPU stream), never a canvas context.
        Kind::Canvas(_) if name == "getContext" => Ok(Value::Null),
        Kind::Port(id) => crate::channels::port_call(id, name, args),
        Kind::Broadcast(id) => crate::channels::broadcast_call(id, name, args),
        Kind::FsHandle(h) => crate::opfs::handle_call(&h, name, args),
        Kind::FsWritable(w) => crate::opfs::writable_call(&w, name, args),
        Kind::FsSync(s) => crate::opfs::sync_call(&s, name, args),
        Kind::Worker(id) => crate::workers::worker_call(id, name, args),
        Kind::AbortController(s, _) => crate::abort::controller_call(&s, name, args),
        Kind::AbortSignal(s) => crate::abort::signal_call(&s, name, args),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcPeer(id) => crate::rtc::peer_call(id, name, args),
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::RtcChannel(id) => crate::rtc::channel_call(id, name, args),
        #[cfg(all(windows, feature = "audio"))]
        Kind::Audio(h) => crate::audio::call(obj, h, name, args),
        Kind::Observer(id, _) => crate::observers::call(id, name, args),
        Kind::SearchParams(p) => search_params_call(&p, name, args),
        Kind::UrlParams(url) => url_params_call(url, name, args),
        Kind::Computed(n) if name == "getPropertyValue" => Ok(Value::Str(dom::resolved_style(n, &args.first().map(to_display).unwrap_or_default()))),
        Kind::Window => call_global(GLOBAL_FUNCTIONS.iter().find(|g| **g == name).ok_or(format!("{name} is not a function"))?, args),
        Kind::Function(_) => match name {
            "call" => call(obj, match args.first() { Some(Value::Object(r)) => Some(*r), _ => None }, args.get(1..).unwrap_or(&[])),
            "apply" => {
                let this = match args.first() { Some(Value::Object(r)) => Some(*r), _ => None };
                let list = match args.get(1) {
                    Some(Value::Object(a)) if values::is_array(*a) => values::own_keys(*a).iter().filter(|k| k.parse::<usize>().is_ok()).map(|k| get(*a, k)).collect::<Result<Vec<_>, _>>()?,
                    Some(Value::Undefined | Value::Null) | None => Vec::new(),
                    _ => return Err("CreateListFromArrayLike called on non-object".into()),
                };
                call(obj, this, &list)
            }
            _ => Err(format!("{name} is not a function")),
        },
        Kind::Value => values::call_method(obj, name, args),
        Kind::Builtin("JSON") => match name {
            "stringify" => values::json_stringify(args),
            "parse" => values::json_parse(args).map_err(|(message, error)| crate::abi::throw(values::new_error(error, &message))),
            _ => Err(format!("JSON.{name} is not a function")),
        },
        // Object URLs (streams.rs): a Blob's bytes under a `blob:` URL a fetch, an `Audio` element's source and a
        // document load read until it is revoked.
        Kind::Builtin("URL") if name == "createObjectURL" => match args.first() {
            Some(Value::Object(r)) if blob_of(*r).is_some() => {
                let blob = blob_of(*r).expect("a Blob");
                crate::streams::create_object_url(&blob).map(Value::Str).map_err(|e| crate::abi::throw(values::new_error("TypeError", &e)))
            }
            _ => Err(crate::abi::throw(values::new_error("TypeError", "Failed to execute 'createObjectURL' on 'URL': Overload resolution failed."))),
        },
        Kind::Builtin("URL") if name == "revokeObjectURL" => {
            crate::streams::revoke_object_url(&args.first().map(to_display).unwrap_or_default());
            Ok(Value::Undefined)
        }
        Kind::Builtin("URL") if name == "canParse" => {
            Ok(Value::Bool(parse_url(&args.first().cloned().unwrap_or(Value::Undefined), args.get(1)).is_ok()))
        }
        Kind::Builtin(object) => values::builtin_call(object, name, args),
        Kind::Intl(f) => crate::intl::call(&f, name, args),
        Kind::Url(u) if matches!(name, "toString" | "toJSON") => Ok(Value::Str(u.to_string())),
        Kind::Response(r) => crate::modules::response_call(&r, name),
        Kind::Blob(b) => crate::streams::blob_call(&b, name, args),
        Kind::ByteStream(s) => crate::streams::stream_call(&s, name, args),
        Kind::Image(b) if name == "close" => {
            b.borrow_mut().take();
            Ok(Value::Undefined)
        }
        Kind::Headers(h) => {
            let key = args.first().map(to_display).unwrap_or_default().to_ascii_lowercase();
            let mut found = h.iter().filter(|(n, _)| *n == key).map(|(_, v)| v.as_str()).peekable();
            match name {
                "has" => Ok(Value::Bool(found.peek().is_some())),
                // Several values of one name join with ", ", as Headers.get does.
                "get" if found.peek().is_some() => Ok(Value::Str(found.collect::<Vec<_>>().join(", "))),
                "get" => Ok(Value::Null),
                _ => Err(format!("Headers.{name} is not a function")),
            }
        }
        _ => Err(format!("{name} is not a function")),
    }
}

/// `new URLSearchParams(init)`'s pairs: a query string (a leading "?" dropped), a record's own properties, a sequence
/// of [name, value] pairs, or another URLSearchParams.
fn search_params_init(init: &Value) -> Result<Vec<(String, String)>, String> {
    Ok(match init {
        Value::Undefined | Value::Null => Vec::new(),
        Value::Object(r) => match kind_of(*r) {
            Some(Kind::SearchParams(p)) => p.borrow().clone(),
            Some(Kind::UrlParams(url)) => url_pairs(url),
            _ if values::is_array(*r) => {
                let mut pairs = Vec::new();
                for key in values::own_keys(*r).iter().filter(|k| k.parse::<usize>().is_ok()) {
                    let Value::Object(pair) = get(*r, key)? else { return Err("Failed to construct 'URLSearchParams': The provided value cannot be converted to a sequence.".into()) };
                    let (name, value) = (get(pair, "0")?, get(pair, "1")?);
                    pairs.push((to_display(&name), to_display(&value)));
                }
                pairs
            }
            _ => own_keys(*r).into_iter().map(|k| { let v = get(*r, &k).unwrap_or(Value::Undefined); (k, to_display(&v)) }).collect(),
        },
        other => {
            let text = to_display(other);
            url::form_urlencoded::parse(text.strip_prefix('?').unwrap_or(&text).as_bytes()).map(|(k, v)| (k.into_owned(), v.into_owned())).collect()
        }
    })
}

fn search_params_call(p: &std::rc::Rc<RefCell<Vec<(String, String)>>>, name: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).map(to_display).unwrap_or_else(|| "undefined".into());
    let pair = |(k, v): &(String, String)| values::new_array(&[Value::Str(k.clone()), Value::Str(v.clone())]);
    Ok(match name {
        "get" => p.borrow().iter().find(|(k, _)| *k == arg(0)).map_or(Value::Null, |(_, v)| Value::Str(v.clone())),
        "getAll" => values::new_array(&p.borrow().iter().filter(|(k, _)| *k == arg(0)).map(|(_, v)| Value::Str(v.clone())).collect::<Vec<_>>()),
        "has" => Value::Bool(p.borrow().iter().any(|(k, _)| *k == arg(0))),
        "append" => { p.borrow_mut().push((arg(0), arg(1))); Value::Undefined }
        "set" => {
            // The first pair of that name takes the value; the rest go.
            let (key, value) = (arg(0), arg(1));
            let mut pairs = p.borrow_mut();
            let mut seen = false;
            pairs.retain_mut(|(k, v)| {
                if *k != key { return true; }
                if seen { return false; }
                seen = true;
                *v = value.clone();
                true
            });
            if !seen { pairs.push((key, value)); }
            Value::Undefined
        }
        "delete" => { let key = arg(0); p.borrow_mut().retain(|(k, _)| *k != key); Value::Undefined }
        "sort" => { p.borrow_mut().sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16())); Value::Undefined }
        "toString" => Value::Str(url::form_urlencoded::Serializer::new(String::new()).extend_pairs(p.borrow().iter()).finish()),
        "forEach" => {
            let Some(callback) = args.first() else { return Err("URLSearchParams.forEach: the callback is not a function".into()) };
            let pairs = p.borrow().clone();
            for (k, v) in pairs {
                values::call_value(callback, None, &[Value::Str(v), Value::Str(k)])?;
            }
            Value::Undefined
        }
        "keys" => values::new_snapshot_iterator(p.borrow().iter().map(|(k, _)| Value::Str(k.clone())).collect()),
        "values" => values::new_snapshot_iterator(p.borrow().iter().map(|(_, v)| Value::Str(v.clone())).collect()),
        // Fresh pairs drop their own counts when the operation ends: the iterator's hold keeps them.
        "entries" => values::new_snapshot_iterator(p.borrow().iter().map(pair).collect()),
        _ => return Err(format!("URLSearchParams.{name} is not a function")),
    })
}

/// `new URL(input, base)`'s parse: the base (a string or URL) first, then the input against it.
fn parse_url(input: &Value, base: Option<&Value>) -> Result<url::Url, String> {
    let text = |v: &Value| match v {
        Value::Object(r) => match kind_of(*r) {
            Some(Kind::Url(u)) => u.to_string(),
            _ => to_display(v),
        },
        _ => to_display(v),
    };
    let input = text(input);
    let parsed = match base {
        Some(b) if !matches!(b, Value::Undefined) => url::Url::parse(&text(b)).and_then(|b| b.join(&input)),
        _ => url::Url::parse(&input),
    };
    parsed.map_err(|_| crate::abi::throw(values::new_error("TypeError", &format!("Failed to construct 'URL': Invalid URL '{input}'"))))
}

/// A URL's component, as the URL interface spells it.
fn url_get(u: &url::Url, name: &str) -> Result<Option<Value>, String> {
    let s = |v: &str| Some(Value::Str(v.to_string()));
    let with_prefix = |prefix: &str, v: Option<&str>| s(&v.filter(|v| !v.is_empty()).map_or(String::new(), |v| format!("{prefix}{v}")));
    Ok(match name {
        "href" => s(u.as_str()),
        "origin" => s(&u.origin().ascii_serialization()),
        "protocol" => s(&format!("{}:", u.scheme())),
        "username" => s(u.username()),
        "password" => s(u.password().unwrap_or("")),
        "host" => s(&match (u.host_str(), u.port()) {
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_string(),
            _ => String::new(),
        }),
        "hostname" => s(u.host_str().unwrap_or("")),
        "port" => s(&u.port().map_or(String::new(), |p| p.to_string())),
        "pathname" => s(u.path()),
        "search" => with_prefix("?", u.query()),
        "hash" => with_prefix("#", u.fragment()),
        _ => None,
    })
}

/// A URL object's query as name/value pairs (none for a released one).
fn url_pairs(url: u64) -> Vec<(String, String)> {
    match kind_of(url) {
        Some(Kind::Url(u)) => u.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect(),
        _ => Vec::new(),
    }
}

/// A URLSearchParams call on a URL's `searchParams`: over the query's pairs, which are written back as the URL's
/// query when the call changed them (an emptied list drops the "?", as a browser's URL does).
fn url_params_call(url: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    let before = url_pairs(url);
    let pairs = std::rc::Rc::new(RefCell::new(before.clone()));
    let out = search_params_call(&pairs, name, args)?;
    let after = pairs.borrow().clone();
    if after != before {
        TABLE.with(|t| {
            if let Some(Some(Entry { kind: Kind::Url(u), .. })) = t.borrow_mut().entries.get_mut((url as usize).wrapping_sub(1)) {
                if after.is_empty() {
                    u.set_query(None);
                } else {
                    u.query_pairs_mut().clear().extend_pairs(after.iter());
                }
            }
        });
    }
    Ok(out)
}

/// A URL component written (the parts a page sets: href, pathname, search, hash).
fn url_set(obj: u64, name: &str, value: &Value) -> Result<(), String> {
    let text = to_display(value);
    TABLE.with(|t| {
        let mut t = t.borrow_mut();
        let Some(Some(Entry { kind: Kind::Url(u), .. })) = t.entries.get_mut(obj as usize - 1) else { return Err("a released host object".to_string()) };
        match name {
            "href" => *u = url::Url::parse(&text).map_err(|_| format!("Failed to set the 'href' property on 'URL': Invalid URL '{text}'"))?,
            "pathname" => u.set_path(&text),
            "search" => u.set_query(Some(text.trim_start_matches('?')).filter(|q| !q.is_empty())),
            "hash" => u.set_fragment(Some(text.trim_start_matches('#')).filter(|f| !f.is_empty())),
            _ => return Err(format!("URL.{name} cannot be set natively yet")),
        }
        Ok(())
    })
}

pub fn construct(ctor: u64, args: &[Value]) -> Result<Value, String> {
    match kind_of(ctor).ok_or("a released host object")? {
        Kind::Builtin("URL") => {
            let u = parse_url(&args.first().cloned().unwrap_or(Value::Undefined), args.get(1))?;
            Ok(Value::Object(fresh(Kind::Url(u))))
        }
        Kind::Builtin(name) if values::typed_array_elem(name).is_some() => values::typed_array_construct(name, args),
        Kind::Builtin(name) if dom::CONSTRUCTIBLE_EVENTS.contains(&name) => dom::construct_event(args),
        Kind::Builtin("Blob") => crate::streams::construct_blob(args),
        Kind::Builtin("CompressionStream") => crate::streams::construct_codec(args, true),
        Kind::Builtin("DecompressionStream") => crate::streams::construct_codec(args, false),
        Kind::Builtin("OffscreenCanvas") => Ok(crate::render_thread::construct_canvas(args)),
        Kind::Builtin("MessageChannel") => {
            let (a, b) = crate::channels::new_channel();
            // The channel holds its ports' objects (one count each, released with it).
            let (pa, pb) = TABLE.with(|t| {
                let mut t = t.borrow_mut();
                (alloc(&mut t, Kind::Port(a)), alloc(&mut t, Kind::Port(b)))
            });
            Ok(Value::Object(fresh(Kind::Channel(pa, pb))))
        }
        // new DOMException(message, name): an Error of that name ("Error" by default).
        Kind::Builtin("DOMException") => {
            let message = args.first().filter(|v| !matches!(v, Value::Undefined)).map(to_display).unwrap_or_default();
            let name = args.get(1).filter(|v| !matches!(v, Value::Undefined)).map(to_display).unwrap_or_else(|| "Error".into());
            Ok(values::new_error(&name, &message))
        }
        // new TypeError(message) and its kin: an Error of that name.
        Kind::Builtin(name) if ERROR_CTORS.contains(&name) => {
            let message = args.first().filter(|v| !matches!(v, Value::Undefined)).map(to_display).unwrap_or_default();
            Ok(values::new_error(name, &message))
        }
        Kind::Builtin("Worker") => crate::workers::construct(None, args),
        Kind::Builtin(name) if name.starts_with("Intl.") => Ok(Value::Object(fresh(Kind::Intl(std::rc::Rc::new(crate::intl::construct(name, args)?))))),
        Kind::WorkerCtor(n) => crate::workers::construct(Some(&n), args),
        Kind::Builtin("BroadcastChannel") => {
            let name = args.first().ok_or("Failed to construct 'BroadcastChannel': 1 argument required, but only 0 present.")?;
            Ok(Value::Object(fresh(Kind::Broadcast(crate::channels::new_broadcast(to_display(name))))))
        }
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Kind::Builtin("RTCPeerConnection") => {
            let id = crate::rtc::construct(args)?;
            let r = fresh(Kind::RtcPeer(id));
            crate::rtc::set_peer_object(id, r);
            Ok(Value::Object(r))
        }
        #[cfg(all(windows, feature = "audio"))]
        Kind::Builtin("AudioContext") => crate::audio::construct(args),
        #[cfg(all(windows, feature = "audio"))]
        Kind::Builtin("Audio") => crate::audio::construct_media(args),
        Kind::Builtin("AbortController") => {
            let state = crate::abort::new_signal();
            // The controller holds its signal's object (one count, released with it): `c.signal === c.signal`.
            let signal = TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::AbortSignal(state.clone())));
            state.set_object(signal);
            Ok(Value::Object(fresh(Kind::AbortController(state, signal))))
        }
        Kind::Builtin("Response") => Ok(new_response(crate::modules::FetchResponse::from_body_bytes(crate::streams::response_body_bytes(args.first())?))),
        Kind::Builtin("URLSearchParams") => {
            let pairs = search_params_init(args.first().unwrap_or(&Value::Undefined))?;
            Ok(Value::Object(fresh(Kind::SearchParams(std::rc::Rc::new(RefCell::new(pairs))))))
        }
        Kind::Builtin(name @ ("ResizeObserver" | "MutationObserver")) => {
            let resize = name == "ResizeObserver";
            let id = crate::observers::construct(resize, args)?;
            let r = fresh(Kind::Observer(id, resize));
            crate::observers::set_handle(id, r);
            Ok(Value::Object(r))
        }
        other => {
            unanswered(&format!("new {}()", kind_label(&other)));
            Err("not a constructor".into())
        }
    }
}

/// `obj instanceof ctor`: a DOM interface answers from the value's kind (a node's namespace and tag, an event's type),
/// URL from the URL objects; anything else is not an instance.
pub fn instance_of(obj: u64, ctor: u64) -> bool {
    let Some(Kind::Builtin(iface)) = kind_of(ctor) else { return false };
    match kind_of(obj) {
        Some(Kind::Node(n)) => dom::node_interfaces(n).contains(&iface),
        Some(Kind::Aux(a)) => dom::aux_interfaces(&a).contains(&iface),
        Some(Kind::Window) => iface == "Window",
        Some(Kind::Url(_)) => iface == "URL",
        Some(Kind::Blob(b)) => iface == "Blob" || (iface == "File" && b.file.is_some()),
        Some(Kind::FsHandle(h)) => iface == "FileSystemHandle" || iface == if crate::opfs::is_directory(&h) { "FileSystemDirectoryHandle" } else { "FileSystemFileHandle" },
        Some(Kind::FsWritable(_)) => matches!(iface, "FileSystemWritableFileStream" | "WritableStream"),
        Some(Kind::FsSync(_)) => iface == "FileSystemSyncAccessHandle",
        // Every native error is an Error; a TypeError (and its kin) is one of that name.
        Some(Kind::Value) if ERROR_CTORS.contains(&iface) => {
            values::type_probe(obj, "isNativeError") && (iface == "Error" || matches!(values::get(obj, "name"), Ok(Some(Value::Str(n))) if n == iface))
        }
        // An Error of a DOM exception's name (the host's DOMExceptions are Errors so named).
        Some(Kind::Value) if iface == "DOMException" => {
            values::type_probe(obj, "isNativeError") && matches!(values::get(obj, "name"), Ok(Some(Value::Str(n))) if DOM_EXCEPTION_NAMES.contains(&n.as_str()))
        }
        Some(Kind::ByteStream(s)) => iface == if s.reader { "ReadableStreamDefaultReader" } else { "ReadableStream" },
        Some(Kind::Response(_)) => iface == "Response",
        Some(Kind::Canvas(_)) => iface == "OffscreenCanvas",
        Some(Kind::Channel(..)) => iface == "MessageChannel",
        Some(Kind::Port(_)) => iface == "MessagePort",
        Some(Kind::Broadcast(_)) => iface == "BroadcastChannel",
        Some(Kind::Worker(_)) => iface == "Worker",
        Some(Kind::AbortController(..)) => iface == "AbortController",
        Some(Kind::AbortSignal(_)) => iface == "AbortSignal",
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Some(Kind::RtcPeer(_)) => iface == "RTCPeerConnection",
        #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
        Some(Kind::RtcChannel(_)) => iface == "RTCDataChannel",
        #[cfg(all(windows, feature = "audio"))]
        Some(Kind::Audio(h)) => crate::audio::instance_of(h, iface),
        Some(Kind::Codec(c)) => iface == if c.compress { "CompressionStream" } else { "DecompressionStream" },
        Some(Kind::Value) => values::typed_array_elem(iface).is_some_and(|e| values::bytes_of(obj).is_some_and(|(elem, _)| elem == e)),
        _ => false,
    }
}

/// The native error constructors the host supplies.
const ERROR_CTORS: &[&str] = &["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"];

/// The DOMException names (WebIDL's error names table).
const DOM_EXCEPTION_NAMES: &[&str] = &[
    "IndexSizeError", "HierarchyRequestError", "WrongDocumentError", "InvalidCharacterError", "NoModificationAllowedError",
    "NotFoundError", "NotSupportedError", "InvalidStateError", "InUseAttributeError", "SyntaxError", "InvalidModificationError",
    "NamespaceError", "InvalidAccessError", "TypeMismatchError", "SecurityError", "NetworkError", "AbortError", "URLMismatchError",
    "QuotaExceededError", "TimeoutError", "InvalidNodeTypeError", "DataCloneError", "EncodingError", "NotReadableError",
    "UnknownError", "ConstraintError", "DataError", "TransactionInactiveError", "ReadOnlyError", "VersionError",
    "OperationError", "NotAllowedError", "OptOutError",
];

pub fn is_callable(obj: u64) -> bool {
    matches!(kind_of(obj), Some(Kind::Function(_)))
}

/// `String(v)` as console.log prints it.
pub fn to_display(v: &Value) -> String {
    match v {
        Value::Undefined => "undefined".into(),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_to_string(*n),
        Value::Str(s) => s.clone(),
        Value::Closure(_) => "function () { [native code] }".into(),
        Value::Program(_) => "[object Object]".into(),
        Value::Object(r) => match kind_of(*r) {
            Some(Kind::Node(n)) => format!("[object {}]", dom::interface_name(n)),
            Some(Kind::Function(_)) => "function () { [native code] }".into(),
            Some(Kind::Children(_)) => "[object HTMLCollection]".into(),
            Some(Kind::Image(_)) => "[object ImageBitmap]".into(),
            Some(Kind::Aux(a)) => dom::aux_display(&a),
            Some(Kind::Value) => values::display(*r).unwrap_or_default(),
            Some(Kind::Builtin("JSON")) => "[object JSON]".into(),
            Some(Kind::Builtin(name)) => format!("function {name}() {{ [native code] }}"),
            _ => "[object Object]".into(),
        },
    }
}

/// Number::toString for the common cases (integers without a fraction, shortest round-trip otherwise).
pub fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n == 0.0 {
        "0".into()
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{n:.0}")
    } else {
        format!("{n}")
    }
}

pub fn children_ref(n: NodeId) -> u64 {
    let r = TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Children(n)));
    release_after_return(r);
    r
}

/// A fresh object for a DOM value that is not a node (one count: the caller's).
pub fn aux_ref(a: dom::Aux) -> u64 {
    TABLE.with(|t| alloc(&mut t.borrow_mut(), Kind::Aux(a)))
}

/// A fresh DOM object handed out as an operation's result (its allocation count is dropped once it is out).
pub fn aux_value(a: dom::Aux) -> Value {
    let r = aux_ref(a);
    release_after_return(r);
    Value::Object(r)
}

/// The DOM object a reference names, if it is one.
pub fn aux_of(r: u64) -> Option<dom::Aux> {
    match kind_of(r) {
        Some(Kind::Aux(a)) => Some(a),
        _ => None,
    }
}

/// GetIterator over a host object: plain values iterate themselves; a node's `children` iterates a snapshot.
pub fn iterator(obj: u64) -> Result<Value, String> {
    match kind_of(obj).ok_or("a released host object")? {
        Kind::Value => values::iterator(obj).ok_or_else(|| "not iterable".to_string()),
        Kind::Children(n) => Ok(values::new_snapshot_iterator(dom::element_children(n).into_iter().map(|c| Value::Object(node_ref(c))).collect())),
        Kind::SearchParams(p) => search_params_call(&p, "entries", &[]),
        Kind::UrlParams(url) => url_params_call(url, "entries", &[]),
        _ => Err("not iterable".into()),
    }
}

/// Object.keys of a host object: a plain value's own keys; other host objects expose none.
pub fn own_keys(obj: u64) -> Vec<String> {
    if is_value(obj) { values::own_keys(obj) } else { Vec::new() }
}

/// A new ImageBitmap holding `pixels` (its allocation's count dropped once the current operation's result is out).
pub fn new_bitmap(pixels: crate::bitmap::Pixels) -> Value {
    Value::Object(fresh(Kind::Image(std::rc::Rc::new(RefCell::new(Some(pixels))))))
}

/// The pixels `v` holds when it is an ImageBitmap: Some(None) when it is one that was closed, None when it is not one.
pub fn bitmap_pixels(v: &Value) -> Option<Option<crate::bitmap::Pixels>> {
    let Value::Object(r) = v else { return None };
    match kind_of(*r)? {
        Kind::Image(b) => Some(b.borrow().clone()),
        _ => None,
    }
}
