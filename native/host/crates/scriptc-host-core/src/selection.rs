//! Selection, Range and editing (a child module of dom.rs, over its document): the DOM's `Range` (boundary points
//! kept live across the document's mutations), the Selection API (`window.getSelection()`, `document.getSelection()`),
//! `DocumentFragment` (`document.createDocumentFragment()`, `range.cloneContents()`), and the default actions a
//! browser takes for a key pressed in an editing host (an element whose `contenteditable` makes it editable): text
//! inserted at the caret, Backspace and Delete, the caret moved by the arrows, Home and End, Ctrl+A, each edit
//! announced by `beforeinput` (cancelable) and `input`. The caret is drawn by Blitz (blitz-dom caret.rs) while the
//! editing host holding the selection has the focus.
//!
//! Offsets are the DOM's: UTF-16 code units in a text node's data, child indices in an element. The arrows, Backspace
//! and Delete step over grapheme clusters as the text is shaped, Home and End go to the ends of the line as it is laid
//! out and Up and Down to the line above and below (Blitz's caret.rs `caret_moved`; Ctrl+Home and Ctrl+End to the
//! host's ends). A non-collapsed selection is highlighted (Blitz's text selection, painted by blitz-paint).
//!
//! Undo and redo: each edit the editing actions make is recorded as the DOM changes it made (a text node's data
//! replaced, a node inserted, a node removed), undone by their inverse on the same nodes and redone by the inverse of
//! that, with the selection as it was; a run of typing is one step. A change the page made since (an inverse that no
//! longer applies) drops the host's history, as nothing can be undone across it.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use blitz_dom::{CaretMove, EditingCaret, NodeData, NodeId};

use super::{Aux, Dom, InputFields, Mods, dom_error, fire_input, fire_input_with, html_name, node_value, repaint, str_of, with, with_quiet};
use crate::objects::{self, Value};

type Point = (NodeId, usize);

struct RangeSlot {
    start: Point,
    end: Point,
    /// Objects naming it, and the selection when it is the selection's range.
    refs: u32,
}

#[derive(Default)]
struct State {
    ranges: Vec<Option<RangeSlot>>,
    free: Vec<usize>,
    /// The selection's range, and whether its anchor is the range's end (a selection made backwards).
    selection: Option<usize>,
    backward: bool,
    /// The elements standing for DocumentFragments (Blitz has no fragment node: a detached element holds the
    /// children, and the DOM members answer as a fragment's).
    fragments: HashSet<NodeId>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
    /// The DOM changes of the edit being made (Some while an editing action records).
    static RECORDING: RefCell<Option<Vec<Op>>> = const { RefCell::new(None) };
    /// Each editing host's undo and redo steps.
    static HISTORIES: RefCell<HashMap<NodeId, History>> = RefCell::new(HashMap::new());
}

/// One DOM change an edit made.
enum Op {
    /// A text node's data went from `old` to `new`.
    Text { node: NodeId, old: String, new: String },
    /// `node` went into `parent`.
    Inserted { node: NodeId, parent: NodeId },
    /// `node` left `parent`, where it stood before `next`.
    Removed { node: NodeId, parent: NodeId, next: Option<NodeId> },
}

/// An undoable step: its changes, and the selection (anchor, focus) before and after it.
struct Step {
    ops: Vec<Op>,
    before: (Point, Point),
    after: (Point, Point),
    /// Typing the caret has not left since: the next character typed joins it.
    typing: bool,
}

#[derive(Default)]
struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
}

fn record(op: Op) {
    RECORDING.with(|r| {
        if let Some(ops) = r.borrow_mut().as_mut() {
            ops.push(op);
        }
    });
}

/// `id` is leaving its parent (Dom::detach): recorded while an edit records.
pub fn record_removed(d: &Dom, id: NodeId) {
    if RECORDING.with(|r| r.borrow().is_none()) {
        return;
    }
    if let Some(parent) = d.parent(id) {
        record(Op::Removed { node: id, parent, next: d.sibling(id, 1, false) });
    }
}

/// `id` went into its parent (Dom::insert_before, Dom::append): recorded while an edit records.
pub fn record_inserted(d: &Dom, id: NodeId) {
    if RECORDING.with(|r| r.borrow().is_none()) {
        return;
    }
    if let Some(parent) = d.parent(id) {
        record(Op::Inserted { node: id, parent });
    }
}

/// Runs `f` recording the DOM changes it makes.
fn recorded<R>(f: impl FnOnce() -> R) -> (R, Vec<Op>) {
    RECORDING.with(|r| *r.borrow_mut() = Some(Vec::new()));
    let out = f();
    let ops = RECORDING.with(|r| r.borrow_mut().take()).unwrap_or_default();
    (out, ops)
}

/// An edit made in `host`: a step on its undo stack (typing after typing, from where it left the caret, joins it),
/// its redo stack dropped.
fn push_step(host: NodeId, ops: Vec<Op>, before: (Point, Point), after: (Point, Point), typing: bool) {
    if ops.is_empty() {
        return;
    }
    HISTORIES.with(|h| {
        let mut h = h.borrow_mut();
        let h = h.entry(host).or_default();
        h.redo.clear();
        if typing
            && let Some(last) = h.undo.last_mut()
            && last.typing
            && last.after == before
        {
            last.ops.extend(ops);
            last.after = after;
            return;
        }
        h.undo.push(Step { ops, before, after, typing });
        if h.undo.len() > 100 {
            h.undo.remove(0);
        }
    });
}

/// The caret moved in `host`: the next character typed starts a step of its own.
fn break_typing(host: NodeId) {
    HISTORIES.with(|h| {
        if let Some(last) = h.borrow_mut().get_mut(&host).and_then(|h| h.undo.last_mut()) {
            last.typing = false;
        }
    });
}

/// Undoes `ops` (their inverses, last first, on the same nodes). False when one no longer applies (the page changed
/// the document since).
fn apply_inverse(d: &mut Dom, ops: &[Op]) -> bool {
    for op in ops.iter().rev() {
        match op {
            Op::Text { node, old, new } => {
                if d.doc.get_node(*node).is_none() || text_of(d, *node) != *new {
                    return false;
                }
                let len = node_length(d, *node);
                replace_data(d, *node, 0, len, old);
            }
            Op::Inserted { node, parent } => {
                if d.parent(*node) != Some(*parent) {
                    return false;
                }
                d.detach(*node);
            }
            Op::Removed { node, parent, next } => {
                if d.parent(*node).is_some() || d.doc.get_node(*parent).is_none() || next.is_some_and(|x| d.parent(x) != Some(*parent)) {
                    return false;
                }
                if d.insert_before(*parent, *node, *next).is_err() {
                    return false;
                }
            }
        }
    }
    true
}

/// Ctrl+Z (`redo`: Ctrl+Y, Ctrl+Shift+Z) in the editing host: `beforeinput` (cancelable), the last step undone (or
/// redone) and the selection put back, `input`. Nothing to undo: nothing happens.
pub fn history(host: NodeId, redo: bool) -> Result<(), String> {
    let has = HISTORIES.with(|h| h.borrow().get(&host).is_some_and(|h| if redo { !h.redo.is_empty() } else { !h.undo.is_empty() }));
    if !has {
        return Ok(());
    }
    let input_type = if redo { "historyRedo" } else { "historyUndo" };
    if !fire_input(host, "beforeinput", edit_fields(input_type, None), true)? {
        return Ok(());
    }
    let Some(step) = HISTORIES.with(|h| {
        let mut h = h.borrow_mut();
        let h = h.get_mut(&host)?;
        if redo { h.redo.pop() } else { h.undo.pop() }
    }) else {
        return Ok(());
    };
    let (ok, ops) = recorded(|| with(|d| apply_inverse(d, &step.ops)));
    if !ok {
        HISTORIES.with(|h| h.borrow_mut().remove(&host));
        sync_caret();
        return Ok(());
    }
    let back = Step { ops, before: step.after, after: step.before, typing: false };
    let (anchor, focus) = back.after;
    HISTORIES.with(|h| {
        let mut h = h.borrow_mut();
        let h = h.entry(host).or_default();
        if redo { h.undo.push(back) } else { h.redo.push(back) }
    });
    let (anchor, focus) = with_quiet(|d| (fixed(d, anchor), fixed(d, focus)));
    select_points(anchor, focus);
    fire_input_with(host, "input", edit_fields(input_type, None), true, false)?;
    Ok(())
}

