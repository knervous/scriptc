//! The page's message channels: `MessageChannel` (two entangled `MessagePort`s on one thread: a message task the
//! browser does not clamp, as a page's polls and yields use it) and `BroadcastChannel` (every
//! channel of the same name in the process, on any thread: the page's main thread and its render thread are one origin,
//! as the page and its worker are). A message is a structured clone ([`Cloned`]) delivered as a task of its own on the
//! receiving thread's loop (abi.rs io_poll), `onmessage` and the `message` listeners called with a MessageEvent-shaped
//! `{ type, data }`; microtasks run between messages.
//!
//! What is not carried: a MessagePort sent to another thread (a transfer list's port), and a transferred buffer is
//! copied, not detached (the program's typed array keeps its bytes).

use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::objects::{self, Value};
use crate::values;

/// A message's data as it crosses: structured clone's subset a page posts (primitives, arrays, plain objects and
/// typed arrays).
#[derive(Clone, Debug)]
pub enum Cloned {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Cloned>),
    Object(Vec<(String, Cloned)>),
    /// A typed array: its element kind (values.rs numbering) and bytes.
    Bytes(u32, Vec<u8>),
}

/// How deep a clone goes (a cyclic value fails rather than recursing forever).
const CLONE_DEPTH: usize = 64;

/// A value cloned out of this thread: a DataCloneError's message for what cannot be cloned (a function, a host object
/// that is not plain data, a promise).
pub fn clone_out(v: &Value) -> Result<Cloned, String> {
    clone_at(v, 0)
}

fn clone_at(v: &Value, depth: usize) -> Result<Cloned, String> {
    if depth > CLONE_DEPTH {
        return Err("Failed to execute 'postMessage': the value is too deeply nested (or cyclic) to be cloned.".into());
    }
    Ok(match v {
        Value::Undefined => Cloned::Undefined,
        Value::Null => Cloned::Null,
        Value::Bool(b) => Cloned::Bool(*b),
        Value::Number(n) => Cloned::Number(*n),
        Value::Str(s) => Cloned::Str(s.clone()),
        Value::Closure(_) | Value::Program(_) => return Err(not_cloneable("a function or a compiled object")),
        Value::Object(r) => {
            let r = *r;
            if !objects::is_value(r) || values::is_promise(r) {
                return Err(not_cloneable("a host object"));
            }
            if let Some((elem, data)) = values::bytes_of(r) {
                Cloned::Bytes(elem, data)
            } else if values::is_array(r) {
                let len = match values::get(r, "length")? {
                    Some(Value::Number(n)) => n as usize,
                    _ => 0,
                };
                let mut items = Vec::with_capacity(len);
                for i in 0..len {
                    items.push(clone_at(&values::get(r, &i.to_string())?.unwrap_or(Value::Undefined), depth + 1)?);
                }
                Cloned::Array(items)
            } else {
                let mut props = Vec::new();
                for key in values::own_keys(r) {
                    let v = values::get(r, &key)?.unwrap_or(Value::Undefined);
                    props.push((key, clone_at(&v, depth + 1)?));
                }
                Cloned::Object(props)
            }
        }
    })
}

fn not_cloneable(what: &str) -> String {
    crate::abi::throw(values::new_error("DataCloneError", &format!("Failed to execute 'postMessage': {what} could not be cloned.")))
}

/// A clone made into this thread's values (fresh: their counts drop when the current operation ends).
pub fn clone_in(c: &Cloned) -> Value {
    match c {
        Cloned::Undefined => Value::Undefined,
        Cloned::Null => Value::Null,
        Cloned::Bool(b) => Value::Bool(*b),
        Cloned::Number(n) => Value::Number(*n),
        Cloned::Str(s) => Value::Str(s.clone()),
        Cloned::Bytes(elem, data) => values::new_bytes(*elem, data.clone()),
        Cloned::Array(items) => {
            let items: Vec<Value> = items.iter().map(clone_in).collect();
            values::new_array(&items)
        }
        Cloned::Object(props) => {
            let o = values::new_object();
            if let Value::Object(r) = o {
                for (k, v) in props {
                    let _ = values::set(r, k, clone_in(v));
                }
            }
            o
        }
    }
}

/// A port or a broadcast channel's receiving side: its handler and listeners (closures, retained here).
#[derive(Default)]
pub struct Receiver {
    pub onmessage: Option<u64>,
    listeners: Vec<u64>,
    closed: bool,
}

