//! `ResizeObserver` and `MutationObserver` natively, answered as a browser answers them:
//! - `new ResizeObserver(callback)`; `observe(target)`, `unobserve(target)`, `disconnect()`. Once a frame, after the
//!   frame's callbacks and a layout pass ([`deliver`]), every observed element whose content box changed since its last
//!   delivery (or was just observed) becomes an entry `{ target, contentRect }` (`x`, `y`, `width`, `height`, `top`,
//!   `left`, `right`, `bottom`: the content box in CSS px, its origin at the padding edge), and each observer with
//!   entries is called with `(entries, observer)`. `borderBoxSize` / `contentBoxSize` are not here yet.
//! - `new MutationObserver(callback)`; `observe(target, options)`, `disconnect()`, `takeRecords()`. Once a frame, an
//!   observer with targets whose document changed since its last delivery is called with `(records, observer)`. The
//!   records list is empty: the host notices that the document changed, not which node did, and the callers re-read
//!   the document; the options are accepted and not narrowed.

use std::cell::RefCell;

use blitz_dom::NodeId;

use crate::objects::{self, Value};
use crate::{abi, dom, values};

struct Observer {
    resize: bool,
    /// The compiled callback (one count held).
    callback: u64,
    /// The observer's own host object (one count held: a delivery passes it, so it lives with the page).
    handle: u64,
    /// Observed elements; for a ResizeObserver, the content box last delivered (None: not yet delivered).
    targets: Vec<(NodeId, Option<[f32; 4]>)>,
    /// For a MutationObserver: the document's mutation count at the last delivery (or at observe).
    seen: u64,
}

thread_local! {
    static OBSERVERS: RefCell<Vec<Option<Observer>>> = const { RefCell::new(Vec::new()) };
}

/// `new ResizeObserver(callback)` / `new MutationObserver(callback)`: the observer's index, for its host object.
pub fn construct(resize: bool, args: &[Value]) -> Result<u32, String> {
    let Some(Value::Closure(callback)) = args.first() else {
        let name = if resize { "ResizeObserver" } else { "MutationObserver" };
        return Err(format!("Failed to construct '{name}': parameter 1 is not of type 'Function'."));
    };
    abi::closure_retain(*callback);
    Ok(OBSERVERS.with(|o| {
        let mut o = o.borrow_mut();
        o.push(Some(Observer { resize, callback: *callback, handle: 0, targets: Vec::new(), seen: 0 }));
        o.len() as u32 - 1
    }))
}

/// The observer's host object, once made (deliveries pass it as the callback's second argument).
pub fn set_handle(id: u32, handle: u64) {
    OBSERVERS.with(|o| {
        if let Some(Some(obs)) = o.borrow_mut().get_mut(id as usize) {
            objects::retain(handle);
            obs.handle = handle;
        }
    });
}

pub fn has_method(resize: bool, name: &str) -> bool {
    if resize { matches!(name, "observe" | "unobserve" | "disconnect") } else { matches!(name, "observe" | "disconnect" | "takeRecords") }
}

/// `observer.name(...)`.
pub fn call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    let target = args.first().and_then(|v| match v {
        Value::Object(r) => objects::node_of(*r),
        _ => None,
    });
    let now = dom::mutation_count();
    OBSERVERS.with(|o| {
        let mut o = o.borrow_mut();
        let Some(Some(obs)) = o.get_mut(id as usize) else { return Ok(Value::Undefined) };
        match name {
            "observe" => {
                let kind = if obs.resize { "ResizeObserver" } else { "MutationObserver" };
                let target = target.ok_or_else(|| format!("Failed to execute 'observe' on '{kind}': parameter 1 is not of type '{}'.", if obs.resize { "Element" } else { "Node" }))?;
                if !obs.targets.iter().any(|(t, _)| *t == target) {
                    obs.targets.push((target, None));
                }
                if !obs.resize {
                    obs.seen = now;
                }
                Ok(Value::Undefined)
            }
            "unobserve" => {
                if let Some(target) = target {
                    obs.targets.retain(|(t, _)| *t != target);
                }
                Ok(Value::Undefined)
            }
            "disconnect" => {
                obs.targets.clear();
                Ok(Value::Undefined)
            }
            // No records are kept natively (the callers re-read the document).
            "takeRecords" => Ok(values::new_array(&[])),
            other => Err(format!("{other} is not a function")),
        }
    })
}

fn rect_object([x, y, w, h]: [f32; 4]) -> Value {
    let rect = values::new_object();
    if let Value::Object(r) = rect {
        for (k, v) in [("x", x), ("y", y), ("width", w), ("height", h), ("left", x), ("top", y), ("right", x + w), ("bottom", y + h)] {
            let _ = values::set(r, k, Value::Number(f64::from(v)));
        }
    }
    rect
}

/// Once a frame (window.rs, after the frame's callbacks): the observers with something to report are called.
pub fn deliver() {
    // SCRIPTC_HOST_TRACE_CALLS counts the window's frames here (once each, after its callbacks).
    abi::calls::frame();
    let _trace = abi::calls::span(|| "observers deliver".to_string());
    // One operation: the entries made here drop their own counts when it ends (the callback's arguments hold them).
    let _op = objects::Op::enter();
    let count = OBSERVERS.with(|o| o.borrow().len());
    if count == 0 {
        return;
    }
    dom::resolve_layout();
    let mutations = dom::mutation_count();
    for i in 0..count {
        // What this observer reports, recorded as delivered.
        let due = OBSERVERS.with(|o| {
            let mut o = o.borrow_mut();
            let obs = o.get_mut(i)?.as_mut()?;
            if obs.resize {
                let mut changed = Vec::new();
                for (target, last) in obs.targets.iter_mut() {
                    let Some(now) = dom::content_box(*target) else { continue };
                    if *last != Some(now) {
                        *last = Some(now);
                        changed.push((*target, now));
                    }
                }
                (!changed.is_empty()).then_some((obs.callback, obs.handle, Some(changed)))
            } else {
                let due = !obs.targets.is_empty() && obs.seen != mutations;
                obs.seen = mutations;
                due.then_some((obs.callback, obs.handle, None))
            }
        });
        let Some((callback, handle, changed)) = due else { continue };
        let list = match changed {
            Some(changed) => {
                let entries: Vec<Value> = changed.into_iter().map(|(target, rect)| {
                    let entry = values::new_object();
                    if let Value::Object(e) = entry {
                        let _ = values::set(e, "target", Value::Object(objects::node_ref(target)));
                        let _ = values::set(e, "contentRect", rect_object(rect));
                    }
                    entry
                }).collect();
                values::new_array(&entries)
            }
            None => values::new_array(&[]),
        };
        let name = if OBSERVERS.with(|o| o.borrow().get(i).and_then(|o| o.as_ref()).is_some_and(|o| o.resize)) { "ResizeObserver" } else { "MutationObserver" };
        if abi::call_closure(callback, &[list, Value::Object(handle)]).is_err() {
            eprintln!("{name} callback threw");
        }
    }
}
