//! Dedicated workers (`new Worker(...)`, and a Vite `?worker` import's constructor), as the page runs them: each on a
//! thread of its own, in a runtime instance of its own, its global scope a worker's (`self`, `postMessage`,
//! `onmessage`; no window, no document). The worker's code is a piece of the executable compiled from the module
//! (windows-native-build.mjs: worker_<file stem>, entry worker_<stem>_main), registered here before main by the
//! build's generated table ([`scr_host_register_worker`]); a build without workers registers none, and a `?worker`
//! import then answers undefined, as before.
//!
//! - A page import (the runtime's `scriptc:page-import` host module) of a `?worker` specifier answers that worker's
//!   constructor, by the specifier's file stem; `new Worker(url)` finds one the same way, by the URL's file name.
//! - `new` starts the thread: the instance's remote inbox first, then the piece's entry (its top-level code sets
//!   `onmessage`), then its loop (`scr_thread_run_loop`), held alive (`scr_remote_hold`) until `terminate()`.
//! - Messages both ways are structured clones (channels.rs [`Cloned`]), each delivered as a task of the receiving
//!   instance's loop through its remote inbox (`scr_remote_post`). A transfer list is accepted; its buffers are
//!   copied, not detached.
//! - An exception the worker leaves uncaught is printed and fires `error` on its Worker object (`{ type, message }`).

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::ffi::{CStr, c_char, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::channels::{Cloned, Receiver, clone_in, clone_out};
use crate::objects::{self, Value};
use crate::values;

type Entry = unsafe extern "C" fn(i32, *mut *mut c_char) -> i32;
type Leave = unsafe extern "C" fn();

unsafe extern "C" {
    fn scr_instance_remote() -> *mut c_void;
    fn scr_remote_post(remote: *mut c_void, task: unsafe extern "C" fn(*mut c_void), arg: *mut c_void);
    fn scr_remote_hold(delta: i32);
    fn scr_thread_run_loop() -> i32;
}

/// The worker pieces the executable links: name, entry, and the runtime's thread exit (a threaded runtime's).
static PIECES: Mutex<Vec<(String, usize, usize)>> = Mutex::new(Vec::new());

/// The build's generated table registers each worker piece here, before main.
///
/// # Safety
/// `name` is a NUL-terminated string; `entry` and `leave` are the piece's entry and the runtime's `scr_thread_leave`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scr_host_register_worker(name: *const c_char, entry: Entry, leave: Leave) {
    // SAFETY: the caller's contract.
    let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
    PIECES.lock().unwrap_or_else(|e| e.into_inner()).push((name, entry as usize, leave as usize));
}

/// Whether this executable has any worker pieces (the `Worker` global is defined then).
pub fn any() -> bool {
    !PIECES.lock().unwrap_or_else(|e| e.into_inner()).is_empty()
}

/// A specifier's or URL's worker piece name: worker_<file stem>, every other character `_` (the build's workerPiece).
pub fn piece_name(spec: &str) -> String {
    let path = spec.split(['?', '#']).next().unwrap_or("");
    let file = path.rsplit(['/', '\\']).next().unwrap_or("");
    let stem = [".ts", ".tsx", ".mts", ".js", ".mjs"].iter().find_map(|e| file.strip_suffix(e)).unwrap_or(file);
    format!("worker_{}", stem.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect::<String>())
}

fn piece(name: &str) -> Option<(Entry, Leave)> {
    let pieces = PIECES.lock().unwrap_or_else(|e| e.into_inner());
    let &(_, entry, leave) = pieces.iter().find(|(n, _, _)| n == name)?;
    // SAFETY: registered as these function pointers.
    Some(unsafe { (std::mem::transmute::<usize, Entry>(entry), std::mem::transmute::<usize, Leave>(leave)) })
}

