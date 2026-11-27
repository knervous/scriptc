//! The clipboard and the editing commands (a child module of dom.rs, over its document): Ctrl+C, Ctrl+X and Ctrl+V
//! (and Windows' Ctrl+Insert, Shift+Delete and Shift+Insert) as a browser takes them: a `copy`, `cut` or `paste`
//! ClipboardEvent (cancelable, its `clipboardData` a DataTransfer: setData during copy and cut, getData during paste)
//! at the focused field or editing host (else the selection's element, else the body), then, uncanceled, the default:
//! the selected text written to the system's clipboard (text/plain; a field's selection, or the document's), a cut's
//! selection deleted (`deleteByCut`), the clipboard's text pasted (`insertFromPaste`) into what is editable. A canceled
//! copy or cut writes what its listeners set. Ctrl+Z undoes and Ctrl+Y or Ctrl+Shift+Z redoes in the focused field or
//! editing host (`historyUndo`, `historyRedo`: text_field.rs, selection.rs). `navigator.clipboard`'s `readText` and
//! `writeText` (page.rs) read and write the same clipboard.
//!
//! The system's clipboard is the window's (window_windows.rs, CF_UNICODETEXT, "\r\n" there and "\n" here); without
//! one (another platform, no window) a clipboard of the process's own stands in.

use std::cell::RefCell;

use super::{Aux, Dom, InputFields, Mods, NodeId, Target, fire, focused_element, selection, str_of, text_field, with, with_quiet};
use crate::objects::{self, Value};

/// What a DataTransfer allows now (the HTML drag data store's modes).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// During copy and cut: setData, getData and clearData.
    ReadWrite,
    /// During paste: getData only.
    ReadOnly,
    /// After its event: nothing (getData answers "").
    Protected,
}

struct Transfer {
    /// (type, data), types lowercased, in the order they were set.
    items: Vec<(String, String)>,
    mode: Mode,
    /// clearData() was called (a canceled copy then clears the clipboard even with nothing set).
    cleared: bool,
    /// Objects naming it, and the event holding it.
    refs: u32,
}

#[derive(Default)]
struct State {
    transfers: Vec<Option<Transfer>>,
    free: Vec<usize>,
    /// The process's own clipboard (no system one, or it failed).
    local: Option<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

// ---- the system's clipboard ----------------------------------------------------------------------------------------

#[cfg(all(windows, feature = "window"))]
fn platform_read() -> Option<Option<String>> {
    crate::window::clipboard_text()
}

#[cfg(not(all(windows, feature = "window")))]
fn platform_read() -> Option<Option<String>> {
    None
}

#[cfg(all(windows, feature = "window"))]
fn platform_write(text: &str) -> bool {
    crate::window::set_clipboard_text(text)
}

#[cfg(not(all(windows, feature = "window")))]
fn platform_write(_text: &str) -> bool {
    false
}

/// The clipboard's text (None: it holds none). Line breaks are "\n".
pub fn read_text() -> Option<String> {
    match platform_read() {
        Some(text) => text.map(|t| t.replace("\r\n", "\n")),
        None => STATE.with(|s| s.borrow().local.clone()),
    }
}

/// Puts `text` on the clipboard (as text/plain).
pub fn write_text(text: &str) {
    if !platform_write(text) {
        STATE.with(|s| s.borrow_mut().local = Some(text.to_string()));
    }
}

// ---- DataTransfer ----------------------------------------------------------------------------------------------------

fn new_transfer(items: Vec<(String, String)>, mode: Mode) -> usize {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let t = Transfer { items, mode, cleared: false, refs: 1 };
        match s.free.pop() {
            Some(i) => {
                s.transfers[i] = Some(t);
                i
            }
            None => {
                s.transfers.push(Some(t));
                s.transfers.len() - 1
            }
        }
    })
}

/// One count fewer on the transfer (an object naming it, or its event, freed).
pub fn unref(slot: usize) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let gone = match s.transfers.get_mut(slot).and_then(|t| t.as_mut()) {
            Some(t) => {
                t.refs = t.refs.saturating_sub(1);
                t.refs == 0
            }
            None => false,
        };
        if gone {
            s.transfers[slot] = None;
            s.free.push(slot);
        }
    });
}

