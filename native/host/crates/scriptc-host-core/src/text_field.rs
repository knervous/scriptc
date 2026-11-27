//! Text fields (a child module of dom.rs, over its document): `<input>` of a text type and `<textarea>`, edited as a
//! browser edits them. Blitz keeps each field's text, selection and layout in a parley `PlainEditor` (blitz-dom
//! TextInputData, made when the field is laid out) and draws its text, selection and caret (blitz-paint
//! `draw_text_input_text`); this module is the browser's side: the default actions of a key pressed in the focused
//! field (typing, Backspace and Delete, the arrows, Home and End, Ctrl for words, Shift extending the selection, Ctrl+A),
//! each edit announced by `beforeinput` (cancelable) and `input` and held to `maxlength`; a press, a double or triple
//! press and a drag placing the selection; `change` when a field the user edited loses the focus or takes Enter;
//! Enter's implicit submission of the field's form; a label's click focusing its field; a submit button's click
//! submitting its form; and the members `value`, `selectionStart`, `selectionEnd`, `selectionDirection`,
//! `setSelectionRange()`, `select()`.
//!
//! Also: undo and redo (`historyUndo`, `historyRedo`; a run of typing is one step, as a browser keeps it), the
//! clipboard's side in a field (clipboard.rs: the selected text, `deleteByCut`, `insertFromPaste`), a password
//! field's value kept apart from the mask it shows (blitz-dom TextInputData::secret: the editor holds one bullet per
//! character), the selection of a field the keyboard focused, and a checkbox's or radio button's activation (checked
//! before its click is dispatched, put back when the click is canceled, else `input` and `change`).
//!
//! Offsets are the DOM's (UTF-16 code units); the editor's are bytes of its text, and for a masked field bytes of the
//! mask (the value's bytes are mapped by character).
//!
//! Not here: IME composition.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use blitz_dom::{MASK_CHAR, NodeId, TextInputPointer, byte_to_utf16, masked, utf16_to_byte};

use super::{Dom, InputFields, Mods, fire_input, fire_input_with, fire_plain, focused_element, repaint, with, with_quiet};

thread_local! {
    /// The focused field's value when it took the focus (or when it last fired `change`), and whether the user has
    /// edited it since: `change` fires when it leaves edited and different.
    static CHANGE_BASE: RefCell<Option<(NodeId, String, bool)>> = const { RefCell::new(None) };
    /// A field pressed with the main button still down: the pointer's moves extend its selection.
    static DRAGGING: Cell<Option<NodeId>> = const { Cell::new(None) };
    /// Each edited field's undo and redo steps.
    static HISTORY: RefCell<HashMap<NodeId, History>> = RefCell::new(HashMap::new());
}

/// A field's value and selection (value bytes: anchor, focus), as undo puts it back.
#[derive(Clone)]
struct Snap {
    value: String,
    anchor: usize,
    focus: usize,
}

#[derive(Default)]
struct History {
    undo: Vec<Snap>,
    redo: Vec<Snap>,
    /// The last step is typing the caret has not left since: the next character typed joins it.
    typing: bool,
}

/// The input types whose value is a line of text the user edits (Blitz gives each an editor).
fn text_type(t: &str) -> bool {
    matches!(t, "text" | "search" | "url" | "tel" | "password" | "email" | "number")
}

/// Whether `n` is a text field: a `<textarea>`, or an `<input>` of a text type.
pub fn is_field(d: &Dom, n: NodeId) -> bool {
    match d.tag(n).as_deref() {
        Some("textarea") => true,
        Some("input") => text_type(&d.read_attr(n, "type").map(|t| t.to_ascii_lowercase()).unwrap_or_else(|| "text".into())),
        _ => false,
    }
}

/// Whether the selection members apply (`selectionStart` and the rest): text, search, URL, telephone and password
/// inputs and textareas (email and number answer null, as a browser's do).
pub fn has_selection_api(d: &Dom, n: NodeId) -> bool {
    match d.tag(n).as_deref() {
        Some("textarea") => true,
        Some("input") => matches!(d.read_attr(n, "type").map(|t| t.to_ascii_lowercase()).as_deref(), None | Some("text" | "search" | "url" | "tel" | "password")),
        _ => false,
    }
}

/// The field's value as its editor holds it (None before it is laid out: Blitz makes the editor then): a masked
/// field's secret, else the editor's text.
fn editor_text(d: &Dom, n: NodeId) -> Option<String> {
    d.doc.get_node(n)?.element_data()?.text_input_data().map(|t| t.value())
}

/// Whether the field shows a mask (a password field).
fn is_masked(d: &Dom, n: NodeId) -> bool {
    d.doc.get_node(n).and_then(|x| x.element_data()).and_then(|e| e.text_input_data()).is_some_and(|t| t.secret.is_some())
}