// ---- ranges --------------------------------------------------------------------------------------------------------

fn new_range(start: Point, end: Point, refs: u32) -> usize {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let slot = RangeSlot { start, end, refs };
        match s.free.pop() {
            Some(i) => {
                s.ranges[i] = Some(slot);
                i
            }
            None => {
                s.ranges.push(Some(slot));
                s.ranges.len() - 1
            }
        }
    })
}

fn unref(slot: usize) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let gone = match s.ranges.get_mut(slot).and_then(|r| r.as_mut()) {
            Some(r) => {
                r.refs = r.refs.saturating_sub(1);
                r.refs == 0
            }
            None => false,
        };
        if gone {
            s.ranges[slot] = None;
            s.free.push(slot);
        }
    });
}

/// A Range object for `slot` (one more count on it, dropped when the object is freed: [`aux_freed`]).
fn range_value(slot: usize) -> Value {
    STATE.with(|s| {
        if let Some(Some(r)) = s.borrow_mut().ranges.get_mut(slot) {
            r.refs += 1;
        }
    });
    objects::aux_value(Aux::Range(slot))
}

fn bounds(slot: usize) -> Result<(Point, Point), String> {
    STATE.with(|s| s.borrow().ranges.get(slot).and_then(|r| r.as_ref()).map(|r| (r.start, r.end))).ok_or_else(|| "a released range".to_string())
}

fn set_bounds(slot: usize, start: Point, end: Point) {
    STATE.with(|s| {
        if let Some(Some(r)) = s.borrow_mut().ranges.get_mut(slot) {
            r.start = start;
            r.end = end;
        }
    });
}

/// Every live boundary point, updated by `f` (the document's mutations keep ranges live through it).
fn each_point(mut f: impl FnMut(&mut Point)) {
    STATE.with(|s| {
        for r in s.borrow_mut().ranges.iter_mut().flatten() {
            f(&mut r.start);
            f(&mut r.end);
        }
    });
}

pub fn aux_freed(slot: usize) {
    unref(slot);
}

// ---- tree order --------------------------------------------------------------------------------------------------

fn node_length(d: &Dom, n: NodeId) -> usize {
    match d.doc.get_node(n).map(|n| &n.data) {
        Some(NodeData::Text(t)) => t.content.encode_utf16().count(),
        Some(NodeData::Comment { contents }) => contents.encode_utf16().count(),
        Some(_) => d.children(n).len(),
        None => 0,
    }
}

fn is_text(d: &Dom, n: NodeId) -> bool {
    matches!(d.doc.get_node(n).map(|n| &n.data), Some(NodeData::Text(_)))
}

fn is_char_data(d: &Dom, n: NodeId) -> bool {
    matches!(d.doc.get_node(n).map(|n| &n.data), Some(NodeData::Text(_) | NodeData::Comment { .. }))
}

fn text_of(d: &Dom, n: NodeId) -> String {
    match d.doc.get_node(n).map(|n| &n.data) {
        Some(NodeData::Text(t)) => t.content.clone(),
        Some(NodeData::Comment { contents }) => contents.clone(),
        _ => String::new(),
    }
}

fn index_of(d: &Dom, n: NodeId) -> usize {
    d.parent(n).and_then(|p| d.children(p).iter().position(|c| *c == n)).unwrap_or(0)
}

/// `n` and its ancestors, the root first.
fn chain(d: &Dom, n: NodeId) -> Vec<NodeId> {
    let mut out = vec![n];
    let mut at = n;
    while let Some(p) = d.parent(at) {
        out.push(p);
        at = p;
    }
    out.reverse();
    out
}

fn is_inclusive_ancestor(d: &Dom, a: NodeId, b: NodeId) -> bool {
    let mut at = Some(b);
    while let Some(n) = at {
        if n == a {
            return true;
        }
        at = d.parent(n);
    }
    false
}

/// The DOM's boundary point comparison: where `a` lies relative to `b` (nodes in different trees compare equal).
fn compare(d: &Dom, a: Point, b: Point) -> Ordering {
    if a.0 == b.0 {
        return a.1.cmp(&b.1);
    }
    let (ca, cb) = (chain(d, a.0), chain(d, b.0));
    if ca[0] != cb[0] {
        return Ordering::Equal;
    }
    let common = ca.iter().zip(cb.iter()).take_while(|(x, y)| x == y).count();
    if common == ca.len() {
        // a's node is an ancestor of b's: the child of a's node holding b, against a's offset.
        let child = cb[common];
        return if index_of(d, child) < a.1 { Ordering::Greater } else { Ordering::Less };
    }
    if common == cb.len() {
        let child = ca[common];
        return if index_of(d, child) < b.1 { Ordering::Less } else { Ordering::Greater };
    }
    index_of(d, ca[common]).cmp(&index_of(d, cb[common]))
}

fn root_of(d: &Dom, n: NodeId) -> NodeId {
    chain(d, n)[0]
}

/// A boundary point made valid again (its node gone, or its offset past the node's length after a change the range
/// was not told of).
fn fixed(d: &Dom, p: Point) -> Point {
    if d.doc.get_node(p.0).is_none() {
        return (d.root(), 0);
    }
    (p.0, p.1.min(node_length(d, p.0)))
}

/// A node argument (`parameter i` of `what`).
fn node_arg(args: &[Value], i: usize, what: &str) -> Result<NodeId, String> {
    match args.get(i) {
        Some(Value::Object(r)) => objects::node_id(*r).ok_or_else(|| format!("Failed to execute '{what}': parameter {} is not of type 'Node'.", i + 1)),
        _ => Err(format!("Failed to execute '{what}': parameter {} is not of type 'Node'.", i + 1)),
    }
}

fn offset_arg(args: &[Value], i: usize) -> usize {
    match args.get(i) {
        Some(Value::Number(x)) if x.is_finite() && *x > 0.0 => *x as usize,
        _ => 0,
    }
}

fn check_point(d: &Dom, p: Point) -> Result<(), String> {
    if d.doc.get_node(p.0).is_none() {
        return Err(dom_error("InvalidNodeTypeError", "the node no longer exists"));
    }
    if p.1 > node_length(d, p.0) {
        return Err(dom_error("IndexSizeError", format!("there is no child at offset {}", p.1)));
    }
    Ok(())
}

/// The DOM's "set the start" (`start`) or "set the end" of a range.
fn set_point(d: &Dom, slot: usize, p: Point, start: bool) -> Result<(), String> {
    check_point(d, p)?;
    let (s, e) = bounds(slot)?;
    let (s, e) = (fixed(d, s), fixed(d, e));
    let other_tree = root_of(d, p.0) != root_of(d, if start { e.0 } else { s.0 });
    if start {
        let e = if other_tree || compare(d, p, e) == Ordering::Greater { p } else { e };
        set_bounds(slot, p, e);
    } else {
        let s = if other_tree || compare(d, p, s) == Ordering::Less { p } else { s };
        set_bounds(slot, s, p);
    }
    Ok(())
}

// ---- live ranges: the document's mutations -----------------------------------------------------------------------

/// `id` leaves its parent (Dom::detach): points inside it move to where it was; points after it in the parent move
/// back one.
pub fn node_removed(d: &Dom, id: NodeId) {
    let Some(parent) = d.parent(id) else { return };
    let index = index_of(d, id);
    each_point(|p| {
        if is_inclusive_ancestor(d, id, p.0) {
            *p = (parent, index);
        } else if p.0 == parent && p.1 > index {
            p.1 -= 1;
        }
    });
}