impl Receiver {
    pub fn set_onmessage(&mut self, closure: Option<u64>) {
        if let Some(c) = closure {
            crate::abi::closure_retain(c);
        }
        if let Some(old) = std::mem::replace(&mut self.onmessage, closure) {
            crate::abi::closure_release(old);
        }
    }

    pub fn listen(&mut self, add: bool, closure: u64) {
        if add {
            if !self.listeners.contains(&closure) {
                crate::abi::closure_retain(closure);
                self.listeners.push(closure);
            }
        } else if let Some(i) = self.listeners.iter().position(|c| *c == closure) {
            self.listeners.remove(i);
            crate::abi::closure_release(closure);
        }
    }

    /// Closed: the handler and listeners let go (a closed port or channel delivers nothing more).
    pub fn close(&mut self) {
        self.closed = true;
        self.set_onmessage(None);
        for c in std::mem::take(&mut self.listeners) {
            crate::abi::closure_release(c);
        }
    }

    pub fn handlers(&self) -> Vec<u64> {
        self.onmessage.iter().chain(self.listeners.iter()).copied().collect()
    }
}

struct Port {
    receiver: Receiver,
    /// The entangled port (None once either side closed).
    other: Option<u32>,
    /// Started (`start()`, or an `onmessage` set): messages are delivered; before that they wait here.
    started: bool,
    waiting: VecDeque<Cloned>,
}

enum Task {
    Port(u32, Cloned),
    Broadcast(u32, Cloned),
}

thread_local! {
    /// This thread's ports by id (None once freed).
    static PORTS: RefCell<Vec<Option<Port>>> = const { RefCell::new(Vec::new()) };
    /// This thread's broadcast channels by id (None once freed).
    static BROADCASTS: RefCell<Vec<Option<(String, Receiver)>>> = const { RefCell::new(Vec::new()) };
    /// Message tasks due on this thread, in order.
    static TASKS: RefCell<VecDeque<Task>> = const { RefCell::new(VecDeque::new()) };
}

// ── MessageChannel ─────────────────────────────────────────────────────

/// `new MessageChannel()`: two entangled ports' ids.
pub fn new_channel() -> (u32, u32) {
    PORTS.with(|p| {
        let mut p = p.borrow_mut();
        let a = p.len() as u32;
        let b = a + 1;
        p.push(Some(Port { receiver: Receiver::default(), other: Some(b), started: false, waiting: VecDeque::new() }));
        p.push(Some(Port { receiver: Receiver::default(), other: Some(a), started: false, waiting: VecDeque::new() }));
        (a, b)
    })
}

fn with_port<R>(id: u32, f: impl FnOnce(&mut Port) -> R) -> Option<R> {
    PORTS.with(|p| p.borrow_mut().get_mut(id as usize).and_then(Option::as_mut).map(f))
}

/// A port's queued messages become tasks once it is started.
fn start_port(id: u32) {
    let ready: Vec<Cloned> = with_port(id, |p| {
        p.started = true;
        p.waiting.drain(..).collect()
    })
    .unwrap_or_default();
    TASKS.with(|t| t.borrow_mut().extend(ready.into_iter().map(|c| Task::Port(id, c))));
}

pub fn port_get(id: u32, name: &str) -> Option<Value> {
    match name {
        "onmessage" => Some(with_port(id, |p| p.receiver.onmessage.map_or(Value::Null, Value::Closure)).unwrap_or(Value::Null)),
        _ => None,
    }
}

pub fn port_set(id: u32, name: &str, value: &Value) -> Result<(), String> {
    match name {
        // Setting onmessage starts the port (the HTML spec's implicit start()).
        "onmessage" => {
            let closure = match value {
                Value::Closure(c) => Some(*c),
                _ => None,
            };
            with_port(id, |p| p.receiver.set_onmessage(closure));
            if closure.is_some() {
                start_port(id);
            }
            Ok(())
        }
        _ => Err(format!("cannot set '{name}' on a MessagePort")),
    }
}

pub const PORT_METHODS: &[&str] = &["postMessage", "start", "close", "addEventListener", "removeEventListener"];