/// The value byte at shown byte `byte` (a masked field's mask maps by character).
fn shown_to_value(d: &Dom, n: NodeId, value: &str, byte: usize) -> usize {
    if !is_masked(d, n) {
        return byte.min(value.len());
    }
    let chars = byte / MASK_CHAR.len_utf8();
    value.char_indices().nth(chars).map_or(value.len(), |(i, _)| i)
}

/// The shown byte for value byte `byte`.
fn value_to_shown(d: &Dom, n: NodeId, value: &str, byte: usize) -> usize {
    if !is_masked(d, n) {
        return byte;
    }
    value[..byte.min(value.len())].chars().count() * MASK_CHAR.len_utf8()
}

/// The field's value becomes `text` with the selection (value bytes) at (anchor, focus): the editor's text (a masked
/// field's secret and its mask) and selection. False when the field has no editor.
fn put(d: &mut Dom, n: NodeId, text: &str, anchor: usize, focus: usize) -> bool {
    let (shown, a, f) = if is_masked(d, n) {
        if let Some(t) = d.doc.get_node_mut(n).and_then(|x| x.element_data_mut()).and_then(|e| e.text_input_data_mut()) {
            t.secret = Some(text.to_string());
        }
        let unit = MASK_CHAR.len_utf8();
        (masked(text), text[..anchor.min(text.len())].chars().count() * unit, text[..focus.min(text.len())].chars().count() * unit)
    } else {
        (text.to_string(), anchor, focus)
    };
    d.doc
        .edit_text_input(n, |driver| {
            if driver.editor.raw_text() != shown {
                driver.editor.set_text(&shown);
            }
            driver.select_byte_range(a, f);
        })
        .is_some()
}

fn snapshot(d: &Dom, n: NodeId) -> Snap {
    let (anchor, focus) = selection_bytes(d, n).unwrap_or_default();
    Snap { value: value(d, n), anchor, focus }
}

/// The caret moved (a key, a press, the page): the next character typed starts a step of its own.
fn break_typing(n: NodeId) {
    HISTORY.with(|h| {
        if let Some(h) = h.borrow_mut().get_mut(&n) {
            h.typing = false;
        }
    });
}

/// Before an edit of `input_type`: the field as it is goes on its undo stack (a character typed after typing joins
/// the step before), and the redo stack is dropped.
fn remember(n: NodeId, input_type: &str) {
    let snap = with_quiet(|d| snapshot(d, n));
    let typing = input_type == "insertText";
    HISTORY.with(|h| {
        let mut h = h.borrow_mut();
        let h = h.entry(n).or_default();
        if !(typing && h.typing && !h.undo.is_empty()) {
            h.undo.push(snap);
            // A browser keeps a bounded history.
            if h.undo.len() > 100 {
                h.undo.remove(0);
            }
        }
        h.redo.clear();
        h.typing = typing;
    });
}

/// Ctrl+Z (`redo`: Ctrl+Y, Ctrl+Shift+Z) in the field: `beforeinput` (cancelable), the field put back as it was,
/// `input`. Nothing to undo: nothing happens.
pub fn history(n: NodeId, redo: bool) -> Result<(), String> {
    if !with_quiet(|d| is_editable_field(d, n)) {
        return Ok(());
    }
    let has = HISTORY.with(|h| h.borrow().get(&n).is_some_and(|h| if redo { !h.redo.is_empty() } else { !h.undo.is_empty() }));
    if !has {
        return Ok(());
    }
    let input_type = if redo { "historyRedo" } else { "historyUndo" };
    if !fire_input(n, "beforeinput", edit_fields(input_type, None), true)? {
        return Ok(());
    }
    let now = with_quiet(|d| snapshot(d, n));
    let Some(to) = HISTORY.with(|h| {
        let mut h = h.borrow_mut();
        let h = h.get_mut(&n)?;
        let to = if redo { h.redo.pop() } else { h.undo.pop() }?;
        if redo { h.undo.push(now) } else { h.redo.push(now) }
        h.typing = false;
        Some(to)
    }) else {
        return Ok(());
    };
    if !with(|d| put(d, n, &to.value, to.anchor, to.focus)) {
        return Ok(());
    }
    repaint();
    edited(n);
    fire_input_with(n, "input", edit_fields(input_type, None), true, false)?;
    Ok(())
}

/// Replaces the value's bytes `lo..hi` with `text`, the caret after it (a masked field's edits: the value edited and
/// the mask shown anew).
fn replace_range(d: &mut Dom, n: NodeId, lo: usize, hi: usize, text: &str) -> bool {
    let value = value(d, n);
    let (lo, hi) = (lo.min(value.len()), hi.min(value.len()));
    let new = format!("{}{}{}", &value[..lo], text, &value[hi..]);
    let at = lo + text.len();
    put(d, n, &new, at, at)
}