/// A node goes into `parent` at child `index` (Dom::insert_before): points after it in the parent move on one.
pub fn node_inserted(parent: NodeId, index: usize) {
    each_point(|p| {
        if p.0 == parent && p.1 > index {
            p.1 += 1;
        }
    });
}

/// A text node's data was replaced whole (`data`, `nodeValue`, `textContent`): points in it go to its start.
pub fn text_reset(id: NodeId) {
    each_point(|p| {
        if p.0 == id {
            p.1 = 0;
        }
    });
}

/// The DOM's "replace data": `count` UTF-16 units at `offset` of a text node's data become `data`, the ranges in it
/// kept where the DOM keeps them.
fn replace_data(d: &mut Dom, node: NodeId, offset: usize, count: usize, data: &str) {
    let content = text_of(d, node);
    let len = content.encode_utf16().count();
    let offset = offset.min(len);
    let count = count.min(len - offset);
    let (b0, b1) = (blitz_dom::utf16_to_byte(&content, offset), blitz_dom::utf16_to_byte(&content, offset + count));
    let new = format!("{}{}{}", &content[..b0], data, &content[b1..]);
    if new != content {
        record(Op::Text { node, old: content.clone(), new: new.clone() });
    }
    match d.doc.get_node(node).map(|n| &n.data) {
        Some(NodeData::Text(_)) => d.mutate().set_node_text(node, &new),
        Some(NodeData::Comment { .. }) => d.set_comment(node, &new),
        _ => return,
    }
    let added = data.encode_utf16().count();
    each_point(|p| {
        if p.0 == node {
            if p.1 > offset && p.1 <= offset + count {
                p.1 = offset;
            } else if p.1 > offset + count {
                p.1 = p.1 + added - count;
            }
        }
    });
}

/// The DOM's `splitText`: the data from `offset` on goes to a new text node after `node`; answers it.
fn split_text(d: &mut Dom, node: NodeId, offset: usize) -> Result<NodeId, String> {
    let content = text_of(d, node);
    let len = content.encode_utf16().count();
    if offset > len {
        return Err(dom_error("IndexSizeError", "the offset is past the text's end"));
    }
    let tail = content[blitz_dom::utf16_to_byte(&content, offset)..].to_string();
    let new = d.mutate().create_text_node(&tail);
    if let Some(parent) = d.parent(node) {
        let next = d.sibling(node, 1, false);
        d.insert_before(parent, new, next)?;
        let index = index_of(d, node);
        each_point(|p| {
            if p.0 == node && p.1 > offset {
                *p = (new, p.1 - offset);
            } else if p.0 == parent && p.1 == index + 1 {
                p.1 += 1;
            }
        });
    }
    replace_data(d, node, offset, len - offset, "");
    Ok(new)
}

// ---- fragments ---------------------------------------------------------------------------------------------------

pub fn is_fragment(n: NodeId) -> bool {
    STATE.with(|s| s.borrow().fragments.contains(&n))
}

fn new_fragment(d: &mut Dom) -> NodeId {
    let n = d.mutate().create_element(html_name("div"), vec![]);
    STATE.with(|s| s.borrow_mut().fragments.insert(n));
    n
}

/// `document.createDocumentFragment()`.
pub fn create_fragment() -> Value {
    node_value(Some(with(new_fragment)))
}

fn shallow_clone(d: &mut Dom, n: NodeId) -> Result<NodeId, String> {
    let data = d.node(n)?.data.clone();
    Ok(match data {
        NodeData::Element(e) | NodeData::AnonymousBlock(e) => d.mutate().create_element(e.name.clone(), e.attrs().to_vec()),
        NodeData::Text(t) => d.mutate().create_text_node(&t.content),
        NodeData::Comment { contents } => d.mutate().create_comment_node(&contents),
        _ => return Err(dom_error("NotSupportedError", "this node cannot be cloned")),
    })
}

/// Moves a fragment's children to the end of `to`.
fn append_fragment(d: &mut Dom, frag: NodeId, to: NodeId) -> Result<(), String> {
    for c in d.children(frag) {
        d.append(to, c)?;
    }
    Ok(())
}

/// A text node holding `units` of `node`'s data (UTF-16 offsets).
fn text_slice(d: &mut Dom, node: NodeId, from: usize, to: usize) -> NodeId {
    let content = text_of(d, node);
    let (b0, b1) = (blitz_dom::utf16_to_byte(&content, from), blitz_dom::utf16_to_byte(&content, to.max(from)));
    let piece = content[b0..b1].to_string();
    if matches!(d.doc.get_node(node).map(|n| &n.data), Some(NodeData::Comment { .. })) {
        d.mutate().create_comment_node(&piece)
    } else {
        d.mutate().create_text_node(&piece)
    }
}

// ---- the range algorithms ----------------------------------------------------------------------------------------

fn contained(d: &Dom, n: NodeId, s: Point, e: Point) -> bool {
    root_of(d, n) == root_of(d, s.0) && compare(d, (n, 0), s) == Ordering::Greater && compare(d, (n, node_length(d, n)), e) == Ordering::Less
}

fn partially_contained(d: &Dom, n: NodeId, s: Point, e: Point) -> bool {
    is_inclusive_ancestor(d, n, s.0) != is_inclusive_ancestor(d, n, e.0)
}

fn common_ancestor(d: &Dom, a: NodeId, b: NodeId) -> NodeId {
    let mut at = a;
    loop {
        if is_inclusive_ancestor(d, at, b) {
            return at;
        }
        match d.parent(at) {
            Some(p) => at = p,
            None => return at,
        }
    }
}

/// The DOM's "clone the contents" of the range (s, e) into a new fragment.
fn clone_contents(d: &mut Dom, s: Point, e: Point) -> Result<NodeId, String> {
    let frag = new_fragment(d);
    if s == e {
        return Ok(frag);
    }
    if s.0 == e.0 && is_char_data(d, s.0) {
        let t = text_slice(d, s.0, s.1, e.1);
        d.append(frag, t)?;
        return Ok(frag);
    }
    let common = common_ancestor(d, s.0, e.0);
    let kids = d.children(common);
    let first_partial = if is_inclusive_ancestor(d, s.0, e.0) { None } else { kids.iter().copied().find(|c| partially_contained(d, *c, s, e)) };
    let last_partial = if is_inclusive_ancestor(d, e.0, s.0) { None } else { kids.iter().rev().copied().find(|c| partially_contained(d, *c, s, e)) };
    let inside: Vec<NodeId> = kids.iter().copied().filter(|c| contained(d, *c, s, e)).collect();
    if let Some(fp) = first_partial {
        if is_char_data(d, fp) {
            let len = node_length(d, s.0);
            let t = text_slice(d, s.0, s.1, len);
            d.append(frag, t)?;
        } else {
            let clone = shallow_clone(d, fp)?;
            d.append(frag, clone)?;
            let len = node_length(d, fp);
            let sub = clone_contents(d, s, (fp, len))?;
            append_fragment(d, sub, clone)?;
        }
    }
    for c in inside {
        let copy = d.mutate().deep_clone_node(c);
        d.append(frag, copy)?;
    }
    if let Some(lp) = last_partial {
        if is_char_data(d, lp) {
            let t = text_slice(d, e.0, 0, e.1);
            d.append(frag, t)?;
        } else {
            let clone = shallow_clone(d, lp)?;
            d.append(frag, clone)?;
            let sub = clone_contents(d, (lp, 0), e)?;
            append_fragment(d, sub, clone)?;
        }
    }
    Ok(frag)
}