/// The DataTransfer object for `slot` (one more count on it).
pub fn transfer_value(slot: usize) -> Value {
    STATE.with(|s| {
        if let Some(Some(t)) = s.borrow_mut().transfers.get_mut(slot) {
            t.refs += 1;
        }
    });
    objects::aux_value(Aux::DataTransfer(slot))
}

fn with_transfer<R>(slot: usize, f: impl FnOnce(&mut Transfer) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().transfers.get_mut(slot).and_then(|t| t.as_mut()).map(f))
}

/// A format as the data store keys it: lowercased; "text" is text/plain and "url" text/uri-list.
fn format_of(v: Option<&Value>) -> String {
    let t = str_of(v).to_ascii_lowercase();
    match t.as_str() {
        "text" => "text/plain".into(),
        "url" => "text/uri-list".into(),
        _ => t,
    }
}

pub const TRANSFER_METHODS: &[&str] = &["getData", "setData", "clearData"];

pub fn transfer_get(slot: usize, name: &str) -> Option<Value> {
    Some(match name {
        "types" => {
            let types: Vec<Value> = with_transfer(slot, |t| if t.mode == Mode::Protected { Vec::new() } else { t.items.iter().map(|(k, _)| Value::Str(k.clone())).collect() }).unwrap_or_default();
            crate::values::new_array(&types)
        }
        "files" => crate::values::new_array(&[]),
        "dropEffect" => Value::Str("none".into()),
        "effectAllowed" => Value::Str("uninitialized".into()),
        _ => return None,
    })
}

pub fn transfer_call(slot: usize, name: &str, args: &[Value]) -> Result<Value, String> {
    let format = format_of(args.first());
    Ok(match name {
        "getData" => Value::Str(
            with_transfer(slot, |t| if t.mode == Mode::Protected { None } else { t.items.iter().find(|(k, _)| *k == format).map(|(_, v)| v.clone()) })
                .flatten()
                .unwrap_or_default(),
        ),
        "setData" => {
            let data = str_of(args.get(1));
            with_transfer(slot, |t| {
                if t.mode == Mode::ReadWrite {
                    t.items.retain(|(k, _)| *k != format);
                    t.items.push((format, data));
                }
            });
            Value::Undefined
        }
        "clearData" => {
            let all = matches!(args.first(), None | Some(Value::Undefined));
            with_transfer(slot, |t| {
                if t.mode == Mode::ReadWrite {
                    if all { t.items.clear() } else { t.items.retain(|(k, _)| *k != format) }
                    t.cleared = true;
                }
            });
            Value::Undefined
        }
        _ => return Err(format!("{name} is not a function")),
    })
}

// ---- the commands ------------------------------------------------------------------------------------------------

/// Where a clipboard event goes: the focused element when it is a field or an editing host, else the element the
/// selection starts in, else the body.
fn event_target(d: &mut Dom) -> NodeId {
    if let Some(f) = focused_element(d).filter(|f| text_field::is_field(d, *f) || selection::is_editing_host(d, *f)) {
        return f;
    }
    if let Some(n) = selection::selection_element(d) {
        return n;
    }
    focused_element(d).or_else(|| d.body()).unwrap_or_else(|| d.root())
}

/// A ClipboardEvent of `kind` at `target` holding `slot` (trusted, bubbling, cancelable): whether no listener canceled
/// it. The transfer is protected afterwards.
fn fire_clipboard(target: NodeId, kind: &str, slot: usize) -> Result<bool, String> {
    let ev = with(|d| {
        let ev = d.new_event(kind, true, true, true);
        if let Ok(e) = d.event(ev) {
            e.input = Some(Box::new(InputFields { transfer: Some(slot), ..Default::default() }));
        }
        ev
    });
    // The event holds a count on the transfer (dropped when it is freed: dom.rs aux_freed).
    STATE.with(|s| {
        if let Some(Some(t)) = s.borrow_mut().transfers.get_mut(slot) {
            t.refs += 1;
        }
    });
    let r = fire(Target::Node(target), ev);
    with_transfer(slot, |t| t.mode = Mode::Protected);
    r
}

/// What a copy copies at `target`: a field's selected text (none from a password field), else the selection's.
fn selected_text(target: NodeId) -> Option<String> {
    with(|d| {
        if text_field::is_field(d, target) {
            return text_field::selected_text(d, target);
        }
        selection::selected_text(d)
    })
    .filter(|t| !t.is_empty())
}