/// The field's value: its editor's text, else (not laid out yet) its default value.
pub fn value(d: &Dom, n: NodeId) -> String {
    editor_text(d, n).unwrap_or_else(|| default_value(d, n))
}

/// The field's default value: a textarea's text, an input's `value` attribute.
pub fn default_value(d: &Dom, n: NodeId) -> String {
    if d.tag(n).as_deref() == Some("textarea") {
        d.doc.get_node(n).map(|node| node.text_content()).unwrap_or_default()
    } else {
        d.read_attr(n, "value").unwrap_or_default()
    }
}

/// The editor's selection as (anchor, focus) bytes of the value.
fn selection_bytes(d: &Dom, n: NodeId) -> Option<(usize, usize)> {
    let t = d.doc.get_node(n)?.element_data()?.text_input_data()?;
    let s = t.editor.raw_selection();
    let (a, f) = (s.anchor().index(), s.focus().index());
    let value = t.value();
    Some((shown_to_value(d, n, &value, a), shown_to_value(d, n, &value, f)))
}

/// The selected text, for a copy (None when the selection is collapsed, and always from a password field: a browser
/// copies none from one).
pub fn selected_text(d: &Dom, n: NodeId) -> Option<String> {
    if is_masked(d, n) || d.read_attr(n, "type").is_some_and(|t| t.eq_ignore_ascii_case("password")) {
        return None;
    }
    let text = value(d, n);
    let (a, f) = selection_bytes(d, n)?;
    let (lo, hi) = (a.min(f), a.max(f));
    (lo < hi).then(|| text[lo..hi].to_string())
}

/// Whether the user may edit the field (not disabled, not read-only).
pub fn is_editable_field(d: &Dom, n: NodeId) -> bool {
    is_field(d, n) && d.read_attr(n, "disabled").is_none() && d.read_attr(n, "readonly").is_none()
}

/// What a paste inserts in the field: a single line's line breaks become spaces (Chromium's), a textarea's are "\n";
/// held to `maxlength` with the selection given back. None when nothing fits.
fn fitted(d: &Dom, n: NodeId, text: &str) -> Option<String> {
    let text = if d.tag(n).as_deref() == Some("textarea") {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.replace("\r\n", " ").replace(['\r', '\n'], " ")
    };
    let Some(max) = d.read_attr(n, "maxlength").and_then(|m| m.trim().parse::<usize>().ok()) else {
        return (!text.is_empty()).then_some(text);
    };
    let value = value(d, n);
    let (a, f) = selection_bytes(d, n).unwrap_or((value.len(), value.len()));
    let (lo, hi) = (a.min(f), a.max(f));
    let kept = value.encode_utf16().count() - value[lo..hi].encode_utf16().count();
    let room = max.saturating_sub(kept);
    let mut units = 0;
    let fitted: String = text.chars().take_while(|c| {
        units += c.len_utf16();
        units <= room
    }).collect();
    (!fitted.is_empty()).then_some(fitted)
}

/// Pastes `text` into the field (clipboard.rs, its paste event not canceled): `beforeinput` and `input` of
/// `insertFromPaste`, the text in place of the selection.
pub fn paste(n: NodeId, text: &str) -> Result<(), String> {
    let Some(text) = with(|d| {
        if !is_editable_field(d, n) {
            return None;
        }
        super::resolve_doc(&mut d.doc, "text_field");
        editor_text(d, n)?;
        fitted(d, n, text)
    }) else {
        return Ok(());
    };
    if !fire_input(n, "beforeinput", edit_fields("insertFromPaste", Some(&text)), true)? {
        return Ok(());
    }
    if !with(|d| d.connected(n) && is_field(d, n)) {
        return Ok(());
    }
    remember(n, "insertFromPaste");
    with(|d| {
        let (a, f) = selection_bytes(d, n).unwrap_or_default();
        replace_range(d, n, a.min(f), a.max(f), &text);
    });
    repaint();
    edited(n);
    fire_input_with(n, "input", edit_fields("insertFromPaste", Some(&text)), true, false)?;
    Ok(())
}

/// A cut's deletion of the field's selection (clipboard.rs, after it copied it): `deleteByCut`.
pub fn delete_for_cut(n: NodeId) -> Result<(), String> {
    let has = with_quiet(|d| is_editable_field(d, n) && selection_bytes(d, n).is_some_and(|(a, f)| a != f));
    if !has || !fire_input(n, "beforeinput", edit_fields("deleteByCut", None), true)? {
        return Ok(());
    }
    if !with(|d| d.connected(n) && is_field(d, n)) {
        return Ok(());
    }
    remember(n, "deleteByCut");
    with(|d| {
        let (a, f) = selection_bytes(d, n).unwrap_or_default();
        replace_range(d, n, a.min(f), a.max(f), "");
    });
    repaint();
    edited(n);
    fire_input_with(n, "input", edit_fields("deleteByCut", None), true, false)?;
    Ok(())
}