/// The DOM's "delete the contents" of the range (s, e); answers where the range collapses to.
fn delete_contents(d: &mut Dom, s: Point, e: Point) -> Point {
    if s == e {
        return s;
    }
    if s.0 == e.0 && is_char_data(d, s.0) {
        replace_data(d, s.0, s.1, e.1 - s.1, "");
        return s;
    }
    let common = common_ancestor(d, s.0, e.0);
    let remove: Vec<NodeId> = d
        .descendants(common)
        .into_iter()
        .filter(|n| contained(d, *n, s, e) && d.parent(*n).is_none_or(|p| !contained(d, p, s, e)))
        .collect();
    let new = if is_inclusive_ancestor(d, s.0, e.0) {
        s
    } else {
        let mut reference = s.0;
        while let Some(p) = d.parent(reference) {
            if is_inclusive_ancestor(d, p, e.0) {
                break;
            }
            reference = p;
        }
        (d.parent(reference).unwrap_or(common), index_of(d, reference) + 1)
    };
    if is_char_data(d, s.0) {
        let len = node_length(d, s.0);
        replace_data(d, s.0, s.1, len - s.1, "");
    }
    for n in remove {
        d.detach(n);
    }
    if is_char_data(d, e.0) {
        replace_data(d, e.0, 0, e.1, "");
    }
    fixed(d, new)
}

/// The DOM's `insertNode`: `node` goes in at the range's start (a text node there is split); a collapsed range then
/// spans it.
fn insert_node(d: &mut Dom, slot: usize, node: NodeId) -> Result<(), String> {
    let (s, e) = bounds(slot)?;
    let s = fixed(d, s);
    if (is_char_data(d, s.0) && d.parent(s.0).is_none()) || s.0 == node || (is_char_data(d, s.0) && !is_text(d, s.0)) {
        return Err(dom_error("HierarchyRequestError", "the node cannot be inserted here"));
    }
    let mut reference = if is_text(d, s.0) { Some(s.0) } else { d.children(s.0).get(s.1).copied() };
    let parent = match reference {
        Some(r) => d.parent(r).ok_or_else(|| dom_error("HierarchyRequestError", "no parent"))?,
        None => s.0,
    };
    if is_text(d, s.0) {
        reference = Some(split_text(d, s.0, s.1)?);
    }
    if reference == Some(node) {
        reference = d.sibling(node, 1, false);
    }
    d.detach(node);
    let mut new_offset = match reference {
        Some(r) => index_of(d, r),
        None => node_length(d, parent),
    };
    new_offset += if is_fragment(node) { d.children(node).len() } else { 1 };
    d.insert_before(parent, node, reference)?;
    let (s2, e2) = bounds(slot)?;
    if s == fixed(d, e) || s2 == e2 {
        set_bounds(slot, s2, (parent, new_offset));
    }
    Ok(())
}

fn range_text(d: &Dom, s: Point, e: Point) -> String {
    if s.0 == e.0 && is_text(d, s.0) {
        let t = text_of(d, s.0);
        return t[blitz_dom::utf16_to_byte(&t, s.1)..blitz_dom::utf16_to_byte(&t, e.1.max(s.1))].to_string();
    }
    let mut out = String::new();
    if is_text(d, s.0) {
        let t = text_of(d, s.0);
        out.push_str(&t[blitz_dom::utf16_to_byte(&t, s.1)..]);
    }
    let common = common_ancestor(d, s.0, e.0);
    for n in d.descendants(common) {
        if is_text(d, n) && contained(d, n, s, e) {
            out.push_str(&text_of(d, n));
        }
    }
    if is_text(d, e.0) {
        let t = text_of(d, e.0);
        out.push_str(&t[..blitz_dom::utf16_to_byte(&t, e.1)]);
    }
    out
}

/// The selection's text as a copy takes it (and Selection.toString() answers it): its text, a `<br>` a line break.
fn selection_text(d: &Dom, s: Point, e: Point) -> String {
    if s.0 == e.0 && is_text(d, s.0) {
        return range_text(d, s, e);
    }
    let mut out = String::new();
    if is_text(d, s.0) {
        let t = text_of(d, s.0);
        out.push_str(&t[blitz_dom::utf16_to_byte(&t, s.1)..]);
    }
    let common = common_ancestor(d, s.0, e.0);
    for n in d.descendants(common) {
        if contained(d, n, s, e) {
            if is_text(d, n) {
                out.push_str(&text_of(d, n));
            } else if d.tag(n).as_deref() == Some("br") {
                out.push('\n');
            }
        }
    }
    if is_text(d, e.0) {
        let t = text_of(d, e.0);
        out.push_str(&t[..blitz_dom::utf16_to_byte(&t, e.1)]);
    }
    out
}

/// The selected text (None when nothing is selected), for a copy.
pub fn selected_text(d: &Dom) -> Option<String> {
    let slot = STATE.with(|s| s.borrow().selection)?;
    let (s, e) = bounds(slot).ok()?;
    let (s, e) = (fixed(d, s), fixed(d, e));
    (s != e).then(|| selection_text(d, s, e))
}

/// The element the selection starts in (a clipboard event's target when no field or editing host has the focus).
pub fn selection_element(d: &Dom) -> Option<NodeId> {
    let slot = STATE.with(|s| s.borrow().selection)?;
    let (s, _) = bounds(slot).ok()?;
    let mut at = Some(fixed(d, s).0);
    while let Some(n) = at.filter(|n| !d.is_element(*n)) {
        at = d.parent(n);
    }
    at.filter(|n| d.connected(*n) && !d.is_document(*n))
}

// ---- the Range interface -----------------------------------------------------------------------------------------

/// `document.createRange()`: collapsed at the document's start.
pub fn create_range() -> Value {
    let root = with(|d| d.root());
    let slot = new_range((root, 0), (root, 0), 0);
    range_value(slot)
}

pub const RANGE_METHODS: &[&str] = &[
    "setStart", "setEnd", "setStartBefore", "setStartAfter", "setEndBefore", "setEndAfter", "collapse", "selectNode",
    "selectNodeContents", "cloneContents", "deleteContents", "extractContents", "insertNode", "cloneRange", "toString",
    "detach", "compareBoundaryPoints", "comparePoint", "isPointInRange", "intersectsNode", "surroundContents",
    "getBoundingClientRect", "getClientRects",
];

pub fn range_get(slot: usize, name: &str) -> Result<Option<Value>, String> {
    let (s, e) = bounds(slot)?;
    with(|d| {
        let (s, e) = (fixed(d, s), fixed(d, e));
        Ok(Some(match name {
            "startContainer" => node_value(Some(s.0)),
            "startOffset" => Value::Number(s.1 as f64),
            "endContainer" => node_value(Some(e.0)),
            "endOffset" => Value::Number(e.1 as f64),
            "collapsed" => Value::Bool(s == e),
            "commonAncestorContainer" => node_value(Some(common_ancestor(d, s.0, e.0))),
            _ => return Ok(None),
        }))
    })
}