/// Ctrl+C (`cut`: Ctrl+X): the event, then the clipboard written (and a cut's selection deleted). False when there
/// was nothing to copy (the command is disabled: no event).
fn copy(cut: bool) -> Result<bool, String> {
    let target = with(event_target);
    let text = selected_text(target);
    // Copying is only offered for a selection (a collapsed one, or a password field's, copies nothing, and no event
    // fires), cutting only from what is editable.
    let editable = with(|d| text_field::is_editable_field(d, target) || selection::editing_host(d, target).is_some());
    if text.is_none() || (cut && !editable) {
        return Ok(false);
    }
    let slot = new_transfer(Vec::new(), Mode::ReadWrite);
    let proceed = fire_clipboard(target, if cut { "cut" } else { "copy" }, slot)?;
    if proceed {
        if let Some(t) = &text {
            write_text(t);
        }
        if cut {
            let still = with(|d| d.connected(target));
            if still {
                if with(|d| text_field::is_field(d, target)) {
                    text_field::delete_for_cut(target)?;
                } else {
                    selection::delete_for_cut(target)?;
                }
            }
        }
    } else {
        // A canceled event writes what its listeners put in the data store (nothing set and nothing cleared leaves
        // the clipboard as it was).
        let (plain, cleared) = with_transfer(slot, |t| (t.items.iter().find(|(k, _)| k == "text/plain").map(|(_, v)| v.clone()), t.cleared || !t.items.is_empty())).unwrap_or((None, false));
        match plain {
            Some(p) => write_text(&p),
            None if cleared => write_text(""),
            None => {}
        }
    }
    unref(slot);
    Ok(true)
}

/// Ctrl+V: the event (its data the clipboard's text), then the text inserted where it is editable.
fn paste() -> Result<(), String> {
    let target = with(event_target);
    let text = read_text();
    let items = text.iter().map(|t| ("text/plain".to_string(), t.clone())).collect();
    let slot = new_transfer(items, Mode::ReadOnly);
    let proceed = fire_clipboard(target, "paste", slot)?;
    unref(slot);
    let Some(text) = text.filter(|t| !t.is_empty()) else { return Ok(()) };
    if !proceed || !with(|d| d.connected(target)) {
        return Ok(());
    }
    if with(|d| text_field::is_field(d, target)) {
        text_field::paste(target, &text)?;
    } else if with(|d| selection::editing_host(d, target).is_some()) {
        selection::paste(target, &text)?;
    }
    Ok(())
}

/// The editing commands' keys, pressed and not canceled: Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Insert, Shift+Delete,
/// Shift+Insert, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z. True when the key was one of them (its default is this). Err when a
/// listener threw.
pub fn key_default(key: &str, mods: Mods) -> Result<bool, String> {
    let ctrl = (mods.ctrl && !mods.alt) || mods.meta;
    let letter = key.to_ascii_lowercase();
    enum Cmd {
        Copy,
        Cut,
        Paste,
        Undo,
        Redo,
    }
    let cmd = match (letter.as_str(), ctrl, mods.shift) {
        ("c", true, false) => Cmd::Copy,
        ("x", true, false) => Cmd::Cut,
        ("v", true, false) => Cmd::Paste,
        ("insert", true, false) => Cmd::Copy,
        ("insert", false, true) if !mods.alt => Cmd::Paste,
        ("delete", false, true) if !mods.alt => Cmd::Cut,
        ("z", true, false) => Cmd::Undo,
        ("z", true, true) | ("y", true, false) => Cmd::Redo,
        _ => return Ok(false),
    };
    match cmd {
        Cmd::Copy => {
            copy(false)?;
        }
        // Shift+Delete with nothing to cut is Delete.
        Cmd::Cut => {
            if !copy(true)? && letter == "delete" {
                return Ok(false);
            }
        }
        Cmd::Paste => paste()?,
        Cmd::Undo | Cmd::Redo => {
            let redo = matches!(cmd, Cmd::Redo);
            let target = with(focused_element);
            if let Some(t) = target {
                if with_quiet(|d| text_field::is_field(d, t)) {
                    text_field::history(t, redo)?;
                } else if let Some(host) = with_quiet(|d| selection::editing_host(d, t)) {
                    selection::history(host, redo)?;
                }
            }
        }
    }
    Ok(true)
}