/// `selectionStart`, `selectionEnd` and `selectionDirection` (UTF-16 offsets): a field not laid out yet has its caret
/// at the end of its value.
pub fn selection(d: &Dom, n: NodeId) -> (usize, usize, &'static str) {
    let text = value(d, n);
    let Some((a, f)) = selection_bytes(d, n) else {
        let end = text.encode_utf16().count();
        return (end, end, "none");
    };
    let (a16, f16) = (byte_to_utf16(&text, a), byte_to_utf16(&text, f));
    let dir = if a == f { "none" } else if f < a { "backward" } else { "forward" };
    (a16.min(f16), a16.max(f16), dir)
}

/// `field.value = text`: the editor's text (the caret at its end, as a browser puts it). False when the field has no
/// editor yet (the caller seeds its default value instead).
pub fn set_value(d: &mut Dom, n: NodeId, text: &str) -> bool {
    let text: String = if d.tag(n).as_deref() == Some("textarea") {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        // An input's value has no line breaks.
        text.chars().filter(|c| !matches!(c, '\n' | '\r')).collect()
    };
    let Some(old) = editor_text(d, n) else { return false };
    if old != text {
        put(d, n, &text, text.len(), text.len());
    }
    // A value the page set ends the field's undo history, as a browser's does.
    HISTORY.with(|h| h.borrow_mut().remove(&n));
    // A value the page set is the one `change` compares against.
    CHANGE_BASE.with(|b| {
        if let Some((_, base, edited)) = b.borrow_mut().as_mut().filter(|(m, ..)| *m == n) {
            *base = text.clone();
            *edited = false;
        }
    });
    repaint();
    true
}

/// `setSelectionRange(start, end, direction)` (UTF-16 offsets, clamped to the value; an end before the start is the
/// start): a backward direction puts the focus at the start.
pub fn set_selection_range(n: NodeId, start: usize, end: usize, direction: &str) {
    with(|d| {
        super::resolve_doc(&mut d.doc, "text_field");
        let text = value(d, n);
        let len = text.encode_utf16().count();
        let end = end.min(len);
        let start = start.min(end);
        let (s, e) = (utf16_to_byte(&text, start), utf16_to_byte(&text, end));
        let (anchor, focus) = if direction == "backward" { (e, s) } else { (s, e) };
        let (anchor, focus) = (value_to_shown(d, n, &text, anchor), value_to_shown(d, n, &text, focus));
        d.doc.edit_text_input(n, |driver| driver.select_byte_range(anchor, focus));
    });
    break_typing(n);
    super::caret_activity();
    repaint();
}

/// `select()`: the whole value selected (the field keeps or takes no focus: a browser's select() does not focus).
pub fn select_all(n: NodeId) {
    with(|d| {
        super::resolve_doc(&mut d.doc, "text_field");
        d.doc.edit_text_input(n, |driver| driver.select_all());
    });
    break_typing(n);
    repaint();
}

/// The keyboard (Tab) moved the focus to `n`: a field's whole value is selected, as a browser selects it.
pub fn focused_by_keyboard(n: NodeId) {
    if with_quiet(|d| is_field(d, n)) {
        select_all(n);
    }
}

// ---- focus and change ---------------------------------------------------------------------------------------------

/// The focus leaves `old` for `new`: an edited field that changed fires `change` first (before its `blur`), and the
/// field taking the focus is remembered as it is.
pub fn focus_moving(old: Option<NodeId>, new: Option<NodeId>) -> Result<(), String> {
    if let Some(n) = old {
        commit_change(n)?;
    }
    let base = new.and_then(|n| with_quiet(|d| is_field(d, n).then(|| (n, value(d, n), false))));
    CHANGE_BASE.with(|b| *b.borrow_mut() = base);
    Ok(())
}

/// `change` at the field when the user edited it and its value differs from the last one it was committed at.
fn commit_change(n: NodeId) -> Result<(), String> {
    let base = CHANGE_BASE.with(|b| b.borrow().clone()).filter(|(m, ..)| *m == n);
    let Some((_, before, true)) = base else { return Ok(()) };
    let now = with_quiet(|d| value(d, n));
    CHANGE_BASE.with(|b| *b.borrow_mut() = Some((n, now.clone(), false)));
    if now != before {
        fire_plain(n, "change", true)?;
    }
    Ok(())
}