pub fn port_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "postMessage" => {
            let data = clone_out(args.first().unwrap_or(&Value::Undefined))?;
            let Some(Some(other)) = with_port(id, |p| if p.receiver.closed { None } else { p.other }) else { return Ok(Value::Undefined) };
            let started = with_port(other, |p| {
                if !p.started {
                    p.waiting.push_back(data.clone());
                }
                p.started
            });
            if started == Some(true) {
                TASKS.with(|t| t.borrow_mut().push_back(Task::Port(other, data)));
            }
            Ok(Value::Undefined)
        }
        "start" => {
            start_port(id);
            Ok(Value::Undefined)
        }
        "close" => {
            let other = with_port(id, |p| {
                p.receiver.close();
                p.waiting.clear();
                p.other.take()
            })
            .flatten();
            // Disentangled: the other side's posts go nowhere from now on.
            if let Some(o) = other {
                with_port(o, |p| p.other = None);
            }
            Ok(Value::Undefined)
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1))
                && objects::to_display(kind) == "message"
            {
                with_port(id, |p| p.receiver.listen(name == "addEventListener", *c));
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

/// The program let go of a port's object: it closes, and its entry goes.
pub fn port_freed(id: u32) {
    let _ = port_call(id, "close", &[]);
    PORTS.with(|p| {
        if let Some(slot) = p.borrow_mut().get_mut(id as usize) {
            *slot = None;
        }
    });
}

// ── BroadcastChannel ───────────────────────────────────────────────────

/// Where a thread is woken from another (its loop sleeps on its pool, or in the window's message queue on main).
#[derive(Clone)]
pub enum Doorbell {
    Main,
    Pool(crate::modules::Waker),
}

impl Doorbell {
    pub fn here() -> Doorbell {
        if crate::render_thread::is_main_thread() { Doorbell::Main } else { Doorbell::Pool(crate::modules::waker()) }
    }

    pub fn ring(&self) {
        match self {
            Doorbell::Main => crate::window::wake(),
            Doorbell::Pool(w) => w.wake(),
        }
    }
}

/// Every open broadcast channel in the process, in creation order: its name, its thread, its id there, the thread's
/// doorbell.
struct Registered {
    name: String,
    thread: std::thread::ThreadId,
    id: u32,
    doorbell: Doorbell,
}

static REGISTRY: Mutex<Vec<Registered>> = Mutex::new(Vec::new());
/// Messages posted to a channel on another thread: (thread, its channel id, data). INBOX_LEN counts them, so a loop
/// turn checks without the lock.
static INBOX: Mutex<Vec<(std::thread::ThreadId, u32, Cloned)>> = Mutex::new(Vec::new());
static INBOX_LEN: AtomicUsize = AtomicUsize::new(0);

/// `new BroadcastChannel(name)`: its id on this thread.
pub fn new_broadcast(name: String) -> u32 {
    let id = BROADCASTS.with(|b| {
        let mut b = b.borrow_mut();
        b.push(Some((name.clone(), Receiver::default())));
        b.len() as u32 - 1
    });
    REGISTRY.lock().unwrap_or_else(|e| e.into_inner()).push(Registered { name, thread: std::thread::current().id(), id, doorbell: Doorbell::here() });
    id
}

fn with_broadcast<R>(id: u32, f: impl FnOnce(&mut (String, Receiver)) -> R) -> Option<R> {
    BROADCASTS.with(|b| b.borrow_mut().get_mut(id as usize).and_then(Option::as_mut).map(f))
}

pub fn broadcast_get(id: u32, name: &str) -> Option<Value> {
    match name {
        "name" => with_broadcast(id, |(n, _)| Value::Str(n.clone())),
        "onmessage" => Some(with_broadcast(id, |(_, r)| r.onmessage.map_or(Value::Null, Value::Closure)).unwrap_or(Value::Null)),
        "onmessageerror" => Some(Value::Null),
        _ => None,
    }
}

pub fn broadcast_set(id: u32, name: &str, value: &Value) -> Result<(), String> {
    match name {
        "onmessage" => {
            let closure = match value {
                Value::Closure(c) => Some(*c),
                _ => None,
            };
            with_broadcast(id, |(_, r)| r.set_onmessage(closure));
            Ok(())
        }
        "onmessageerror" => Ok(()),
        _ => Err(format!("cannot set '{name}' on a BroadcastChannel")),
    }
}

pub const BROADCAST_METHODS: &[&str] = &["postMessage", "close", "addEventListener", "removeEventListener"];

pub fn broadcast_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "postMessage" => {
            let Some((channel, closed)) = with_broadcast(id, |(n, r)| (n.clone(), r.closed)) else { return Ok(Value::Undefined) };
            if closed {
                return Err(crate::abi::throw(values::new_error("InvalidStateError", "Failed to execute 'postMessage' on 'BroadcastChannel': Channel is closed")));
            }
            let data = clone_out(args.first().unwrap_or(&Value::Undefined))?;
            let me = std::thread::current().id();
            // Every other channel of the name, in creation order: this thread's as tasks here, another's to its inbox.
            let targets: Vec<(std::thread::ThreadId, u32, Doorbell)> = REGISTRY
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .filter(|r| r.name == channel && !(r.thread == me && r.id == id))
                .map(|r| (r.thread, r.id, r.doorbell.clone()))
                .collect();
            for (thread, target, doorbell) in targets {
                if thread == me {
                    TASKS.with(|t| t.borrow_mut().push_back(Task::Broadcast(target, data.clone())));
                } else {
                    INBOX.lock().unwrap_or_else(|e| e.into_inner()).push((thread, target, data.clone()));
                    INBOX_LEN.fetch_add(1, Ordering::AcqRel);
                    doorbell.ring();
                }
            }
            Ok(Value::Undefined)
        }
        "close" => {
            with_broadcast(id, |(_, r)| r.close());
            unregister(id);
            Ok(Value::Undefined)
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1))
                && objects::to_display(kind) == "message"
            {
                with_broadcast(id, |(_, r)| r.listen(name == "addEventListener", *c));
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

fn unregister(id: u32) {
    let me = std::thread::current().id();
    REGISTRY.lock().unwrap_or_else(|e| e.into_inner()).retain(|r| !(r.thread == me && r.id == id));
}

/// The program let go of a channel's object: it closes, and its entry goes.
pub fn broadcast_freed(id: u32) {
    with_broadcast(id, |(_, r)| r.close());
    unregister(id);
    BROADCASTS.with(|b| {
        if let Some(slot) = b.borrow_mut().get_mut(id as usize) {
            *slot = None;
        }
    });
}

// ── delivery ───────────────────────────────────────────────────────────

/// This thread's messages from other threads, moved to its tasks.
fn take_inbox() {
    if INBOX_LEN.load(Ordering::Acquire) == 0 {
        return;
    }
    let me = std::thread::current().id();
    let mine: Vec<(u32, Cloned)> = {
        let mut inbox = INBOX.lock().unwrap_or_else(|e| e.into_inner());
        let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut *inbox).into_iter().partition(|(t, _, _)| *t == me);
        *inbox = rest;
        INBOX_LEN.fetch_sub(mine.len(), Ordering::AcqRel);
        mine.into_iter().map(|(_, id, c)| (id, c)).collect()
    };
    TASKS.with(|t| t.borrow_mut().extend(mine.into_iter().map(|(id, c)| Task::Broadcast(id, c))));
}