pub fn range_call(slot: usize, name: &str, args: &[Value]) -> Result<Value, String> {
    let what = format!("Range.{name}");
    match name {
        "setStart" | "setEnd" => {
            let n = node_arg(args, 0, &what)?;
            let o = offset_arg(args, 1);
            with(|d| set_point(d, slot, (n, o), name == "setStart"))?;
        }
        "setStartBefore" | "setStartAfter" | "setEndBefore" | "setEndAfter" => {
            let n = node_arg(args, 0, &what)?;
            with(|d| {
                let parent = d.parent(n).ok_or_else(|| dom_error("InvalidNodeTypeError", "the node has no parent"))?;
                let i = index_of(d, n) + usize::from(name.ends_with("After"));
                set_point(d, slot, (parent, i), name.starts_with("setStart"))
            })?;
        }
        "collapse" => {
            let to_start = args.first().is_some_and(super::truthy);
            let (s, e) = bounds(slot)?;
            if to_start { set_bounds(slot, s, s) } else { set_bounds(slot, e, e) }
        }
        "selectNode" => {
            let n = node_arg(args, 0, &what)?;
            with(|d| -> Result<(), String> {
                let parent = d.parent(n).ok_or_else(|| dom_error("InvalidNodeTypeError", "the node has no parent"))?;
                let i = index_of(d, n);
                set_bounds(slot, (parent, i), (parent, i + 1));
                Ok(())
            })?;
        }
        "selectNodeContents" => {
            let n = node_arg(args, 0, &what)?;
            with(|d| {
                let len = node_length(d, n);
                set_bounds(slot, (n, 0), (n, len));
            });
        }
        "cloneContents" | "extractContents" => {
            let (s, e) = bounds(slot)?;
            let frag = with(|d| -> Result<NodeId, String> {
                let (s, e) = (fixed(d, s), fixed(d, e));
                let frag = clone_contents(d, s, e)?;
                if name == "extractContents" {
                    let at = delete_contents(d, s, e);
                    set_bounds(slot, at, at);
                }
                Ok(frag)
            })?;
            sync_caret();
            return Ok(node_value(Some(frag)));
        }
        "deleteContents" => {
            let (s, e) = bounds(slot)?;
            with(|d| {
                let (s, e) = (fixed(d, s), fixed(d, e));
                let at = delete_contents(d, s, e);
                set_bounds(slot, at, at);
            });
        }
        "insertNode" => {
            let n = node_arg(args, 0, &what)?;
            with(|d| insert_node(d, slot, n))?;
        }
        "surroundContents" => {
            let n = node_arg(args, 0, &what)?;
            let (s, e) = bounds(slot)?;
            with(|d| -> Result<(), String> {
                let (s, e) = (fixed(d, s), fixed(d, e));
                let frag = clone_contents(d, s, e)?;
                let at = delete_contents(d, s, e);
                set_bounds(slot, at, at);
                d.remove_children(n);
                insert_node(d, slot, n)?;
                append_fragment(d, frag, n)?;
                let parent = d.parent(n).unwrap_or(n);
                let i = index_of(d, n);
                set_bounds(slot, (parent, i), (parent, i + 1));
                Ok(())
            })?;
        }
        "cloneRange" => {
            let (s, e) = bounds(slot)?;
            return Ok(range_value(new_range(s, e, 0)));
        }
        "toString" => {
            let (s, e) = bounds(slot)?;
            return Ok(Value::Str(with(|d| range_text(d, fixed(d, s), fixed(d, e)))));
        }
        "detach" => {}
        "compareBoundaryPoints" => {
            let how = offset_arg(args, 0);
            let other = match args.get(1) {
                Some(Value::Object(r)) => match objects::aux_of(*r) {
                    Some(Aux::Range(o)) => o,
                    _ => return Err("Failed to execute 'compareBoundaryPoints': parameter 2 is not of type 'Range'.".into()),
                },
                _ => return Err("Failed to execute 'compareBoundaryPoints': parameter 2 is not of type 'Range'.".into()),
            };
            let ((s, e), (os, oe)) = (bounds(slot)?, bounds(other)?);
            // START_TO_START 0, START_TO_END 1, END_TO_END 2, END_TO_START 3.
            let (a, b) = match how {
                0 => (s, os),
                1 => (e, os),
                2 => (e, oe),
                3 => (s, oe),
                _ => return Err(dom_error("NotSupportedError", "the comparison type is not one of the four")),
            };
            let o = with(|d| compare(d, fixed(d, a), fixed(d, b)));
            return Ok(Value::Number(match o {
                Ordering::Less => -1.0,
                Ordering::Equal => 0.0,
                Ordering::Greater => 1.0,
            }));
        }
        "comparePoint" | "isPointInRange" => {
            let n = node_arg(args, 0, &what)?;
            let o = offset_arg(args, 1);
            let (s, e) = bounds(slot)?;
            let at = with(|d| {
                let p = (n, o.min(node_length(d, n)));
                if compare(d, p, fixed(d, s)) == Ordering::Less {
                    -1.0
                } else if compare(d, p, fixed(d, e)) == Ordering::Greater {
                    1.0
                } else {
                    0.0
                }
            });
            return Ok(if name == "comparePoint" { Value::Number(at) } else { Value::Bool(at == 0.0) });
        }
        "intersectsNode" => {
            let n = node_arg(args, 0, &what)?;
            let (s, e) = bounds(slot)?;
            return Ok(Value::Bool(with(|d| match d.parent(n) {
                None => root_of(d, n) == root_of(d, s.0),
                Some(p) => {
                    let i = index_of(d, n);
                    compare(d, (p, i), fixed(d, e)) == Ordering::Less && compare(d, (p, i + 1), fixed(d, s)) == Ordering::Greater
                }
            })));
        }
        // The box of the range's first piece of text, else of its start's element (one box, as getBoundingClientRect
        // of an element: line fragments are not split out).
        "getBoundingClientRect" | "getClientRects" => {
            let (s, _) = bounds(slot)?;
            let el = with(|d| {
                let mut at = Some(s.0);
                while let Some(n) = at.filter(|n| !d.is_element(*n)) {
                    at = d.parent(n);
                }
                at
            });
            let rect = match el {
                Some(n) => super::call(n, "getBoundingClientRect", &[])?,
                None => super::client_rect([0.0; 4])?,
            };
            return Ok(if name == "getClientRects" { crate::values::new_array(&[rect]) } else { rect });
        }
        _ => return Err(format!("{name} is not a function")),
    }
    // A change to the selection's own range moves the caret.
    if STATE.with(|s| s.borrow().selection == Some(slot)) {
        sync_caret();
    }
    Ok(Value::Undefined)
}

// ---- the Selection interface ------------------------------------------------------------------------------------

/// `window.getSelection()`, `document.getSelection()`.
pub fn get_selection() -> Value {
    objects::aux_value(Aux::Selection)
}

pub const SELECTION_METHODS: &[&str] = &[
    "getRangeAt", "addRange", "removeRange", "removeAllRanges", "empty", "collapse", "setPosition", "collapseToStart",
    "collapseToEnd", "extend", "setBaseAndExtent", "selectAllChildren", "containsNode", "deleteFromDocument", "toString",
    "modify",
];

/// The selection's range now: its slot and (start, end), made valid.
fn selection_range() -> Option<(usize, Point, Point)> {
    let slot = STATE.with(|s| s.borrow().selection)?;
    let (s, e) = bounds(slot).ok()?;
    Some(with_quiet(|d| (slot, fixed(d, s), fixed(d, e))))
}

/// The selection's anchor and focus.
fn anchor_focus() -> Option<(Point, Point)> {
    let (_, s, e) = selection_range()?;
    Some(if STATE.with(|st| st.borrow().backward) { (e, s) } else { (s, e) })
}

/// The selection becomes `slot` (one count held for it), the old range let go.
fn select_slot(slot: Option<usize>, backward: bool) {
    let old = STATE.with(|s| {
        let mut s = s.borrow_mut();
        if let Some(i) = slot
            && let Some(Some(r)) = s.ranges.get_mut(i)
        {
            r.refs += 1;
        }
        s.backward = backward;
        std::mem::replace(&mut s.selection, slot)
    });
    if let Some(o) = old {
        unref(o);
    }
    sync_caret();
}

/// Selects from `anchor` to `focus` (a new range; backwards when the focus comes first).
fn select_points(anchor: Point, focus: Point) {
    let backward = with_quiet(|d| compare(d, focus, anchor) == Ordering::Less);
    let (s, e) = if backward { (focus, anchor) } else { (anchor, focus) };
    select_slot(Some(new_range(s, e, 0)), backward);
}

pub fn selection_get(name: &str) -> Result<Option<Value>, String> {
    let af = anchor_focus();
    Ok(Some(match name {
        "anchorNode" => node_value(af.map(|(a, _)| a.0)),
        "anchorOffset" => Value::Number(af.map_or(0.0, |(a, _)| a.1 as f64)),
        "focusNode" => node_value(af.map(|(_, f)| f.0)),
        "focusOffset" => Value::Number(af.map_or(0.0, |(_, f)| f.1 as f64)),
        "isCollapsed" => Value::Bool(af.is_none_or(|(a, f)| a == f)),
        "rangeCount" => Value::Number(if af.is_some() { 1.0 } else { 0.0 }),
        "type" => Value::Str(match af {
            None => "None",
            Some((a, f)) if a == f => "Caret",
            Some(_) => "Range",
        }.into()),
        "direction" => Value::Str(match af {
            None => "none",
            Some((a, f)) if a == f => "none",
            Some(_) if STATE.with(|s| s.borrow().backward) => "backward",
            Some(_) => "forward",
        }.into()),
        _ => return Ok(None),
    }))
}