fn edited(n: NodeId) {
    CHANGE_BASE.with(|b| match b.borrow_mut().as_mut() {
        Some((m, _, edited)) if *m == n => *edited = true,
        _ => {}
    });
}

// ---- the pointer ---------------------------------------------------------------------------------------------------

/// A press of the main button at viewport CSS px (x, y) that left the focus in the field `target`: the caret where it
/// landed (Shift extends the selection; a double press selects a word, a third the line), and the drag that follows
/// extends it.
pub fn press(target: NodeId, x: f64, y: f64, clicks: u32, shift: bool) {
    let placed = with(|d| {
        if focused_element(d) != Some(target) || !is_field(d, target) {
            return false;
        }
        super::resolve_doc(&mut d.doc, "text_field");
        d.doc.text_input_pointer(target, x, y, TextInputPointer::Press { clicks, shift })
    });
    if placed {
        DRAGGING.with(|g| g.set(Some(target)));
        break_typing(target);
        repaint();
    }
}

/// The mouse moved to (x, y) with `buttons` held: a drag begun in a field extends its selection.
pub fn drag(x: f64, y: f64, buttons: u16) {
    let Some(n) = DRAGGING.with(|g| g.get()) else { return };
    if buttons & 1 == 0 {
        DRAGGING.with(|g| g.set(None));
        return;
    }
    if with(|d| d.doc.text_input_pointer(n, x, y, TextInputPointer::Drag)) {
        repaint();
    }
}

/// The main button went up: the drag ends.
pub fn release() {
    DRAGGING.with(|g| g.set(None));
}

// ---- activation ----------------------------------------------------------------------------------------------------

/// The element's form owner: its `form` attribute's form, else its nearest form ancestor.
pub fn form_of(d: &Dom, n: NodeId) -> Option<NodeId> {
    if let Some(id) = d.read_attr(n, "form") {
        return d.doc.get_element_by_id(&id).filter(|f| d.tag(*f).as_deref() == Some("form"));
    }
    let mut at = d.parent(n);
    while let Some(p) = at {
        if d.tag(p).as_deref() == Some("form") {
            return Some(p);
        }
        at = d.parent(p);
    }
    None
}

/// A submit button: a `<button>` of type submit (its default), an `<input>` of type submit or image.
fn is_submit_button(d: &Dom, n: NodeId) -> bool {
    let ty = d.read_attr(n, "type").map(|t| t.to_ascii_lowercase());
    match d.tag(n).as_deref() {
        // An unknown type is a submit button's.
        Some("button") => !matches!(ty.as_deref(), Some("button" | "reset")),
        Some("input") => matches!(ty.as_deref(), Some("submit" | "image")),
        _ => false,
    }
}

/// The elements under `root` in tree order.
fn descendants(d: &Dom, root: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack: Vec<NodeId> = d.children(root).into_iter().rev().collect();
    while let Some(n) = stack.pop() {
        if d.is_element(n) {
            out.push(n);
        }
        stack.extend(d.children(n).into_iter().rev());
    }
    out
}

/// Submits `form` (from `submitter`, the button that did it, if one did): `submit` at the form, cancelable. A page's
/// form natively has nowhere to navigate, so an uncanceled submission ends there.
fn submit(form: NodeId) -> Result<(), String> {
    fire_input_with(form, "submit", InputFields::default(), true, true)?;
    Ok(())
}

/// A checkbox or radio button (an `<input>` of that type).
fn checkable(d: &Dom, n: NodeId) -> Option<bool> {
    if d.tag(n).as_deref() != Some("input") {
        return None;
    }
    match d.read_attr(n, "type").map(|t| t.to_ascii_lowercase()).as_deref() {
        Some("checkbox") => Some(false),
        Some("radio") => Some(true),
        _ => None,
    }
}

fn is_checked(d: &Dom, n: NodeId) -> bool {
    match d.doc.get_node(n).and_then(|x| x.element_data()).and_then(|e| e.checkbox_input_checked()) {
        Some(c) => c,
        None => d.read_attr(n, "checked").is_some_and(|v| v != "false"),
    }
}

/// A checkable input's checkedness set (Blitz's state; before it is laid out, the attribute, as `checked = x` does).
pub fn set_checked(d: &mut Dom, n: NodeId, on: bool) {
    if !d.doc.set_input_checked(n, on) {
        // Not laid out yet: Blitz makes its state from the attribute's presence.
        let q = blitz_dom::QualName::new(None, blitz_dom::ns!(), blitz_dom::LocalName::from("checked"));
        if on { d.mutate().set_attribute(n, q, "true") } else { d.mutate().clear_attribute(n, q) }
    }
    repaint();
}

/// What a click's activation changed before its dispatch: the input, whether it was checked, and (a radio button)
/// which of its group was.
pub struct Toggled {
    input: NodeId,
    was: bool,
    group_was: Option<NodeId>,
}