/// Message tasks wait on this thread (the loop's io_pending).
pub fn pending() -> bool {
    take_inbox();
    TASKS.with(|t| !t.borrow().is_empty())
}

/// Runs this thread's due message tasks, each a task of its own (microtasks run between them). True when a handler
/// threw: the exception stays pending and the loop reports it first.
pub fn run() -> bool {
    take_inbox();
    loop {
        let Some(task) = TASKS.with(|t| t.borrow_mut().pop_front()) else { return false };
        let handlers = match &task {
            Task::Port(id, _) => with_port(*id, |p| if p.receiver.closed { Vec::new() } else { p.receiver.handlers() }),
            Task::Broadcast(id, _) => with_broadcast(*id, |(_, r)| if r.closed { Vec::new() } else { r.handlers() }),
        }
        .unwrap_or_default();
        if handlers.is_empty() {
            continue;
        }
        let data = match &task {
            Task::Port(_, c) | Task::Broadcast(_, c) => c,
        };
        let _op = objects::Op::enter();
        let event = values::new_object();
        if let Value::Object(e) = event {
            let _ = values::set(e, "type", Value::Str("message".into()));
            let _ = values::set(e, "data", clone_in(data));
            let _ = values::set(e, "origin", Value::Str(String::new()));
            let _ = values::set(e, "lastEventId", Value::Str(String::new()));
        }
        for h in handlers {
            crate::abi::closure_retain(h);
            let threw = crate::abi::call_closure(h, std::slice::from_ref(&event)).is_err();
            crate::abi::closure_release(h);
            if threw {
                return true;
            }
        }
        drop(_op);
        values::run_jobs();
    }
}