pub fn selection_call(name: &str, args: &[Value]) -> Result<Value, String> {
    let what = format!("Selection.{name}");
    match name {
        "getRangeAt" => {
            let i = offset_arg(args, 0);
            return match STATE.with(|s| s.borrow().selection) {
                Some(slot) if i == 0 && !matches!(args.first(), Some(Value::Number(x)) if *x < 0.0) => Ok(range_value(slot)),
                _ => Err(dom_error("IndexSizeError", format!("Failed to execute 'getRangeAt' on 'Selection': {i} is not a valid index."))),
            };
        }
        "addRange" => {
            let slot = match args.first() {
                Some(Value::Object(r)) => match objects::aux_of(*r) {
                    Some(Aux::Range(slot)) => slot,
                    _ => return Err("Failed to execute 'addRange' on 'Selection': parameter 1 is not of type 'Range'.".into()),
                },
                _ => return Err("Failed to execute 'addRange' on 'Selection': parameter 1 is not of type 'Range'.".into()),
            };
            // A selection holds one range: adding to a selection that has one does nothing.
            if STATE.with(|s| s.borrow().selection.is_none()) {
                select_slot(Some(slot), false);
            }
        }
        "removeRange" => {
            let same = match args.first() {
                Some(Value::Object(r)) => matches!(objects::aux_of(*r), Some(Aux::Range(slot)) if STATE.with(|s| s.borrow().selection == Some(slot))),
                _ => false,
            };
            if !same {
                return Err(dom_error("NotFoundError", "the range is not in the selection"));
            }
            select_slot(None, false);
        }
        "removeAllRanges" | "empty" => select_slot(None, false),
        "collapse" | "setPosition" => match args.first() {
            None | Some(Value::Null | Value::Undefined) => select_slot(None, false),
            _ => {
                let n = node_arg(args, 0, &what)?;
                let p = (n, offset_arg(args, 1));
                with(|d| check_point(d, p))?;
                select_points(p, p);
            }
        },
        "collapseToStart" | "collapseToEnd" => {
            let Some((_, s, e)) = selection_range() else {
                return Err(dom_error("InvalidStateError", "there is no selection to collapse"));
            };
            let p = if name == "collapseToStart" { s } else { e };
            select_points(p, p);
        }
        "extend" => {
            let n = node_arg(args, 0, &what)?;
            let p = (n, offset_arg(args, 1));
            with(|d| check_point(d, p))?;
            let Some((anchor, _)) = anchor_focus() else {
                return Err(dom_error("InvalidStateError", "there is no selection to extend"));
            };
            select_points(anchor, p);
        }
        "setBaseAndExtent" => {
            let (a, f) = (node_arg(args, 0, &what)?, node_arg(args, 2, &what)?);
            let (a, f) = ((a, offset_arg(args, 1)), (f, offset_arg(args, 3)));
            with(|d| check_point(d, a).and_then(|()| check_point(d, f)))?;
            select_points(a, f);
        }
        "selectAllChildren" => {
            let n = node_arg(args, 0, &what)?;
            let len = with(|d| d.children(n).len());
            select_points((n, 0), (n, len));
        }
        "containsNode" => {
            let n = node_arg(args, 0, &what)?;
            let partial = args.get(1).is_some_and(super::truthy);
            let Some((_, s, e)) = selection_range() else { return Ok(Value::Bool(false)) };
            return Ok(Value::Bool(with(|d| {
                let Some(p) = d.parent(n) else { return false };
                let i = index_of(d, n);
                let (before, after) = ((p, i), (p, i + 1));
                if partial {
                    compare(d, before, e) != Ordering::Greater && compare(d, after, s) != Ordering::Less
                } else {
                    compare(d, before, s) != Ordering::Less && compare(d, after, e) != Ordering::Greater
                }
            })));
        }
        "deleteFromDocument" => {
            if let Some((slot, s, e)) = selection_range() {
                with(|d| {
                    let at = delete_contents(d, s, e);
                    set_bounds(slot, at, at);
                });
                sync_caret();
            }
        }
        "toString" => {
            return Ok(Value::Str(match selection_range() {
                Some((_, s, e)) => with(|d| selection_text(d, s, e)),
                None => String::new(),
            }));
        }
        // modify(alter, direction, granularity): by character, and the line's ends for lines and boundaries.
        "modify" => {
            let (alter, direction, granularity) = (str_of(args.first()), str_of(args.get(1)), str_of(args.get(2)));
            let Some((anchor, focus)) = anchor_focus() else { return Ok(Value::Undefined) };
            let forward = matches!(direction.as_str(), "forward" | "right");
            let to = with(|d| {
                let host = editing_host(d, focus.0).unwrap_or_else(|| root_of(d, focus.0));
                let items = items(d, host);
                let k = caret_index(d, &items, focus);
                let k = match granularity.as_str() {
                    "character" => if forward { (k + 1).min(items.len()) } else { k.saturating_sub(1) },
                    _ => if forward { items.len() } else { 0 },
                };
                position_at(d, host, &items, k)
            });
            if alter == "extend" { select_points(anchor, to) } else { select_points(to, to) }
        }
        _ => return Err(format!("{name} is not a function")),
    }
    Ok(Value::Undefined)
}

// ---- the caret -----------------------------------------------------------------------------------------------------

/// Tells Blitz where the caret is: the selection's point when it is collapsed inside the focused editing host, else
/// nowhere. The window's paint draws it (blitz-paint render.rs).
pub fn sync_caret() {
    let sel = STATE.with(|s| {
        let s = s.borrow();
        s.selection.and_then(|i| s.ranges.get(i).and_then(|r| r.as_ref()).map(|r| (r.start, r.end)))
    });
    let changed = with_quiet(|d| {
        let caret = sel.and_then(|(s, e)| {
            let (s, e) = (fixed(d, s), fixed(d, e));
            if s != e {
                return None;
            }
            let f = d.doc.get_focussed_node_id()?;
            (d.is_element(f) && d.connected(f) && d.is_content_editable(f) && is_inclusive_ancestor(d, f, s.0)).then_some(EditingCaret { node: s.0, offset: s.1 })
        });
        if super::trace_input() && d.doc.editing_caret() != caret {
            eprintln!("input: caret {caret:?} (inline root {:?}, at {:?})", caret.and_then(|c| d.doc.inline_root_of(c.node)), caret.and_then(|c| d.doc.caret_inline_position(c)));
        }
        // A non-collapsed selection is highlighted where its ends map into laid-out text.
        let highlight = sel.and_then(|(s, e)| {
            let (s, e) = (fixed(d, s), fixed(d, e));
            if s == e {
                return None;
            }
            let a = d.doc.caret_inline_position(EditingCaret { node: s.0, offset: s.1 })?;
            let b = d.doc.caret_inline_position(EditingCaret { node: e.0, offset: e.1 })?;
            Some((a, b))
        });
        let highlighted = d.doc.set_selection_highlight(highlight);
        let moved = d.doc.set_editing_caret(caret);
        moved || highlighted
    });
    if changed {
        super::caret_activity();
        repaint();
    }
}

// ---- editing ---------------------------------------------------------------------------------------------------------

/// The editing host of `n`: the outermost element of the editable run `n` is in (contenteditable decides).
pub fn editing_host(d: &Dom, n: NodeId) -> Option<NodeId> {
    let mut at = Some(n);
    while let Some(id) = at.filter(|id| !d.is_element(*id)) {
        at = d.parent(id);
    }
    let mut host = None;
    while let Some(id) = at {
        if d.is_element(id) && d.is_content_editable(id) {
            host = Some(id);
            at = d.parent(id);
        } else {
            break;
        }
    }
    host
}