/// The radio buttons of `n`'s group: those of its name in its form (or, outside one, in the document).
fn radio_group(d: &Dom, n: NodeId) -> Vec<NodeId> {
    let Some(name) = d.read_attr(n, "name").filter(|v| !v.is_empty()) else { return vec![n] };
    let form = form_of(d, n);
    let root = form.unwrap_or_else(|| d.root());
    descendants(d, root)
        .into_iter()
        .filter(|r| checkable(d, *r) == Some(true) && d.read_attr(*r, "name").as_deref() == Some(name.as_str()) && form_of(d, *r) == form)
        .collect()
}

/// A click about to be dispatched at `target`: a checkbox toggles, a radio button is checked (its group's other
/// unchecked), before the click's listeners run (the HTML legacy-pre-activation behavior). None when `target` is no
/// enabled checkable input.
pub fn pre_activation(target: NodeId) -> Option<Toggled> {
    with(|d| {
        let radio = checkable(d, target)?;
        if d.read_attr(target, "disabled").is_some() {
            return None;
        }
        let was = is_checked(d, target);
        if !radio {
            set_checked(d, target, !was);
            return Some(Toggled { input: target, was, group_was: None });
        }
        let group = radio_group(d, target);
        let group_was = group.iter().copied().find(|r| is_checked(d, *r));
        for r in group {
            set_checked(d, r, r == target);
        }
        Some(Toggled { input: target, was, group_was })
    })
}

/// The click was dispatched: canceled, the input is put back as it was; else (when it changed) `input` and `change`
/// at it (both bubbling).
pub fn post_activation(t: Toggled, canceled: bool) -> Result<(), String> {
    if canceled {
        with(|d| {
            if checkable(d, t.input) == Some(true) {
                for r in radio_group(d, t.input) {
                    set_checked(d, r, Some(r) == t.group_was);
                }
            } else {
                set_checked(d, t.input, t.was);
            }
        });
        return Ok(());
    }
    let changed = with_quiet(|d| is_checked(d, t.input) != t.was && d.connected(t.input));
    if changed {
        fire_input_with(t.input, "input", InputFields::default(), true, false)?;
        fire_plain(t.input, "change", true)?;
    }
    Ok(())
}

/// A click at `target` (dispatched by `fire_click`, which answers whether no listener canceled it) with the
/// activation a browser runs around it: a checkable input's pre-activation before it, and after it, uncanceled, the
/// default action (`click_activation`).
pub fn click_with_activation(target: NodeId, fire_click: impl FnOnce() -> Result<bool, String>) -> Result<(), String> {
    let toggled = pre_activation(target);
    let go = fire_click()?;
    if let Some(t) = toggled {
        return post_activation(t, !go);
    }
    if go {
        click_activation(target)?;
    }
    Ok(())
}

/// A click's default action at `target` (the main button's, not canceled): a submit button submits its form; a
/// label focuses its control and clicks it (a click on the control itself, or on another control inside the label,
/// is that control's).
pub fn click_activation(target: NodeId) -> Result<(), String> {
    enum Act {
        Submit(NodeId),
        Label(NodeId),
    }
    let act = with_quiet(|d| {
        let mut at = Some(target);
        while let Some(n) = at {
            if !d.is_element(n) {
                at = d.parent(n);
                continue;
            }
            let disabled = d.read_attr(n, "disabled").is_some();
            match d.tag(n).as_deref() {
                Some("button" | "input") if is_submit_button(d, n) => {
                    return if disabled { None } else { form_of(d, n).map(Act::Submit) };
                }
                // Another interactive element: its own activation (none here).
                Some("button" | "input" | "select" | "textarea" | "a") => return None,
                Some("label") => {
                    let control = match d.read_attr(n, "for") {
                        Some(id) => d.doc.get_element_by_id(&id),
                        None => descendants(d, n).into_iter().find(|c| matches!(d.tag(*c).as_deref(), Some("input" | "textarea" | "select" | "button"))),
                    };
                    return control.filter(|c| d.read_attr(*c, "disabled").is_none() && d.read_attr(*c, "type").is_none_or(|t| !t.eq_ignore_ascii_case("hidden"))).map(Act::Label);
                }
                _ => {}
            }
            at = d.parent(n);
        }
        None
    });
    match act {
        Some(Act::Submit(form)) => submit(form),
        // A label's activation: its control focused (a browser's mouse focus), then clicked (a checkbox toggles).
        Some(Act::Label(control)) => {
            let old = with(focused_element);
            if old != Some(control) {
                super::change_focus(old, Some(control))?;
            }
            if with_quiet(|d| !is_field(d, control)) {
                click_with_activation(control, || {
                    let ev = with(|d| d.new_event("click", true, true, false));
                    super::fire(super::Target::Node(control), ev)
                })?;
            }
            Ok(())
        }
        None => Ok(()),
    }
}