/// `scriptc:page-import` import(key, name, specifier): a `?worker` module's default export, its constructor, when
/// this executable has that worker piece; undefined otherwise (not supplied).
pub fn page_import(args: &[Value]) -> Value {
    let spec = args.get(2).map(objects::to_display).unwrap_or_default();
    let export = args.get(1).map(objects::to_display).unwrap_or_default();
    if !spec.ends_with("?worker") || export != "default" {
        return Value::Undefined;
    }
    let name = piece_name(&spec);
    if piece(&name).is_none() {
        return Value::Undefined;
    }
    objects::worker_constructor(&name)
}

/// What crosses to the owner.
enum ToOwner {
    Message(Cloned),
    Error(String),
}

/// One worker, shared by its owner's thread and its own.
struct Shared {
    name: String,
    /// The owner's Worker object's id on its thread.
    owner_id: u32,
    owner_inbox: usize,
    worker_inbox: Mutex<Option<usize>>,
    to_worker: Mutex<VecDeque<Cloned>>,
    to_owner: Mutex<VecDeque<ToOwner>>,
    terminated: AtomicBool,
    /// The worker's loop hold was given back (once).
    released: AtomicBool,
}

/// A Worker object's side, on its owner's thread: messages and errors.
struct Owner {
    shared: Arc<Shared>,
    message: Receiver,
    error: Receiver,
}

/// The worker thread's own scope.
struct Scope {
    shared: Arc<Shared>,
    message: Receiver,
}

thread_local! {
    static OWNERS: RefCell<HashMap<u32, Owner>> = RefCell::new(HashMap::new());
    static NEXT_ID: std::cell::Cell<u32> = const { std::cell::Cell::new(1) };
    static SCOPE: RefCell<Option<Scope>> = const { RefCell::new(None) };
}

/// Whether this thread runs a worker (its global scope is a worker's).
pub fn in_worker() -> bool {
    SCOPE.with(|s| s.borrow().is_some())
}

/// `new` of a worker constructor (`name` a registered piece) or `new Worker(url)` (`name` None: the URL's piece).
pub fn construct(name: Option<&str>, args: &[Value]) -> Result<Value, String> {
    let name = match name {
        Some(n) => n.to_string(),
        None => {
            let url = args.first().map(objects::to_display).unwrap_or_default();
            let n = piece_name(&url);
            if piece(&n).is_none() {
                return Err(crate::abi::throw(values::new_error("NotSupportedError", &format!("Failed to construct 'Worker': no compiled worker for '{url}' in this executable"))));
            }
            n
        }
    };
    let (entry, leave) = piece(&name).ok_or_else(|| format!("Failed to construct 'Worker': no worker piece {name}"))?;
    let id = NEXT_ID.with(|n| {
        let id = n.get();
        n.set(id + 1);
        id
    });
    // SAFETY: the calling thread's instance's inbox (the owner's).
    let owner_inbox = unsafe { scr_instance_remote() } as usize;
    let shared = Arc::new(Shared {
        name: name.clone(),
        owner_id: id,
        owner_inbox,
        worker_inbox: Mutex::new(None),
        to_worker: Mutex::new(VecDeque::new()),
        to_owner: Mutex::new(VecDeque::new()),
        terminated: AtomicBool::new(false),
        released: AtomicBool::new(false),
    });
    let theirs = shared.clone();
    std::thread::Builder::new()
        .name(format!("scriptc-host-{name}"))
        .stack_size(8 << 20)
        .spawn(move || run(theirs, entry, leave))
        .map_err(|e| format!("Failed to construct 'Worker': {e}"))?;
    OWNERS.with(|o| o.borrow_mut().insert(id, Owner { shared, message: Receiver::default(), error: Receiver::default() }));
    Ok(objects::new_worker(id))
}

