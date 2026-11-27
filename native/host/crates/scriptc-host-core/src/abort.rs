//! `AbortController` and `AbortSignal`: `new AbortController()`, its `signal` (one object for the controller's life),
//! `abort(reason)`; a signal's `aborted`, `reason`, `onabort`, `addEventListener("abort", ...)`, `throwIfAborted()`.
//! Aborting fires `abort` at the signal (`{ type, target }`) and rejects the page's `fetch()` calls made with it (with
//! the signal's reason, an AbortError by default), as a browser's do; the request itself still runs to its end on the
//! network thread and its answer is dropped. Not carried: `AbortSignal.abort()`, `.timeout()`, `.any()`.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use crate::objects::Value;
use crate::values;

/// A signal's state, shared by its controller and its object.
#[derive(Default)]
pub struct Signal {
    aborted: Cell<bool>,
    /// The reason (held here once set).
    reason: RefCell<Option<Value>>,
    onabort: Cell<Option<u64>>,
    listeners: RefCell<Vec<u64>>,
    /// The signal's object (not held: its release frees this state's holds), the events' target.
    object: Cell<u64>,
    /// Promises of fetches made with it, held until it aborts or goes.
    fetches: RefCell<Vec<u64>>,
}

impl Signal {
    pub fn set_object(&self, r: u64) {
        self.object.set(r);
    }

    pub fn aborted(&self) -> bool {
        self.aborted.get()
    }

    pub fn reason(&self) -> Value {
        self.reason.borrow().clone().unwrap_or(Value::Undefined)
    }

    /// A fetch made with this signal: its promise rejects if the signal aborts first.
    pub fn watch(&self, promise: u64) {
        crate::objects::retain(promise);
        self.fetches.borrow_mut().push(promise);
    }

    /// The signal's object went: what it held lets go.
    pub fn freed(&self) {
        self.object.set(0);
        if let Some(c) = self.onabort.take() {
            crate::abi::closure_release(c);
        }
        for c in std::mem::take(&mut *self.listeners.borrow_mut()) {
            crate::abi::closure_release(c);
        }
        for p in std::mem::take(&mut *self.fetches.borrow_mut()) {
            crate::objects::release(p);
        }
        if let Some(reason) = self.reason.borrow_mut().take() {
            values::release_value(reason);
        }
    }
}

pub fn new_signal() -> Rc<Signal> {
    Rc::new(Signal::default())
}

/// `controller.abort(reason)`: once; the fetches reject, then `abort` fires.
fn abort(s: &Signal, reason: Option<&Value>) -> Result<(), String> {
    if s.aborted.replace(true) {
        return Ok(());
    }
    let reason = match reason {
        Some(v) if !matches!(v, Value::Undefined) => v.clone(),
        _ => values::new_error("AbortError", "signal is aborted without reason"),
    };
    values::retain_value(&reason);
    *s.reason.borrow_mut() = Some(reason.clone());
    for p in std::mem::take(&mut *s.fetches.borrow_mut()) {
        values::settle(p, true, &reason);
        crate::objects::release(p);
    }
    let handlers: Vec<u64> = s.onabort.get().into_iter().chain(s.listeners.borrow().iter().copied()).collect();
    if handlers.is_empty() {
        return Ok(());
    }
    let event = values::new_object();
    if let Value::Object(e) = event {
        values::set(e, "type", Value::Str("abort".into()))?;
        if s.object.get() != 0 {
            values::set(e, "target", Value::Object(s.object.get()))?;
            values::set(e, "currentTarget", Value::Object(s.object.get()))?;
        }
    }
    for h in handlers {
        crate::abi::closure_retain(h);
        let threw = crate::abi::call_closure(h, std::slice::from_ref(&event)).is_err();
        crate::abi::closure_release(h);
        if threw {
            // A listener's exception is reported, as an event listener's is, and the rest still run.
            crate::dom::report_exception("an abort listener");
        }
    }
    Ok(())
}

pub fn controller_call(s: &Signal, name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "abort" => abort(s, args.first()).map(|()| Value::Undefined),
        _ => Err(format!("AbortController.{name} is not a function")),
    }
}

pub fn signal_get(s: &Signal, name: &str) -> Option<Value> {
    Some(match name {
        "aborted" => Value::Bool(s.aborted.get()),
        "reason" => s.reason(),
        "onabort" => s.onabort.get().map_or(Value::Null, Value::Closure),
        _ => return None,
    })
}

pub fn signal_set(s: &Signal, name: &str, value: &Value) -> Result<(), String> {
    if name != "onabort" {
        return Err(format!("cannot set '{name}' on an AbortSignal"));
    }
    let closure = match value {
        Value::Closure(c) => Some(*c),
        _ => None,
    };
    if let Some(c) = closure {
        crate::abi::closure_retain(c);
    }
    if let Some(old) = s.onabort.replace(closure) {
        crate::abi::closure_release(old);
    }
    Ok(())
}

pub const SIGNAL_METHODS: &[&str] = &["addEventListener", "removeEventListener", "throwIfAborted"];

pub fn signal_call(s: &Signal, name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1))
                && crate::objects::to_display(kind) == "abort"
            {
                let mut listeners = s.listeners.borrow_mut();
                let at = listeners.iter().position(|l| l == c);
                match (name == "addEventListener", at) {
                    (true, None) => {
                        crate::abi::closure_retain(*c);
                        listeners.push(*c);
                    }
                    (false, Some(i)) => {
                        listeners.remove(i);
                        crate::abi::closure_release(*c);
                    }
                    _ => {}
                }
            }
            Ok(Value::Undefined)
        }
        "throwIfAborted" => {
            if s.aborted.get() {
                let reason = s.reason();
                return Err(crate::abi::throw(reason));
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("AbortSignal.{name} is not a function")),
    }
}