/// Enter in a single-line field: `change` (when edited), then the form's implicit submission: its default button
/// clicked (the first submit button, when not disabled), else the form submitted when this is its only field.
fn implicit_submission(n: NodeId) -> Result<(), String> {
    commit_change(n)?;
    enum Then {
        Click(NodeId),
        Submit(NodeId),
    }
    let then = with_quiet(|d| {
        let form = form_of(d, n)?;
        let all = descendants(d, form);
        if let Some(button) = all.iter().copied().find(|b| is_submit_button(d, *b)) {
            return (d.read_attr(button, "disabled").is_none()).then_some(Then::Click(button));
        }
        let fields = all.iter().filter(|f| d.tag(**f).as_deref() == Some("input") && is_field(d, **f)).count();
        (fields == 1).then_some(Then::Submit(form))
    });
    match then {
        Some(Then::Click(button)) => {
            let ev = with(|d| d.new_event("click", true, true, false));
            if super::fire(super::Target::Node(button), ev)? {
                click_activation(button)?;
            }
            Ok(())
        }
        Some(Then::Submit(form)) => submit(form),
        None => Ok(()),
    }
}

// ---- keys ----------------------------------------------------------------------------------------------------------

/// An edit's `beforeinput` and `input` (InputEvent `inputType` and `data`).
fn edit_fields(input_type: &str, data: Option<&str>) -> InputFields {
    InputFields { input_type: input_type.to_string(), data: data.map(str::to_string), ..Default::default() }
}