/// The worker thread: its inbox, the piece's top-level code, then its loop until terminated.
fn run(shared: Arc<Shared>, entry: Entry, leave: Leave) {
    SCOPE.with(|s| *s.borrow_mut() = Some(Scope { shared: shared.clone(), message: Receiver::default() }));
    // SAFETY: runtime calls on this thread's own (new) instance.
    unsafe { scr_remote_hold(1) };
    let inbox = unsafe { scr_instance_remote() };
    *shared.worker_inbox.lock().unwrap_or_else(|e| e.into_inner()) = Some(inbox as usize);
    if crate::relay::trace() {
        eprintln!("worker: {} started on its own thread", shared.name);
    }
    // SAFETY: the piece's entry, compiled to return after its top-level code.
    let code = unsafe { entry(0, std::ptr::null_mut()) };
    if code != 0 {
        post_to_owner(&shared, ToOwner::Error(format!("the worker {} failed to start ({code})", shared.name)));
    }
    if shared.terminated.load(Ordering::Acquire) {
        release(&shared);
    } else {
        // What the owner posted before the inbox was known.
        // SAFETY: this instance's inbox; the task owns the Arc it is handed.
        unsafe { scr_remote_post(inbox, deliver_to_worker, Arc::into_raw(shared.clone()) as *mut c_void) };
        unsafe { scr_thread_run_loop() };
    }
    SCOPE.with(|s| {
        if let Some(mut scope) = s.borrow_mut().take() {
            scope.message.close();
        }
    });
    // SAFETY: this thread entered the instance and leaves it once, before it ends.
    unsafe { leave() };
    if crate::relay::trace() {
        eprintln!("worker: {} ended", shared.name);
    }
}

/// The worker's loop hold given back (once): with nothing else pending its loop ends.
fn release(shared: &Shared) {
    if !shared.released.swap(true, Ordering::AcqRel) {
        // SAFETY: on the worker's own thread (callers run there).
        unsafe { scr_remote_hold(-1) };
    }
}

fn post_to_owner(shared: &Arc<Shared>, what: ToOwner) {
    shared.to_owner.lock().unwrap_or_else(|e| e.into_inner()).push_back(what);
    // SAFETY: the owner's inbox (a post after its instance stopped is dropped); the task owns the Arc.
    unsafe { scr_remote_post(shared.owner_inbox as *mut c_void, deliver_to_owner, Arc::into_raw(shared.clone()) as *mut c_void) };
}

/// A `{ type, ... }` event object.
fn event(kind: &str, fields: Vec<(&str, Value)>) -> Value {
    let e = values::new_object();
    if let Value::Object(r) = e {
        let _ = values::set(r, "type", Value::Str(kind.into()));
        for (k, v) in fields {
            let _ = values::set(r, k, v);
        }
    }
    e
}

/// Calls `handlers` with `event`; an exception one leaves is reported (a worker's goes to its owner too).
fn dispatch(handlers: Vec<u64>, event: &Value) {
    for h in handlers {
        crate::abi::closure_retain(h);
        let threw = crate::abi::call_closure(h, std::slice::from_ref(event)).is_err();
        crate::abi::closure_release(h);
        if threw {
            uncaught("a message handler");
        }
    }
}

/// An exception left uncaught: printed, and on a worker's thread, an `error` event on its Worker object.
pub fn uncaught(context: &str) {
    let text = match crate::abi::take_exception() {
        Some(v) => {
            let text = match &v {
                Value::Object(r) => values::get(*r, "stack").ok().flatten().map(|s| objects::to_display(&s)),
                _ => None,
            }
            .unwrap_or_else(|| objects::to_display(&v));
            values::release_value(v);
            text
        }
        None => "an exception".into(),
    };
    eprintln!("Uncaught {text} (in {context})");
    let shared = SCOPE.with(|s| s.borrow().as_ref().map(|s| s.shared.clone()));
    if let Some(shared) = shared {
        post_to_owner(&shared, ToOwner::Error(text));
    }
}