/// Whether `n` is an editing host (focusable, as a browser makes one).
pub fn is_editing_host(d: &Dom, n: NodeId) -> bool {
    d.is_element(n) && d.is_content_editable(n) && !d.parent(n).is_some_and(|p| d.is_element(p) && d.is_content_editable(p))
}

/// What the caret steps over in an editing host, in order: each character of its text, and whole the elements it
/// cannot enter (a `<br>`, a `contenteditable=false` island, a replaced element).
#[derive(Clone, Copy)]
enum Item {
    Char { node: NodeId, start: usize, end: usize },
    Atom { node: NodeId },
}

fn items(d: &Dom, host: NodeId) -> Vec<Item> {
    fn walk(d: &Dom, n: NodeId, out: &mut Vec<Item>) {
        for c in d.children(n) {
            match d.doc.get_node(c).map(|x| &x.data) {
                Some(NodeData::Text(t)) => {
                    let mut at = 0;
                    for ch in t.content.chars() {
                        out.push(Item::Char { node: c, start: at, end: at + ch.len_utf16() });
                        at += ch.len_utf16();
                    }
                }
                Some(NodeData::Element(_)) => {
                    let atomic = matches!(d.tag(c).as_deref(), Some("br" | "img" | "input" | "textarea" | "select" | "button" | "canvas" | "video" | "audio" | "iframe" | "hr"))
                        || d.content_editable(c) == "false";
                    if atomic { out.push(Item::Atom { node: c }) } else { walk(d, c, out) }
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(d, host, &mut out);
    out
}

fn item_start(d: &Dom, it: Item) -> Point {
    match it {
        Item::Char { node, start, .. } => (node, start),
        Item::Atom { node } => (d.parent(node).unwrap_or(node), index_of(d, node)),
    }
}

fn item_end(d: &Dom, it: Item) -> Point {
    match it {
        Item::Char { node, end, .. } => (node, end),
        Item::Atom { node } => (d.parent(node).unwrap_or(node), index_of(d, node) + 1),
    }
}

/// How many items lie before point `p`.
fn caret_index(d: &Dom, items: &[Item], p: Point) -> usize {
    items.iter().take_while(|it| compare(d, item_end(d, **it), p) != Ordering::Greater).count()
}

/// The point between items `k - 1` and `k`: in the text before it when there is text there (typing goes on in that
/// text node), else in the text after it, else beside the element.
fn position_at(d: &Dom, host: NodeId, items: &[Item], k: usize) -> Point {
    match (k.checked_sub(1).and_then(|i| items.get(i)), items.get(k)) {
        (Some(prev @ Item::Char { .. }), _) => item_end(d, *prev),
        (_, Some(next @ Item::Char { .. })) => item_start(d, *next),
        (Some(prev), _) => item_end(d, *prev),
        (None, Some(next)) => item_start(d, *next),
        (None, None) => (host, d.children(host).len()),
    }
}

/// An edit's `beforeinput` and `input` (InputEvent `inputType` and `data`).
fn edit_fields(input_type: &str, data: Option<&str>) -> InputFields {
    InputFields { input_type: input_type.to_string(), data: data.map(str::to_string), ..Default::default() }
}

/// The item index `k` moved one grapheme cluster back (`forward`: on): item by item to the next point on a cluster's
/// boundary as the text is shaped (Blitz's layout; unmapped text steps by code points).
fn cluster_step(d: &Dom, host: NodeId, items: &[Item], k: usize, forward: bool) -> usize {
    let mut at = k;
    loop {
        at = if forward { (at + 1).min(items.len()) } else { at.saturating_sub(1) };
        if at == 0 || at == items.len() {
            return at;
        }
        let p = position_at(d, host, items, at);
        if d.doc.caret_on_cluster_boundary(EditingCaret { node: p.0, offset: p.1 }) {
            return at;
        }
    }
}

/// The selection in `host` (anchor, focus), or a caret at its end when the selection is elsewhere.
fn host_selection(host: NodeId) -> (Point, Point) {
    match anchor_focus().filter(|(a, f)| with_quiet(|d| is_inclusive_ancestor(d, host, a.0) && is_inclusive_ancestor(d, host, f.0))) {
        Some(af) => af,
        None => {
            let end = with_quiet(|d| (host, d.children(host).len()));
            (end, end)
        }
    }
}

/// An edit in `host`: `beforeinput` (cancelable; canceled, nothing happens), `change` run recording what it does to
/// the document (it answers where the caret goes, None: no edit), the step remembered for undo, the caret placed,
/// `input`.
fn edit(host: NodeId, input_type: &str, data: Option<&str>, change: impl FnOnce(&mut Dom, Point, Point) -> Result<Option<Point>, String>) -> Result<(), String> {
    let before = host_selection(host);
    if !fire_input(host, "beforeinput", edit_fields(input_type, data), true)? {
        return Ok(());
    }
    // A listener may have moved the selection or taken the host away.
    if !with_quiet(|d| d.connected(host)) {
        return Ok(());
    }
    let (anchor, focus) = host_selection(host);
    let (caret, ops) = recorded(|| {
        with(|d| {
            let (anchor, focus) = (fixed(d, anchor), fixed(d, focus));
            let (start, end) = if compare(d, anchor, focus) == Ordering::Greater { (focus, anchor) } else { (anchor, focus) };
            change(d, start, end)
        })
    });
    let Some(caret) = caret? else { return Ok(()) };
    push_step(host, ops, before, (caret, caret), input_type == "insertText");
    select_points(caret, caret);
    fire_input_with(host, "input", edit_fields(input_type, data), true, false)?;
    Ok(())
}

/// Inserts `text` at `at` in `host` (line breaks as `<br>`s); answers the point after it.
fn insert_plain(d: &mut Dom, host: NodeId, at: Point, text: &str) -> Result<Point, String> {
    let mut at = at;
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            let br = d.mutate().create_element(html_name("br"), vec![]);
            let (parent, reference) = split_at(d, at)?;
            d.insert_before(parent, br, reference)?;
            at = (parent, index_of(d, br) + 1);
        }
        if !line.is_empty() {
            at = insert_text(d, host, at, line)?;
        }
    }
    Ok(at)
}

/// Pastes `text` into the editing host of `target` (clipboard.rs, its paste event not canceled): `insertFromPaste`,
/// the text in place of the selection.
pub fn paste(target: NodeId, text: &str) -> Result<(), String> {
    let Some(host) = with_quiet(|d| editing_host(d, target)) else { return Ok(()) };
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    edit(host, "insertFromPaste", None, |d, start, end| {
        let at = if start != end { delete_contents(d, start, end) } else { start };
        Ok(Some(insert_plain(d, host, at, &text)?))
    })
}

/// A cut's deletion of the selection in the editing host of `target` (clipboard.rs, after it copied it):
/// `deleteByCut`.
pub fn delete_for_cut(target: NodeId) -> Result<(), String> {
    let Some(host) = with_quiet(|d| editing_host(d, target)) else { return Ok(()) };
    let (a, f) = host_selection(host);
    if a == f {
        return Ok(());
    }
    edit(host, "deleteByCut", None, |d, start, end| Ok((start != end).then(|| delete_contents(d, start, end))))
}

/// A key pressed at `target` that no listener canceled: the editing host's default action. Err when a listener threw.
pub fn key_default(target: NodeId, key: &str, mods: Mods) -> Result<(), String> {
    let Some(host) = with(|d| editing_host(d, target)) else { return Ok(()) };
    // The selection in the host (a focused host with none gets a caret at its end).
    let (anchor, focus) = host_selection(host);
    let shortcut = (mods.ctrl && !mods.alt) || mods.meta;
    let collapsed = anchor == focus;
    let (start, end) = with_quiet(|d| if compare(d, anchor, focus) == Ordering::Greater { (focus, anchor) } else { (anchor, focus) });

    // Moving the caret (Shift extends the selection from its anchor).
    let go = |p: Point| {
        break_typing(host);
        if mods.shift { select_points(anchor, p) } else { select_points(p, p) }
    };
    let mv = |to: &dyn Fn(&Dom, &[Item], usize) -> usize| {
        let p = with(|d| {
            super::resolve_doc(&mut d.doc, "selection");
            let items = items(d, host);
            let k = caret_index(d, &items, focus);
            position_at(d, host, &items, to(d, &items, k))
        });
        go(p);
    };
    // By the layout: the line's ends, the line above or below (none: the host's ends).
    let by_line = |how: CaretMove, fallback_end: bool| {
        let p = with(|d| {
            super::resolve_doc(&mut d.doc, "selection");
            d.doc
                .caret_moved(EditingCaret { node: focus.0, offset: focus.1 }, how)
                .map(|c| (c.node, c.offset))
                .filter(|p| is_inclusive_ancestor(d, host, p.0))
                .unwrap_or_else(|| if fallback_end { (host, d.children(host).len()) } else { (host, 0) })
        });
        go(p);
    };
    match key {
        "a" | "A" if shortcut => {
            let len = with(|d| d.children(host).len());
            break_typing(host);
            select_points((host, 0), (host, len));
            return Ok(());
        }
        "ArrowLeft" if !mods.shift && !collapsed => {
            go(start);
            return Ok(());
        }
        "ArrowRight" if !mods.shift && !collapsed => {
            go(end);
            return Ok(());
        }
        "ArrowLeft" => {
            mv(&|d, items, k| cluster_step(d, host, items, k, false));
            return Ok(());
        }
        "ArrowRight" => {
            mv(&|d, items, k| cluster_step(d, host, items, k, true));
            return Ok(());
        }
        "Home" if mods.ctrl => {
            mv(&|_, _, _| 0);
            return Ok(());
        }
        "End" if mods.ctrl => {
            mv(&|_, items, _| items.len());
            return Ok(());
        }
        "PageUp" => {
            mv(&|_, _, _| 0);
            return Ok(());
        }
        "PageDown" => {
            mv(&|_, items, _| items.len());
            return Ok(());
        }
        "Home" => {
            by_line(CaretMove::LineStart, false);
            return Ok(());
        }
        "End" => {
            by_line(CaretMove::LineEnd, true);
            return Ok(());
        }
        "ArrowUp" => {
            by_line(CaretMove::LineUp, false);
            return Ok(());
        }
        "ArrowDown" => {
            by_line(CaretMove::LineDown, true);
            return Ok(());
        }
        _ => {}
    }
    if shortcut {
        return Ok(());
    }
    // An edit: what it is, then beforeinput, the change, input.
    enum Edit {
        Insert(String),
        LineBreak,
        Back,
        Forward,
    }
    let (kind, input_type) = match key {
        "Backspace" => (Edit::Back, "deleteContentBackward"),
        "Delete" => (Edit::Forward, "deleteContentForward"),
        "Enter" => (Edit::LineBreak, if mods.shift { "insertLineBreak" } else { "insertParagraph" }),
        k if k.chars().count() == 1 && !k.chars().any(char::is_control) => (Edit::Insert(k.to_string()), "insertText"),
        _ => return Ok(()),
    };
    let data: Option<String> = match &kind {
        Edit::Insert(t) => Some(t.clone()),
        _ => None,
    };
    edit(host, input_type, data.as_deref(), |d, start, end| {
        // A selection is deleted first (and is all a deletion deletes).
        let at = if start != end { delete_contents(d, start, end) } else { start };
        super::resolve_doc(&mut d.doc, "selection");
        Ok(match kind {
            Edit::Back | Edit::Forward if start != end => Some(at),
            // A grapheme cluster (an atom whole) before or after the caret.
            Edit::Back => {
                let items = items(d, host);
                let k = caret_index(d, &items, at);
                if k == 0 {
                    None
                } else {
                    let from = item_start(d, items[cluster_step(d, host, &items, k, false)]);
                    Some(delete_contents(d, from, at))
                }
            }
            Edit::Forward => {
                let items = items(d, host);
                let k = caret_index(d, &items, at);
                if k >= items.len() {
                    None
                } else {
                    let to = item_end(d, items[cluster_step(d, host, &items, k, true) - 1]);
                    Some(delete_contents(d, at, to))
                }
            }
            Edit::Insert(text) => Some(insert_text(d, host, at, &text)?),
            Edit::LineBreak => {
                let br = d.mutate().create_element(html_name("br"), vec![]);
                let (parent, reference) = split_at(d, at)?;
                d.insert_before(parent, br, reference)?;
                Some((parent, index_of(d, br) + 1))
            }
        })
    })
}

/// Where a node goes in at point `p`: its parent and the child it goes before (a text node there is split).
fn split_at(d: &mut Dom, p: Point) -> Result<(NodeId, Option<NodeId>), String> {
    if is_text(d, p.0) {
        let parent = d.parent(p.0).ok_or_else(|| dom_error("HierarchyRequestError", "no parent"))?;
        let len = node_length(d, p.0);
        let reference = if p.1 == 0 {
            Some(p.0)
        } else if p.1 >= len {
            d.sibling(p.0, 1, false)
        } else {
            Some(split_text(d, p.0, p.1)?)
        };
        return Ok((parent, reference));
    }
    Ok((p.0, d.children(p.0).get(p.1).copied()))
}

/// Inserts `text` at `p` (into the text node there or beside it, else a new text node); answers the point after it.
fn insert_text(d: &mut Dom, host: NodeId, p: Point, text: &str) -> Result<Point, String> {
    let units = text.encode_utf16().count();
    // The text node to type into: the one the point is in, else the editable one just before or after it.
    let editable = |d: &Dom, n: NodeId| is_text(d, n) && d.parent(n).is_some_and(|parent| d.is_content_editable(parent));
    let (node, offset) = if is_text(d, p.0) {
        (Some(p.0), p.1)
    } else {
        let kids = d.children(p.0);
        match (p.1.checked_sub(1).and_then(|i| kids.get(i).copied()), kids.get(p.1).copied()) {
            (Some(prev), _) if editable(d, prev) => (Some(prev), node_length(d, prev)),
            (_, Some(next)) if editable(d, next) => (Some(next), 0),
            _ => (None, 0),
        }
    };
    if let Some(n) = node.filter(|n| editable(d, *n)) {
        replace_data(d, n, offset, 0, text);
        return Ok((n, offset + units));
    }
    let container = if d.is_element(p.0) && d.is_content_editable(p.0) { p.0 } else { host };
    let index = if container == p.0 { p.1 } else { d.children(host).len() };
    let t = d.mutate().create_text_node(text);
    let reference = d.children(container).get(index).copied();
    d.insert_before(container, t, reference)?;
    Ok((t, units))
}

/// A press at viewport (x, y) after the focus moved: in the focused editing host, the caret goes to the text there
/// (Blitz's hit test), else to the host's end.
pub fn press_caret(x: f64, y: f64) {
    let at = with(|d| {
        let f = d.doc.get_focussed_node_id().filter(|f| is_editing_host(d, *f))?;
        super::resolve_doc(&mut d.doc, "selection");
        let hit = d.doc.find_text_position(x as f32, y as f32).and_then(|(root, byte)| d.doc.inline_boundary_at(root, byte));
        Some(match hit {
            Some(c) if is_inclusive_ancestor(d, f, c.node) => (c.node, c.offset),
            _ => (f, d.children(f).len()),
        })
    });
    if let Some(p) = at {
        if let Some(host) = with_quiet(|d| editing_host(d, p.0)) {
            break_typing(host);
        }
        select_points(p, p);
    }
}

/// After a focus() moved the focus to an editing host the selection is not in: a caret at its start, as a browser
/// places one.
pub fn focus_caret(n: NodeId) {
    let inside = anchor_focus().is_some_and(|(a, _)| with_quiet(|d| is_inclusive_ancestor(d, n, a.0)));
    if !inside && with(|d| is_editing_host(d, n)) {
        select_points((n, 0), (n, 0));
    } else {
        sync_caret();
    }
}