/// A key pressed in the field `target` that no listener canceled: the field's default action. False when `target` is
/// no text field (the caller's other defaults apply); Err when a listener threw.
pub fn key_default(target: NodeId, key: &str, mods: Mods) -> Result<bool, String> {
    let Some((multiline, editable, max_len)) = with(|d| {
        if !is_field(d, target) {
            return None;
        }
        super::resolve_doc(&mut d.doc, "text_field");
        editor_text(d, target)?;
        let multiline = d.tag(target).as_deref() == Some("textarea");
        let editable = d.read_attr(target, "disabled").is_none() && d.read_attr(target, "readonly").is_none();
        let max_len = d.read_attr(target, "maxlength").and_then(|m| m.trim().parse::<usize>().ok());
        Some((multiline, editable, max_len))
    }) else {
        return Ok(false);
    };
    // Ctrl moves and deletes by words (Windows' and Linux's; Alt on a Mac); Ctrl or Meta makes the rest shortcuts.
    let word = mods.ctrl;
    let shortcut = (mods.ctrl && !mods.alt) || mods.meta;
    let shift = mods.shift;
    // A password field is one word: Ctrl moves and deletes to its ends.
    let masked_field = with_quiet(|d| is_masked(d, target));
    let caret = |f: &dyn Fn(&mut Dom)| {
        with(f);
        break_typing(target);
        repaint();
    };
    match key {
        "a" | "A" if shortcut && !shift => {
            caret(&|d| {
                d.doc.edit_text_input(target, |e| e.select_all());
            });
            return Ok(true);
        }
        "ArrowLeft" | "ArrowRight" if word && masked_field => {
            let left = key == "ArrowLeft";
            caret(&|d| {
                d.doc.edit_text_input(target, |e| match (left, shift) {
                    (true, true) => e.select_to_text_start(),
                    (true, false) => e.move_to_text_start(),
                    (false, true) => e.select_to_text_end(),
                    (false, false) => e.move_to_text_end(),
                });
            });
            return Ok(true);
        }
        "ArrowLeft" | "ArrowRight" => {
            let left = key == "ArrowLeft";
            caret(&|d| {
                d.doc.edit_text_input(target, |e| match (left, word, shift) {
                    (true, true, true) => e.select_word_left(),
                    (true, true, false) => e.move_word_left(),
                    (true, false, true) => e.select_left(),
                    (true, false, false) => e.move_left(),
                    (false, true, true) => e.select_word_right(),
                    (false, true, false) => e.move_word_right(),
                    (false, false, true) => e.select_right(),
                    (false, false, false) => e.move_right(),
                });
            });
            return Ok(true);
        }
        // Up and Down move by lines in a textarea; in a single line they go to its start and end, as Chrome's do.
        "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown" | "Home" | "End" => {
            let back = matches!(key, "ArrowUp" | "PageUp" | "Home");
            let whole = (word && matches!(key, "Home" | "End")) || (!multiline && !matches!(key, "Home" | "End"));
            let by_line = multiline && matches!(key, "ArrowUp" | "ArrowDown");
            caret(&|d| {
                d.doc.edit_text_input(target, |e| match (by_line, whole, back, shift) {
                    (true, _, true, true) => e.select_up(),
                    (true, _, true, false) => e.move_up(),
                    (true, _, false, true) => e.select_down(),
                    (true, _, false, false) => e.move_down(),
                    (false, true, true, true) => e.select_to_text_start(),
                    (false, true, true, false) => e.move_to_text_start(),
                    (false, true, false, true) => e.select_to_text_end(),
                    (false, true, false, false) => e.move_to_text_end(),
                    (false, false, true, true) => e.select_to_line_start(),
                    (false, false, true, false) => e.move_to_line_start(),
                    (false, false, false, true) => e.select_to_line_end(),
                    (false, false, false, false) => e.move_to_line_end(),
                });
            });
            return Ok(true);
        }
        "Enter" if !multiline => {
            implicit_submission(target)?;
            return Ok(true);
        }
        _ => {}
    }
    if !editable || (shortcut && !matches!(key, "Backspace" | "Delete")) {
        return Ok(true);
    }
    // An edit: what it is, then beforeinput, the change, input.
    #[derive(Clone)]
    enum Edit {
        Insert(String),
        Back,
        Forward,
    }
    let (text, (anchor, focus)) = with_quiet(|d| (value(d, target), selection_bytes(d, target).unwrap_or_default()));
    let collapsed = anchor == focus;
    let (edit, input_type) = match key {
        "Backspace" => (Edit::Back, if word && collapsed { "deleteWordBackward" } else { "deleteContentBackward" }),
        "Delete" => (Edit::Forward, if word && collapsed { "deleteWordForward" } else { "deleteContentForward" }),
        "Enter" => (Edit::Insert("\n".into()), "insertLineBreak"),
        k if k.chars().count() == 1 && !k.chars().any(char::is_control) => (Edit::Insert(k.to_string()), "insertText"),
        _ => return Ok(true),
    };
    // Nothing to delete at the field's edge: no edit, no events.
    match edit {
        Edit::Back if collapsed && anchor == 0 => return Ok(true),
        Edit::Forward if collapsed && anchor >= text.len() => return Ok(true),
        _ => {}
    }
    // maxlength holds the user's insertions to its length (UTF-16 units), the selection they replace given back.
    let edit = match (edit, max_len) {
        (Edit::Insert(s), Some(max)) => {
            let (lo, hi) = (anchor.min(focus), anchor.max(focus));
            let kept = text.encode_utf16().count() - text[lo..hi].encode_utf16().count();
            let room = max.saturating_sub(kept);
            let mut units = 0;
            let fitted: String = s.chars().take_while(|c| {
                units += c.len_utf16();
                units <= room
            }).collect();
            if fitted.is_empty() {
                return Ok(true);
            }
            Edit::Insert(fitted)
        }
        (e, _) => e,
    };
    let data = match &edit {
        Edit::Insert(s) if input_type == "insertText" => Some(s.clone()),
        _ => None,
    };
    if !fire_input(target, "beforeinput", edit_fields(input_type, data.as_deref()), true)? {
        return Ok(true);
    }
    remember(target, input_type);
    // A listener may have taken the field away.
    let applied = with(|d| {
        if !d.connected(target) || !is_field(d, target) {
            return None;
        }
        // A masked field's edit is the value's (the mask shown anew): its selection, else the character beside the
        // caret (with Ctrl, all of the value on that side).
        if is_masked(d, target) {
            let value = value(d, target);
            let (a, f) = selection_bytes(d, target).unwrap_or_default();
            let (lo, hi) = (a.min(f), a.max(f));
            let (lo, hi, insert) = match &edit {
                Edit::Insert(s) => (lo, hi, s.as_str()),
                _ if lo != hi => (lo, hi, ""),
                Edit::Back if word => (0, lo, ""),
                Edit::Back => (value[..lo].char_indices().next_back().map_or(0, |(i, _)| i), lo, ""),
                Edit::Forward if word => (lo, value.len(), ""),
                Edit::Forward => (lo, value[lo..].chars().next().map_or(lo, |c| lo + c.len_utf8()), ""),
            };
            return replace_range(d, target, lo, hi, insert).then_some(());
        }
        d.doc.edit_text_input(target, |e| match &edit {
            Edit::Insert(s) => e.insert_or_replace_selection(s),
            Edit::Back if word => e.backdelete_word(),
            Edit::Back => e.backdelete(),
            Edit::Forward if word => e.delete_word(),
            Edit::Forward => e.delete(),
        })
    });
    if applied.is_none() {
        return Ok(true);
    }
    repaint();
    edited(target);
    fire_input_with(target, "input", edit_fields(input_type, data.as_deref()), true, false)?;
    Ok(true)
}