unsafe extern "C" fn deliver_to_worker(arg: *mut c_void) {
    // SAFETY: the Arc a post handed over.
    let shared = unsafe { Arc::from_raw(arg as *const Shared) };
    if shared.terminated.load(Ordering::Acquire) {
        return;
    }
    loop {
        let Some(data) = shared.to_worker.lock().unwrap_or_else(|e| e.into_inner()).pop_front() else { return };
        let _op = objects::Op::enter();
        let handlers = SCOPE.with(|s| s.borrow().as_ref().map(|s| s.message.handlers()).unwrap_or_default());
        if handlers.is_empty() {
            continue;
        }
        let e = event("message", vec![("data", clone_in(&data))]);
        dispatch(handlers, &e);
        drop(_op);
        values::run_jobs();
    }
}

unsafe extern "C" fn deliver_to_owner(arg: *mut c_void) {
    // SAFETY: the Arc a post handed over.
    let shared = unsafe { Arc::from_raw(arg as *const Shared) };
    loop {
        if shared.terminated.load(Ordering::Acquire) {
            return;
        }
        let Some(what) = shared.to_owner.lock().unwrap_or_else(|e| e.into_inner()).pop_front() else { return };
        let _op = objects::Op::enter();
        let id = shared.owner_id;
        let (handlers, e) = match &what {
            ToOwner::Message(data) => (OWNERS.with(|o| o.borrow().get(&id).map(|w| w.message.handlers())), event("message", vec![("data", clone_in(data))])),
            ToOwner::Error(message) => (
                OWNERS.with(|o| o.borrow().get(&id).map(|w| w.error.handlers())),
                event("error", vec![("message", Value::Str(message.clone())), ("filename", Value::Str(shared.name.clone()))]),
            ),
        };
        dispatch(handlers.unwrap_or_default(), &e);
        drop(_op);
        values::run_jobs();
    }
}

unsafe extern "C" fn terminate_task(arg: *mut c_void) {
    // SAFETY: the Arc a post handed over.
    let shared = unsafe { Arc::from_raw(arg as *const Shared) };
    SCOPE.with(|s| {
        if let Some(scope) = s.borrow_mut().as_mut() {
            scope.message.close();
        }
    });
    release(&shared);
}

fn closure_of(v: Option<&Value>) -> Option<u64> {
    match v {
        Some(Value::Closure(c)) => Some(*c),
        _ => None,
    }
}

// ── the Worker object (the owner's side) ──────────────────────────────

pub const WORKER_METHODS: &[&str] = &["postMessage", "terminate", "addEventListener", "removeEventListener"];

pub fn worker_get(id: u32, name: &str) -> Option<Value> {
    let handler = |pick: fn(&Owner) -> Option<u64>| OWNERS.with(|o| o.borrow().get(&id).and_then(pick)).map_or(Value::Null, Value::Closure);
    Some(match name {
        "onmessage" => handler(|w| w.message.onmessage),
        "onerror" => handler(|w| w.error.onmessage),
        "onmessageerror" => Value::Null,
        _ => return None,
    })
}

pub fn worker_set(id: u32, name: &str, value: &Value) -> Result<(), String> {
    let closure = closure_of(Some(value));
    OWNERS.with(|o| {
        let mut o = o.borrow_mut();
        let Some(w) = o.get_mut(&id) else { return Ok(()) };
        match name {
            "onmessage" => w.message.set_onmessage(closure),
            "onerror" => w.error.set_onmessage(closure),
            "onmessageerror" => {}
            _ => return Err(format!("cannot set '{name}' on a Worker")),
        }
        Ok(())
    })
}

pub fn worker_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    let shared = OWNERS.with(|o| o.borrow().get(&id).map(|w| w.shared.clone()));
    let Some(shared) = shared else { return Ok(Value::Undefined) };
    match name {
        "postMessage" => {
            let data = clone_out(args.first().unwrap_or(&Value::Undefined))?;
            if shared.terminated.load(Ordering::Acquire) {
                return Ok(Value::Undefined);
            }
            shared.to_worker.lock().unwrap_or_else(|e| e.into_inner()).push_back(data);
            if let Some(inbox) = *shared.worker_inbox.lock().unwrap_or_else(|e| e.into_inner()) {
                // SAFETY: the worker's inbox; the task owns the Arc.
                unsafe { scr_remote_post(inbox as *mut c_void, deliver_to_worker, Arc::into_raw(shared.clone()) as *mut c_void) };
            }
        }
        "terminate" => terminate(&shared),
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(c)) = (args.first().map(objects::to_display), closure_of(args.get(1))) {
                let add = name == "addEventListener";
                OWNERS.with(|o| {
                    if let Some(w) = o.borrow_mut().get_mut(&id) {
                        match kind.as_str() {
                            "message" => w.message.listen(add, c),
                            "error" => w.error.listen(add, c),
                            _ => {}
                        }
                    }
                });
            }
        }
        _ => return Err(format!("{name} is not a function")),
    }
    Ok(Value::Undefined)
}

fn terminate(shared: &Arc<Shared>) {
    if shared.terminated.swap(true, Ordering::AcqRel) {
        return;
    }
    if let Some(inbox) = *shared.worker_inbox.lock().unwrap_or_else(|e| e.into_inner()) {
        // SAFETY: the worker's inbox; the task owns the Arc.
        unsafe { scr_remote_post(inbox as *mut c_void, terminate_task, Arc::into_raw(shared.clone()) as *mut c_void) };
    }
}

/// The program let go of a Worker object: it is terminated (nothing can reach it any more) and its handlers go.
pub fn worker_freed(id: u32) {
    let owner = OWNERS.with(|o| o.borrow_mut().remove(&id));
    if let Some(mut w) = owner {
        terminate(&w.shared);
        w.message.close();
        w.error.close();
    }
}

// ── the worker's global scope (on its own thread) ─────────────────────

pub const SCOPE_METHODS: &[&str] = &["postMessage", "close", "addEventListener", "removeEventListener"];

pub fn scope_get(name: &str) -> Option<Value> {
    match name {
        "onmessage" => Some(SCOPE.with(|s| s.borrow().as_ref().and_then(|s| s.message.onmessage)).map_or(Value::Null, Value::Closure)),
        "onmessageerror" | "onerror" => Some(Value::Null),
        "name" => Some(Value::Str(SCOPE.with(|s| s.borrow().as_ref().map(|s| s.shared.name.clone())).unwrap_or_default())),
        _ => None,
    }
}

/// A property the worker sets on its global scope: its handler (true), or not one of the scope's (false).
pub fn scope_set(name: &str, value: &Value) -> bool {
    match name {
        "onmessage" => {
            let closure = closure_of(Some(value));
            SCOPE.with(|s| {
                if let Some(s) = s.borrow_mut().as_mut() {
                    s.message.set_onmessage(closure);
                }
            });
            true
        }
        "onmessageerror" | "onerror" => true,
        _ => false,
    }
}

pub fn scope_call(name: &str, args: &[Value]) -> Result<Value, String> {
    let shared = SCOPE.with(|s| s.borrow().as_ref().map(|s| s.shared.clone())).ok_or("not a worker")?;
    match name {
        "postMessage" => {
            let data = clone_out(args.first().unwrap_or(&Value::Undefined))?;
            if crate::relay::trace() {
                let size = match &data {
                    Cloned::Bytes(_, b) => format!("{} bytes", b.len()),
                    _ => "a value".into(),
                };
                eprintln!("worker: {} posts {size} to its owner", shared.name);
            }
            post_to_owner(&shared, ToOwner::Message(data));
        }
        // close(): the worker stops taking messages and its loop ends.
        "close" => {
            SCOPE.with(|s| {
                if let Some(s) = s.borrow_mut().as_mut() {
                    s.message.close();
                }
            });
            release(&shared);
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(c)) = (args.first().map(objects::to_display), closure_of(args.get(1)))
                && kind == "message"
            {
                SCOPE.with(|s| {
                    if let Some(s) = s.borrow_mut().as_mut() {
                        s.message.listen(name == "addEventListener", c);
                    }
                });
            }
        }
        _ => return Err(format!("{name} is not a function")),
    }
    Ok(Value::Undefined)
}
