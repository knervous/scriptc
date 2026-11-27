//! The document, on Blitz: a `blitz_dom::BaseDocument` parsed from an HTML shell (blitz-html), with the members a page
//! program uses. The semantics follow the DOM standard: tree mutation with its hierarchy
//! checks, text and textContent, attributes, id/className/classList, inline style, the child and sibling links,
//! querySelector(All)/getElementById/matches/closest on Blitz's selector engine (Stylo), innerHTML through the HTML
//! parser, and events dispatched along the path (capture, target, bubble, window last) with stopPropagation,
//! stopImmediatePropagation and preventDefault.
//!
//! A node is Blitz's versioned id; its JavaScript reference is the object table's one per node (objects.rs
//! `node_ref`), so identity holds. The document is the root node. Nodes are never dropped here: a node taken out of
//! the tree stays in Blitz's slab while a reference may name it.
//!
//! Re-entrancy: listeners are compiled code that call back into the document, so the document is never borrowed
//! across a closure call, an object release (which may free an event here) or a conversion that reads a node.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

pub use blitz_dom::NodeId;
use blitz_dom::{BaseDocument, DocumentConfig, LocalName, Namespace, NodeData, QualName, ns};

use crate::abi;
use crate::objects::{self, Value};

// Selection, Range, DocumentFragment and contenteditable editing (a child module: it works on this module's document).
#[path = "selection.rs"]
mod selection;
#[path = "text_field.rs"]
mod text_field;
// The clipboard (copy, cut, paste, DataTransfer) and the editing commands' keys (undo, redo).
#[path = "clipboard.rs"]
mod clipboard;

/// The page the program starts on (an embedding application may load its own with [`load_html`]).
const SHELL: &str = "<!DOCTYPE html><html><head><title></title></head><body></body></html>";

/// A DOM object that is not a node, held by the object table (objects.rs `Kind::Aux`).
#[derive(Clone)]
pub enum Aux {
    /// `el.style` (CSSStyleDeclaration over the inline style).
    Style(NodeId),
    /// `el.classList` (DOMTokenList over the class attribute).
    ClassList(NodeId),
    /// `el.dataset` (DOMStringMap over the data-* attributes: `dataset.fooBar` is `data-foo-bar`).
    Dataset(NodeId),
    /// `node.childNodes` (a live NodeList).
    ChildNodes(NodeId),
    /// A static NodeList (`querySelectorAll`).
    List(Rc<[NodeId]>),
    /// A live HTMLCollection: the elements under the node that match the selector (`getElementsByTagName`,
    /// `getElementsByClassName`).
    Collection(NodeId, Rc<str>),
    /// An event (its state is here, by slot).
    Event(usize),
    /// A Range (selection.rs, by slot).
    Range(usize),
    /// The window's Selection (selection.rs holds its state).
    Selection,
    /// A ClipboardEvent's `clipboardData` (clipboard.rs, by slot).
    DataTransfer(usize),
}

/// What a listener is registered on: a node (the document is the root node) or the window.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    Node(NodeId),
    Window,
}

struct Listener {
    id: u64,
    target: Target,
    kind: String,
    capture: bool,
    once: bool,
    /// Set by an `on<kind>` property, not by `addEventListener`.
    property: bool,
    /// The compiled function (retained while registered).
    closure: u64,
}

#[derive(Default)]
struct EventState {
    kind: String,
    bubbles: bool,
    cancelable: bool,
    trusted: bool,
    target: Option<Target>,
    current: Option<Target>,
    /// 0 none, 1 capturing, 2 at target, 3 bubbling.
    phase: u8,
    stop: bool,
    stop_immediate: bool,
    canceled: bool,
    dispatching: bool,
    time: f64,
    /// A mouse, pointer, wheel or keyboard event's fields (input from a window).
    input: Option<Box<InputFields>>,
}

/// Modifier keys held during an input event.
#[derive(Clone, Copy, Debug, Default)]
pub struct Mods {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub meta: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum PointerKind {
    Move,
    Down,
    Up,
    /// Scroll by (dx, dy) CSS px (positive: right, down).
    // Android's window sends no wheel yet.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    Wheel { dx: f64, dy: f64 },
}

/// Input from a window (window.rs): a pointer at CSS px (x, y) of the viewport, or a key.
#[derive(Clone, Debug)]
pub enum Input {
    /// `touch`: the finger (a touch screen's pointer: pointerType "touch"), else a mouse.
    Pointer { kind: PointerKind, x: f64, y: f64, button: i16, buttons: u16, mods: Mods, touch: Option<i32> },
    Key { down: bool, key: String, code: String, mods: Mods, repeat: bool },
    /// The mouse moved by (dx, dy) CSS px while the pointer is locked (the cursor itself stays put), with the buttons
    /// and modifiers held.
    #[cfg_attr(not(windows), allow(dead_code))]
    Motion { dx: f64, dy: f64, buttons: u16, mods: Mods },
    /// The window gave the pointer lock up on its own (it lost the focus): the document's lock ends.
    #[cfg_attr(not(windows), allow(dead_code))]
    LockLost,
    /// The window gained (true) or lost the system's focus: the page's window `focus` or `blur`.
    #[cfg_attr(not(windows), allow(dead_code))]
    Focus(bool),
    /// The mouse left the window.
    #[cfg_attr(not(windows), allow(dead_code))]
    Leave,
}

#[derive(Default, Clone)]
struct InputFields {
    client: (f64, f64),
    button: i16,
    buttons: u16,
    mods: Mods,
    key: String,
    code: String,
    repeat: bool,
    delta: (f64, f64),
    detail: f64,
    pointer: bool,
    /// The finger of a touch pointer.
    touch: Option<i32>,
    /// The primary pointer (the mouse; the first finger down of a touch).
    primary: bool,
    /// The pointer's motion since its last event (CSS px): `movementX`, `movementY`.
    movement: (f64, f64),
    /// A keyboard event (`isComposing`, `location`, `keyCode` are its members).
    keyboard: bool,
    /// A boundary event's other element (`relatedTarget`).
    related: Option<NodeId>,
    /// An editing InputEvent's `inputType` (`beforeinput`, `input`; empty for other events) and `data`.
    input_type: String,
    data: Option<String>,
    /// A ClipboardEvent's DataTransfer (clipboard.rs slot; the event holds a count on it).
    transfer: Option<usize>,
}

struct Dom {
    doc: BaseDocument,
    listeners: Vec<Listener>,
    next_listener: u64,
    /// Properties set on a node that are not DOM members, in insertion order (references retained).
    expandos: HashMap<NodeId, Vec<(String, Value)>>,
    events: Vec<Option<EventState>>,
    free_events: Vec<usize>,
    origin: std::time::Instant,
    /// Changes to the document so far (every mutation goes through [`Dom::mutate`]): MutationObserver's clock.
    mutations: u64,
}

impl Dom {
    fn from_html(html: &str) -> Dom {
        // A window's viewport (window.rs), when the host opened one.
        let viewport = crate::window::viewport().map(|(w, h, scale)| blitz_traits::shell::Viewport::new(w, h, scale, blitz_traits::shell::ColorScheme::Light));
        // The document's URL is the page's (modules.rs: <PREFIX>PAGE_URL, else http://localhost/), so baseURI and
        // relative URLs resolve as on the page that fetches resolve against.
        let base_url = Some(crate::modules::page().to_string());
        // The page's own loads (stylesheets, images, fonts) read as its fetches do (modules.rs).
        let net_provider: std::sync::Arc<dyn blitz_traits::net::NetProvider> = std::sync::Arc::new(crate::modules::DocumentNet);
        blitz_dom::util::set_svg_resource_root(crate::modules::document_root());
        // An inline SVG's root-relative image hrefs read as the document's own loads do: on disk, carried in the
        // executable (a layer's carried files), else streamed.
        blitz_dom::util::set_svg_resource_loader(Some(std::sync::Arc::new(|path: &str| crate::modules::document_load(&crate::modules::page().join(path).ok()?))));
        let config = DocumentConfig {
            html_parser_provider: Some(std::sync::Arc::new(blitz_html::HtmlProvider)),
            viewport,
            base_url,
            net_provider: Some(net_provider),
            ..Default::default()
        };
        let doc = blitz_html::HtmlDocument::from_html(html, config).into_inner();
        Dom { doc, listeners: Vec::new(), next_listener: 1, expandos: HashMap::new(), events: Vec::new(), free_events: Vec::new(), origin: std::time::Instant::now(), mutations: 0 }
    }
    /// The document's mutator, counted (a MutationObserver delivers when the count moved), and the page repainted.
    fn mutate(&mut self) -> blitz_dom::DocumentMutator<'_> {
        crate::abi::calls::count("document mutate() (marks dirty, MutationObserver due)", 0);
        self.mutations += 1;
        repaint();
        self.doc.mutate()
    }
    fn node(&self, id: NodeId) -> Result<&blitz_dom::Node, String> {
        self.doc.get_node(id).ok_or_else(|| "a node that no longer exists".to_string())
    }
    fn parent(&self, id: NodeId) -> Option<NodeId> {
        self.doc.get_node(id)?.parent
    }
    fn is_element(&self, id: NodeId) -> bool {
        self.doc.get_node(id).is_some_and(|n| n.is_element())
    }
    fn is_document(&self, id: NodeId) -> bool {
        self.doc.get_node(id).is_some_and(|n| matches!(n.data, NodeData::Document(_)))
    }
    fn children(&self, id: NodeId) -> Vec<NodeId> {
        self.doc.get_node(id).map(|n| n.children.to_vec()).unwrap_or_default()
    }
    fn element_children(&self, id: NodeId) -> Vec<NodeId> {
        self.children(id).into_iter().filter(|c| self.is_element(*c)).collect()
    }
    fn sibling(&self, id: NodeId, offset: isize, elements: bool) -> Option<NodeId> {
        let p = self.doc.get_node(self.parent(id)?)?;
        let mut at = p.index_of_child(id)?;
        loop {
            at = at.checked_add_signed(offset)?;
            let c = *p.children.get(at)?;
            if !elements || self.is_element(c) {
                return Some(c);
            }
        }
    }
    fn tag(&self, id: NodeId) -> Option<String> {
        self.doc.get_node(id)?.element_data().map(|e| e.name.local.to_string())
    }
    fn is_html(&self, id: NodeId) -> bool {
        self.doc.get_node(id).and_then(|n| n.element_data()).is_some_and(|e| e.name.ns == ns!(html))
    }
    fn read_attr(&self, id: NodeId, name: &str) -> Option<String> {
        let el = self.doc.get_node(id)?.element_data()?;
        el.attrs().iter().find(|a| &*a.name.local == name).map(|a| a.value.clone())
    }
    /// The contenteditable attribute's state: "true" / "false" / "plaintext-only" when set to one of those (an empty
    /// value is "true"), else "inherit".
    fn content_editable(&self, id: NodeId) -> &'static str {
        match self.read_attr(id, "contenteditable").map(|v| v.to_ascii_lowercase()) {
            Some(v) if v.is_empty() || v == "true" => "true",
            Some(v) if v == "false" => "false",
            Some(v) if v == "plaintext-only" => "plaintext-only",
            _ => "inherit",
        }
    }
    /// Whether editing applies here: the nearest element with a set state decides.
    fn is_content_editable(&self, id: NodeId) -> bool {
        let mut at = Some(id);
        while let Some(n) = at {
            match self.content_editable(n) {
                "inherit" => at = self.parent(n),
                state => return self.is_element(id) && state != "false",
            }
        }
        false
    }
    /// HTML elements lowercase attribute names (setAttribute's first step).
    fn attr_name(&self, id: NodeId, name: &str) -> QualName {
        let name = if self.is_html(id) { name.to_ascii_lowercase() } else { name.to_string() };
        QualName::new(None, ns!(), LocalName::from(name))
    }
    fn set_attr(&mut self, id: NodeId, name: &str, value: &str) {
        let q = self.attr_name(id, name);
        self.mutate().set_attribute(id, q, value);
    }
    fn clear_attr(&mut self, id: NodeId, name: &str) {
        let q = self.attr_name(id, name);
        self.mutate().clear_attribute(id, q);
    }
    fn root(&self) -> NodeId {
        self.doc.root_node().id
    }
    fn connected(&self, mut id: NodeId) -> bool {
        let root = self.root();
        loop {
            if id == root {
                return true;
            }
            match self.parent(id) {
                Some(p) => id = p,
                None => return false,
            }
        }
    }
    fn body(&self) -> Option<NodeId> {
        self.doc.find_body_node().map(|n| n.id)
    }
    fn document_element(&self) -> Option<NodeId> {
        self.children(self.root()).into_iter().find(|c| self.is_element(*c))
    }
    fn head(&self) -> Option<NodeId> {
        let html = self.document_element()?;
        self.children(html).into_iter().find(|c| self.tag(*c).as_deref() == Some("head"))
    }
    fn title_element(&self) -> Option<NodeId> {
        self.descendants(self.root()).into_iter().find(|n| self.tag(*n).as_deref() == Some("title") && self.is_html(*n))
    }
    /// The node's descendants in tree order.
    fn descendants(&self, root: NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        let mut stack: Vec<NodeId> = self.children(root).into_iter().rev().collect();
        while let Some(n) = stack.pop() {
            out.push(n);
            stack.extend(self.children(n).into_iter().rev());
        }
        out
    }
    /// HierarchyRequestError when inserting `child` under `parent` would make a cycle or put a node somewhere a node
    /// of its kind cannot be.
    fn check_hierarchy(&self, parent: NodeId, child: NodeId) -> Result<(), String> {
        if self.is_document(child) {
            return Err(dom_error("HierarchyRequestError", "a document cannot be inserted"));
        }
        if matches!(self.node(parent)?.data, NodeData::Text(_) | NodeData::Comment { .. }) {
            return Err(dom_error("HierarchyRequestError", "this node type does not support children"));
        }
        let mut at = Some(parent);
        while let Some(id) = at {
            if id == child {
                return Err(dom_error("HierarchyRequestError", "the new child is an ancestor of the parent"));
            }
            at = self.parent(id);
        }
        Ok(())
    }
    /// Takes `id` out of its parent (never dropped: references may name it).
    fn detach(&mut self, id: NodeId) {
        if self.parent(id).is_some() {
            // Live ranges inside it move to where it was (selection.rs); an edit being recorded notes it (undo).
            selection::node_removed(self, id);
            selection::record_removed(self, id);
            self.mutate().remove_node(id);
        }
    }
    fn append(&mut self, parent: NodeId, child: NodeId) -> Result<(), String> {
        self.check_hierarchy(parent, child)?;
        // A DocumentFragment inserts its children (selection.rs).
        if selection::is_fragment(child) {
            for c in self.children(child) {
                self.append(parent, c)?;
            }
            return Ok(());
        }
        self.detach(child);
        self.mutate().append_children(parent, &[child]);
        selection::record_inserted(self, child);
        Ok(())
    }
    fn insert_before(&mut self, parent: NodeId, child: NodeId, reference: Option<NodeId>) -> Result<(), String> {
        self.check_hierarchy(parent, child)?;
        if selection::is_fragment(child) {
            for c in self.children(child) {
                self.insert_before(parent, c, reference)?;
            }
            return Ok(());
        }
        if let Some(r) = reference {
            if self.parent(r) != Some(parent) {
                return Err(dom_error("NotFoundError", "the reference node is not a child of this node"));
            }
            if r == child {
                return Ok(());
            }
        }
        self.detach(child);
        if let Some(r) = reference {
            // Live ranges past the new child's place move on one (selection.rs).
            let index = self.children(parent).iter().position(|c| *c == r).unwrap_or(0);
            selection::node_inserted(parent, index);
        }
        match reference {
            Some(r) => self.mutate().insert_nodes_before(r, &[child]),
            None => self.mutate().append_children(parent, &[child]),
        }
        selection::record_inserted(self, child);
        Ok(())
    }
    fn remove_children(&mut self, id: NodeId) {
        for c in self.children(id) {
            self.detach(c);
        }
    }
    fn set_text_content(&mut self, id: NodeId, text: &str) {
        match &self.node(id).map(|n| &n.data) {
            Ok(NodeData::Text(_)) => {
                selection::text_reset(id);
                self.mutate().set_node_text(id, text)
            }
            Ok(NodeData::Comment { .. }) => self.set_comment(id, text),
            Ok(NodeData::Document(_)) | Err(_) => {}
            Ok(_) => {
                self.remove_children(id);
                if !text.is_empty() {
                    let mut m = self.mutate();
                    let t = m.create_text_node(text);
                    m.append_children(id, &[t]);
                }
            }
        }
    }
    fn set_comment(&mut self, id: NodeId, text: &str) {
        if let Some(NodeData::Comment { contents }) = self.doc.get_node_mut(id).map(|n| &mut n.data) {
            *contents = text.to_string();
            repaint();
        }
    }
    fn set_inner_html(&mut self, id: NodeId, html: &str) {
        // set_inner_html drops the old children: detach them first so a node a reference names is never dropped.
        self.remove_children(id);
        self.mutate().set_inner_html(id, html);
    }
    fn inner_html(&self, id: NodeId) -> String {
        self.children(id).into_iter().filter_map(|c| self.doc.get_node(c)).map(|n| n.outer_html()).collect()
    }
    fn node_name(&self, id: NodeId) -> String {
        let Ok(node) = self.node(id) else { return String::new() };
        match &node.data {
            NodeData::Element(e) | NodeData::AnonymousBlock(e) => {
                let local = e.name.local.to_string();
                let q = match &e.name.prefix {
                    Some(p) => format!("{p}:{local}"),
                    None => local,
                };
                if e.name.ns == ns!(html) { q.to_ascii_uppercase() } else { q }
            }
            NodeData::Text(_) => "#text".into(),
            NodeData::Comment { .. } => "#comment".into(),
            NodeData::Document(_) => "#document".into(),
            #[allow(unreachable_patterns)]
            _ => String::new(),
        }
    }
    /// Descendants of `root` that match `selector` (Blitz's selector engine), in tree order.
    fn select(&self, root: NodeId, selector: &str) -> Result<Vec<NodeId>, String> {
        match self.doc.query_selector_all_in(root, selector) {
            Ok(found) => Ok(found.into_iter().filter(|n| self.is_element(*n)).collect()),
            Err(_) => Err(dom_error("SyntaxError", format!("'{selector}' is not a valid selector"))),
        }
    }
    fn select_first(&self, root: NodeId, selector: &str) -> Result<Option<NodeId>, String> {
        match self.doc.query_selector_in(root, selector) {
            Ok(found) => Ok(found),
            Err(_) => Err(dom_error("SyntaxError", format!("'{selector}' is not a valid selector"))),
        }
    }
    fn matches(&self, id: NodeId, selector: &str) -> Result<bool, String> {
        if !self.is_element(id) {
            return Ok(false);
        }
        self.doc.matches_selector(id, selector).map_err(|_| dom_error("SyntaxError", format!("'{selector}' is not a valid selector")))
    }
    fn get_element_by_id(&self, root: NodeId, id: &str) -> Option<NodeId> {
        // Blitz's id map holds connected elements; below another root (a detached subtree), search it.
        if root == self.root() {
            return self.doc.get_element_by_id(id);
        }
        self.descendants(root).into_iter().find(|n| self.is_element(*n) && self.read_attr(*n, "id").as_deref() == Some(id))
    }
    fn class_tokens(&self, id: NodeId) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for t in self.read_attr(id, "class").unwrap_or_default().split_ascii_whitespace() {
            if !out.iter().any(|o| o == t) {
                out.push(t.to_string());
            }
        }
        out
    }
    fn set_class_tokens(&mut self, id: NodeId, tokens: &[String]) {
        self.set_attr(id, "class", &tokens.join(" "));
    }
    fn new_event(&mut self, kind: &str, bubbles: bool, cancelable: bool, trusted: bool) -> usize {
        let state = EventState { kind: kind.to_string(), bubbles, cancelable, trusted, time: self.origin.elapsed().as_secs_f64() * 1000.0, ..Default::default() };
        match self.free_events.pop() {
            Some(i) => {
                self.events[i] = Some(state);
                i
            }
            None => {
                self.events.push(Some(state));
                self.events.len() - 1
            }
        }
    }
    fn event(&mut self, i: usize) -> Result<&mut EventState, String> {
        self.events.get_mut(i).and_then(|e| e.as_mut()).ok_or_else(|| "a released event".to_string())
    }
}

thread_local! {
    /// The finger that is the primary touch pointer, while it is down.
    static PRIMARY_TOUCH: std::cell::Cell<Option<i32>> = const { std::cell::Cell::new(None) };
    /// Pointers captured (setPointerCapture), by pointerId: their events go to the element until they lift.
    static CAPTURES: RefCell<HashMap<i32, NodeId>> = RefCell::new(HashMap::new());
    /// Pointers down now (a capture needs an active pointer), by pointerId; the mouse (1) always counts.
    static ACTIVE_POINTERS: RefCell<std::collections::HashSet<i32>> = RefCell::new(std::collections::HashSet::from([1]));
    /// The primary finger's pan, from its down until it lifts (see `pan`).
    static PAN: std::cell::Cell<Option<Pan>> = const { std::cell::Cell::new(None) };
}

/// A finger down, and whether it has become a pan: a drag past `PAN_SLOP` that an element from its down target up
/// could scroll, while no listener holds the pointer's capture (a slider or a stick keeps its drag).
#[derive(Clone, Copy)]
struct Pan {
    pointer: i32,
    from: (f64, f64),
    last: (f64, f64),
    target: NodeId,
    panning: bool,
}

/// How far (CSS px) a finger moves before its drag is a pan rather than a press: about Android's touch slop.
const PAN_SLOP: f64 = 10.0;

/// A user's scroll from `target` by (dx, dy) CSS px of scroll offset (the default a browser gives a wheel or a pan):
/// the nearest element that can still move that way scrolls and gets its `scroll` event; the page never does.
/// Whether one moved.
fn user_scroll(target: NodeId, dx: f64, dy: f64) -> Result<bool, String> {
    let Some(scroller) = with(|d| d.doc.scroll_user_by(target, dx, dy)) else { return Ok(false) };
    repaint();
    fire_plain(scroller, "scroll", false)?;
    Ok(true)
}

/// The primary finger's part in panning (a browser's `touch-action: auto` default): its down remembers where it
/// landed; once a move is past the slop with the pointer uncaptured and something there scrolls, the press is
/// cancelled (`pointercancel`, no click) and from then on the finger only scrolls. Returns true when the event was
/// the pan's and must not be dispatched as a pointer event.
fn pan(kind: &PointerKind, pointer: i32, at: (f64, f64), target: NodeId, captured: bool, f: &InputFields) -> Result<bool, String> {
    match kind {
        PointerKind::Down => {
            PAN.with(|p| p.set(Some(Pan { pointer, from: at, last: at, target, panning: false })));
            Ok(false)
        }
        PointerKind::Move => {
            let Some(mut pan) = PAN.with(|p| p.get()).filter(|p| p.pointer == pointer) else { return Ok(false) };
            if pan.panning {
                let (dx, dy) = (pan.last.0 - at.0, pan.last.1 - at.1);
                pan.last = at;
                PAN.with(|p| p.set(Some(pan)));
                user_scroll(pan.target, dx, dy)?;
                return Ok(true);
            }
            if captured || (at.0 - pan.from.0).hypot(at.1 - pan.from.1) <= PAN_SLOP {
                return Ok(false);
            }
            // The whole drag so far, so the content catches up with the finger as it starts.
            if !user_scroll(pan.target, pan.from.0 - at.0, pan.from.1 - at.1)? {
                return Ok(false);
            }
            pan.panning = true;
            pan.last = at;
            PAN.with(|p| p.set(Some(pan)));
            PRESSED.with(|p| p.set(None));
            with(|d| {
                if d.doc.unactive_node() {
                    repaint();
                }
            });
            let mut f = f.clone();
            f.button = -1;
            fire_input(pan.target, "pointercancel", f, false)?;
            Ok(true)
        }
        PointerKind::Up => {
            let panned = PAN.with(|p| p.take()).is_some_and(|p| p.pointer == pointer && p.panning);
            if panned {
                PRESSED.with(|p| p.set(None));
            }
            Ok(panned)
        }
        PointerKind::Wheel { .. } => Ok(false),
    }
}

thread_local! {
    static DOM: RefCell<Option<Dom>> = const { RefCell::new(None) };
}

thread_local! {
    /// What the page paints may have changed since the window last painted it: a mutation (Dom::mutate, a comment's
    /// text), focus, the viewport. Reads leave it (the frame's own reads of a canvas's size kept the CPU paint
    /// running every frame under a still page).
    static DIRTY: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

fn repaint() {
    DIRTY.with(|d| d.set(true));
}

/// The next frame resolves and repaints: what a paint's own resolve left for the next (window_android.rs).
pub fn repaint_later() {
    repaint();
}

fn with<R>(f: impl FnOnce(&mut Dom) -> R) -> R {
    with_quiet(f)
}

fn with_quiet<R>(f: impl FnOnce(&mut Dom) -> R) -> R {
    DOM.with(|d| {
        f(d.borrow_mut().get_or_insert_with(|| {
            // A render thread has no document: one made here is a page read that took another way than the hooks.
            if !crate::render_thread::is_main_thread() && std::env::var_os("SCRIPTC_HOST_TRACE_RENDER").is_some() {
                eprintln!("render thread made a document\n{}", std::backtrace::Backtrace::force_capture());
            }
            Dom::from_html(&page_html())
        }))
    })
}

/// The page's HTML file: SCRIPTC_HOST_PAGE, else an install's page beside the executable (config.rs `installed_page`;
/// a layer may carry it: layer.rs `files`).
pub fn page_path() -> Option<std::path::PathBuf> {
    std::env::var_os("SCRIPTC_HOST_PAGE").map(std::path::PathBuf::from).or_else(|| crate::installed(crate::config::get().installed_page))
}

/// The page file's `<title>` text (the window's title), if it has one.
pub fn page_title() -> Option<String> {
    let html = crate::read_to_string(&page_path()?).ok()?;
    let start = html.find("<title>")? + "<title>".len();
    let end = start + html[start..].find("</title>")?;
    let title = html[start..end].trim().replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    (!title.is_empty()).then_some(title)
}

/// The page the program starts on: the HTML file [`page_path`] names, as the layer prepares it (layer.rs `page_html`),
/// else an empty shell.
fn page_html() -> String {
    let Some(path) = page_path() else { return SHELL.to_string() };
    match crate::read_to_string(&path) {
        Ok(html) => crate::layer::get().page_html(&html, &path),
        Err(e) => {
            eprintln!("scriptc-host: page {}: {e}; starting on an empty page", path.display());
            SHELL.to_string()
        }
    }
}

/// `navigator.clipboard.readText()`: the system clipboard's text ("" when it holds none).
pub fn clipboard_read_text() -> String {
    clipboard::read_text().unwrap_or_default()
}

/// `navigator.clipboard.writeText(text)`: the system clipboard's text.
pub fn clipboard_write_text(text: &str) {
    clipboard::write_text(text);
}

/// Whether the document has the focus (the window has the system's): the async clipboard needs it, as a browser's
/// does.
/// Whether the focused element takes typed text (a text field or an editing host): a touch screen's keyboard shows.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn text_entry_focused() -> bool {
    with(|d| focused_element(d).is_some_and(|f| text_field::is_editable_field(d, f) || selection::editing_host(d, f).is_some()))
}

pub fn document_focused() -> bool {
    WINDOW_FOCUSED.with(|f| f.get())
}

/// Whether the document may have changed since the last call (the window repaints then).
pub fn take_dirty() -> bool {
    // The caret's blink phase (its repaint is a change too).
    let blinked = caret_blink_tick();
    let dirty = DIRTY.with(|d| d.replace(false)) | LOADED.swap(false, std::sync::atomic::Ordering::AcqRel) | blinked;
    // A change may have moved the selection (live ranges): the caret Blitz draws follows it (selection.rs).
    if dirty {
        selection::sync_caret();
        DIRTY.with(|d| d.set(false));
    }
    dirty
}

/// A load the document started delivered its bytes (on a loader thread): the next frame resolves and repaints.
static LOADED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn resource_arrived() {
    LOADED.store(true, std::sync::atomic::Ordering::Release);
}

/// The Blitz document for the window's paint, without marking it changed.
/// A decoded <img>'s pixels (Blitz's decode, straight RGBA8): None when `n` is no image or it is not decoded yet.
pub fn image_pixels(n: NodeId) -> Option<crate::bitmap::Pixels> {
    with_quiet(|d| {
        let image = d.doc.get_node(n)?.element_data()?.raster_image_data()?;
        Some(crate::bitmap::Pixels { width: image.width, height: image.height, rgba: std::sync::Arc::new(image.data.data().to_vec()), premultiplied: false })
    })
}

/// An element's tag name (objects.rs's undefined-member trace).
pub fn tag_of(n: NodeId) -> Option<String> {
    with_quiet(|d| d.tag(n))
}

pub fn with_document_quiet<R>(f: impl FnOnce(&mut BaseDocument) -> R) -> R {
    with_quiet(|d| f(&mut d.doc))
}

/// The window's size changed (physical pixels, scale).
pub fn set_viewport(width: u32, height: u32, scale: f32) {
    with(|d| d.doc.set_viewport(blitz_traits::shell::Viewport::new(width, height, scale, blitz_traits::shell::ColorScheme::Light)));
    repaint();
}

/// Replaces the page with `html` (an embedding application's shell). References to the old page's nodes go stale.
#[allow(dead_code)]
pub fn load_html(html: &str) {
    let dom = Dom::from_html(html);
    let old = DOM.with(|d| d.borrow_mut().replace(dom));
    drop(old);
}

/// `window.scrollTo` / `scrollBy` (objects.rs): the viewport scrolled by (dx, dy) CSS px of offset, clamped to the
/// page, and repainted.
pub fn scroll_viewport(dx: f64, dy: f64) {
    with(|d| {
        resolve_doc(&mut d.doc, "scroll_viewport");
        // Blitz's user delta moves the content, the opposite way to the offset.
        d.doc.scroll_viewport_by(-dx, -dy);
    });
    repaint();
}

/// The viewport's scroll offset (CSS px).
pub fn viewport_scroll() -> (f64, f64) {
    with_quiet(|d| {
        let at = d.doc.viewport_scroll();
        (at.x, at.y)
    })
}

/// The Blitz document, for an embedding application (layout, paint, input).
#[allow(dead_code)]
pub fn with_document<R>(f: impl FnOnce(&mut BaseDocument) -> R) -> R {
    with(|d| f(&mut d.doc))
}

/// A DOMException's message as the program sees it.
fn dom_error(name: &str, message: impl std::fmt::Display) -> String {
    format!("{name}: {message}")
}

fn valid_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().any(|c| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '/' | '=')) {
        return Err(dom_error("InvalidCharacterError", format!("{name:?} is not a valid name")));
    }
    Ok(())
}

fn html_name(local: &str) -> QualName {
    QualName::new(None, ns!(html), LocalName::from(local.to_ascii_lowercase()))
}

fn ns_name(namespace: &Value, qualified: &str) -> QualName {
    let ns = match namespace {
        Value::Null | Value::Undefined => ns!(),
        Value::Str(s) => Namespace::from(s.as_str()),
        _ => ns!(),
    };
    match qualified.split_once(':') {
        Some((prefix, local)) => QualName::new(Some(prefix.into()), ns, LocalName::from(local)),
        None => QualName::new(None, ns, LocalName::from(qualified)),
    }
}

/// An HTML element's interface by its tag (HTMLElement for the rest), as a browser names them.
const HTML_INTERFACES: &[(&str, &str)] = &[
    ("iframe", "HTMLIFrameElement"), ("input", "HTMLInputElement"), ("textarea", "HTMLTextAreaElement"),
    ("select", "HTMLSelectElement"), ("form", "HTMLFormElement"), ("a", "HTMLAnchorElement"), ("img", "HTMLImageElement"),
    ("canvas", "HTMLCanvasElement"), ("div", "HTMLDivElement"), ("span", "HTMLSpanElement"), ("button", "HTMLButtonElement"),
    ("label", "HTMLLabelElement"), ("option", "HTMLOptionElement"), ("video", "HTMLVideoElement"), ("audio", "HTMLAudioElement"),
    ("p", "HTMLParagraphElement"), ("ul", "HTMLUListElement"), ("ol", "HTMLOListElement"), ("li", "HTMLLIElement"),
    ("table", "HTMLTableElement"), ("style", "HTMLStyleElement"), ("link", "HTMLLinkElement"), ("script", "HTMLScriptElement"),
    ("body", "HTMLBodyElement"), ("head", "HTMLHeadElement"), ("html", "HTMLHtmlElement"), ("dialog", "HTMLDialogElement"),
    ("details", "HTMLDetailsElement"), ("progress", "HTMLProgressElement"), ("template", "HTMLTemplateElement"),
    ("title", "HTMLTitleElement"), ("br", "HTMLBRElement"),
];

fn str_of(v: Option<&Value>) -> String {
    v.map(objects::to_display).unwrap_or_else(|| "undefined".into())
}

fn node_value(id: Option<NodeId>) -> Value {
    id.map_or(Value::Null, |n| Value::Object(objects::node_ref(n)))
}

fn target_value(t: Target) -> Value {
    match t {
        Target::Node(n) => Value::Object(objects::node_ref(n)),
        Target::Window => objects::global("window").unwrap_or(Value::Undefined),
    }
}

/// `o.camelCase` on a style declaration names the `kebab-case` property.
fn css_property(name: &str) -> String {
    if name.starts_with("--") {
        return name.to_string();
    }
    if name == "cssFloat" {
        return "float".into();
    }
    let mut k = String::new();
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            k.push('-');
            k.push(c.to_ascii_lowercase());
        } else {
            k.push(c);
        }
    }
    if k.starts_with("webkit-") || k.starts_with("moz-") || k.starts_with("ms-") { format!("-{k}") } else { k }
}

fn css_value(v: &Value) -> String {
    match v {
        Value::Null | Value::Undefined => String::new(),
        other => objects::to_display(other),
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Undefined | Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => *n != 0.0 && !n.is_nan(),
        Value::Str(s) => !s.is_empty(),
        Value::Object(_) | Value::Closure(_) | Value::Program(_) => true,
    }
}

// ---- the surface objects.rs calls ------------------------------------------------------------------------------

/// The document node.
pub fn document() -> NodeId {
    with(|d| d.root())
}

/// The document element's markup (the window's `dump` injection, Android's dump request).
pub fn document_html() -> String {
    with_quiet(|d| {
        let root = d.root();
        let mut html: String = d.children(root).into_iter().filter_map(|c| d.doc.get_node(c)).map(|n| n.outer_html()).collect();
        // SCRIPTC_HOST_DUMP_BOXES=1: each laid-out element's client rectangle after the markup (comparing layout with
        // a browser's getBoundingClientRect), one per line: depth, tag.class#id, x y width height.
        if std::env::var_os("SCRIPTC_HOST_DUMP_BOXES").is_some() {
            html.push_str("\n<!-- boxes\n");
            let mut stack = vec![(root, 0usize)];
            while let Some((n, depth)) = stack.pop() {
                if let Some(node) = d.doc.get_node(n)
                    && let Some(el) = node.element_data()
                    && let Some(r) = d.doc.transformed_client_rect(n)
                {
                    let class = el.attr(blitz_dom::local_name!("class")).unwrap_or_default().split_ascii_whitespace().collect::<Vec<_>>().join(".");
                    let id = el.attr(blitz_dom::local_name!("id")).map(|i| format!("#{i}")).unwrap_or_default();
                    // The style attribute as scripts left it (the markup keeps the parsed one).
                    let style = el.style_attribute_css(d.doc.guard());
                    let mut style = if style.is_empty() { style } else { format!(" style={{{style}}}") };
                    // Paint state: the used opacity when not 1, a stacking context's root (with its hoisted count).
                    if let Some(s) = node.primary_styles() {
                        let opacity = s.clone_opacity();
                        if opacity != 1.0 {
                            style.push_str(&format!(" opacity={opacity}"));
                        }
                    }
                    if let Some(sc) = &node.stacking_context {
                        style.push_str(&format!(" sc={}", sc.children.len()));
                    }
                    // A checkbox's or radio's checkedness (Blitz's state) and its computed border colour (what a
                    // `:checked` rule changed, if it matched).
                    if let Some(checked) = el.checkbox_input_checked() {
                        style.push_str(&format!(" checked={checked}"));
                        if let Some(s) = node.primary_styles() {
                            style.push_str(&format!(" border-top-color={:?}", s.get_border().border_top_color));
                        }
                    }
                    // Its ::before / ::after boxes: their rectangle and which background images have arrived.
                    for (name, pe) in [("before", node.pe_by_index(1)), ("after", node.pe_by_index(0))] {
                        let Some(pe) = pe.and_then(|p| d.doc.get_node(p)) else { continue };
                        let l = pe.final_layout();
                        let images = pe.element_data().map(|e| {
                            let state = |i: &Option<blitz_dom::node::ImageResourceData>| match i {
                                Some(i) if matches!(i.status, blitz_dom::node::Status::Ok) => "ok",
                                Some(_) => "pending",
                                None => "-",
                            };
                            let bg: Vec<&str> = e.background_images.iter().map(state).collect();
                            let border: Vec<&str> = e.border_images.iter().map(state).collect();
                            format!("bg[{}] border[{}]", bg.join(","), border.join(","))
                        });
                        let opacity = pe.primary_styles().map(|s| s.clone_opacity()).unwrap_or(1.0);
                        let bgc = pe
                            .primary_styles()
                            .map(|s| {
                                let c = s.get_background().background_color.resolve_to_absolute(&s.clone_color());
                                format!(" bgc=({:.2},{:.2},{:.2},{:.2})", c.components.0, c.components.1, c.components.2, c.alpha)
                            })
                            .unwrap_or_default();
                        style.push_str(&format!(
                            " ::{name}({:.0},{:.0} {:.0}x{:.0} {} op={opacity}{bgc})",
                            l.location.x,
                            l.location.y,
                            l.size.width,
                            l.size.height,
                            images.unwrap_or_default()
                        ));
                    }
                    html.push_str(&format!("{depth} {}{}{id} {:.1} {:.1} {:.1} {:.1}{style}\n", el.name.local, if class.is_empty() { String::new() } else { format!(".{class}") }, r.x, r.y, r.width, r.height).replace("--", "- -"));
                }
                for c in d.children(n).into_iter().rev() {
                    stack.push((c, depth + 1));
                }
            }
            html.push_str("-->\n");
        }
        html
    })
}



/// The centre (CSS px) of the smallest laid-out element whose text contains `needle` (case-insensitive): where an
/// injected `clicktext:` lands. None when nothing visible matches yet.
#[allow(dead_code)]
pub fn text_center(needle: &str) -> Option<(f64, f64)> {
    let needle = needle.to_lowercase();
    with_quiet(|d| {
        let mut best: Option<(f64, (f64, f64))> = None;
        let mut stack = vec![d.root()];
        while let Some(n) = stack.pop() {
            if let Some(node) = d.doc.get_node(n)
                && node.element_data().is_some()
                && node.text_content().to_lowercase().contains(&needle)
                && let Some(r) = d.doc.transformed_client_rect(n)
                && r.width > 0.0
                && r.height > 0.0
            {
                let area = r.width * r.height;
                if best.is_none_or(|(a, _)| area < a) {
                    best = Some((area, (r.x + r.width / 2.0, r.y + r.height / 2.0)));
                }
            }
            stack.extend(d.children(n));
        }
        best.map(|(_, c)| c)
    })
}

pub fn title() -> String {
    with(|d| d.title_element().and_then(|t| d.doc.get_node(t)).map(|n| n.text_content()).unwrap_or_default().split_ascii_whitespace().collect::<Vec<_>>().join(" "))
}

pub fn set_title(t: String) {
    with(|d| {
        let el = match d.title_element() {
            Some(el) => el,
            None => {
                let Some(head) = d.head() else { return };
                let el = d.mutate().create_element(html_name("title"), vec![]);
                d.mutate().append_children(head, &[el]);
                el
            }
        };
        d.set_text_content(el, &t);
    })
}



pub fn element_children(n: NodeId) -> Vec<NodeId> {
    with(|d| d.element_children(n))
}



pub fn interface_name(n: NodeId) -> String {
    if selection::is_fragment(n) {
        return "DocumentFragment".into();
    }
    with(|d| {
        let Some(node) = d.doc.get_node(n) else { return "Node".into() };
        match &node.data {
            NodeData::Document(_) => "HTMLDocument".into(),
            NodeData::Text(_) => "Text".into(),
            NodeData::Comment { .. } => "Comment".into(),
            _ => match node.element_data() {
                Some(e) if e.name.ns == ns!(html) => HTML_INTERFACES.iter().find(|(t, _)| *t == &*e.name.local).map_or("HTMLElement", |(_, i)| *i).into(),
                Some(e) if e.name.ns == ns!(svg) => "SVGElement".into(),
                Some(_) => "Element".into(),
                None => "Node".into(),
            },
        }
    })
}

pub fn get(n: NodeId, name: &str) -> Result<Option<Value>, String> {
    // Objects of their own (made outside the document's borrow).
    let (element, document) = with(|d| (d.is_element(n), d.is_document(n)));
    // A DocumentFragment (an element standing for one: selection.rs) answers as a fragment.
    if selection::is_fragment(n) {
        match name {
            "nodeType" => return Ok(Some(Value::Number(11.0))),
            "nodeName" => return Ok(Some(Value::Str("#document-fragment".into()))),
            "tagName" | "localName" | "id" | "className" => return Ok(Some(Value::Undefined)),
            _ => {}
        }
    }
    // A layout size read lays the document out first, as a browser's forced reflow does (a canvas inserted this turn
    // has a box at once).
    if element && matches!(name, "clientWidth" | "clientHeight" | "clientLeft" | "clientTop" | "offsetWidth" | "offsetHeight" | "scrollTop" | "scrollLeft" | "scrollWidth" | "scrollHeight") {
        resolve_layout();
    }
    match name {
        "children" if element || document => return Ok(Some(Value::Object(objects::children_ref(n)))),
        "childNodes" => return Ok(Some(objects::aux_value(Aux::ChildNodes(n)))),
        "classList" if element => return Ok(Some(objects::aux_value(Aux::ClassList(n)))),
        "dataset" if element => return Ok(Some(objects::aux_value(Aux::Dataset(n)))),
        "style" if element => return Ok(Some(objects::aux_value(Aux::Style(n)))),
        "defaultView" if document => return Ok(Some(target_value(Target::Window))),
        "title" if document => return Ok(Some(Value::Str(title()))),
        _ => {}
    }
    if let Some(kind) = name.strip_prefix("on") {
        if HANDLER_EVENTS.contains(&kind) {
            let found = with(|d| d.listeners.iter().find(|l| l.property && l.target == Target::Node(n) && l.kind == kind).map(|l| l.closure));
            return Ok(Some(found.map_or(Value::Null, Value::Closure)));
        }
    }
    with(|d| {
        let node = d.node(n)?;
        let element = node.is_element();
        Ok(Some(match name {
            "nodeType" => Value::Number(match &node.data {
                NodeData::Element(_) | NodeData::AnonymousBlock(_) => 1.0,
                NodeData::Text(_) => 3.0,
                NodeData::Comment { .. } => 8.0,
                NodeData::Document(_) => 9.0,
                #[allow(unreachable_patterns)]
                _ => 0.0,
            }),
            "nodeName" => Value::Str(d.node_name(n)),
            "tagName" if element => Value::Str(d.node_name(n)),
            "localName" if element => Value::Str(d.tag(n).unwrap_or_default()),
            "namespaceURI" => node.element_data().map_or(Value::Null, |e| Value::Str(e.name.ns.to_string())),
            "ownerDocument" => if document { Value::Null } else { node_value(Some(d.root())) },
            "parentNode" => node_value(node.parent),
            "parentElement" => node_value(node.parent.filter(|p| d.is_element(*p))),
            "firstChild" => node_value(node.children.first().copied()),
            "lastChild" => node_value(node.children.last().copied()),
            "nextSibling" => node_value(d.sibling(n, 1, false)),
            "previousSibling" => node_value(d.sibling(n, -1, false)),
            "firstElementChild" => node_value(d.element_children(n).first().copied()),
            "lastElementChild" => node_value(d.element_children(n).last().copied()),
            "nextElementSibling" => node_value(d.sibling(n, 1, true)),
            "previousElementSibling" => node_value(d.sibling(n, -1, true)),
            "childElementCount" => Value::Number(d.element_children(n).len() as f64),
            "isConnected" => Value::Bool(d.connected(n)),
            // Layout sizes (CSS px, rounded as browsers do; laid out above): client* the padding box (no scrollbars natively) and its border offsets, offset* the border box; the document
            // element's client size is the viewport's. 0 for a node without a box.
            "clientWidth" | "clientHeight" | "clientLeft" | "clientTop" | "offsetWidth" | "offsetHeight" if element => {
                let root = d.doc.root_element().id == n;
                let (w, h) = (d.doc.viewport().window_size.0 as f32, d.doc.viewport().window_size.1 as f32);
                let scale = d.doc.viewport().scale();
                let l = d.doc.get_node(n).map(|node| node.final_layout()).copied().unwrap_or_default();
                let v = match name {
                    "clientWidth" if root => w / scale,
                    "clientHeight" if root => h / scale,
                    "clientWidth" => l.size.width - l.border.left - l.border.right,
                    "clientHeight" => l.size.height - l.border.top - l.border.bottom,
                    "clientLeft" => l.border.left,
                    "clientTop" => l.border.top,
                    "offsetWidth" => l.size.width,
                    _ => l.size.height,
                };
                Value::Number(f64::from(v.max(0.0)).round())
            }
            // Scrolling (CSS px): the offset Blitz keeps per scroller, and the content's extent, the client box plus
            // the distance it scrolls (as a browser's scroll sizes; the client size for a box that does not scroll).
            "scrollTop" | "scrollLeft" if element => {
                let offset = d.doc.get_node(n).map_or((0.0, 0.0), |node| (node.scroll_offset().x, node.scroll_offset().y));
                Value::Number(if name == "scrollTop" { offset.1 } else { offset.0 })
            }
            "scrollWidth" | "scrollHeight" if element => {
                let l = d.doc.get_node(n).map(|node| node.final_layout()).copied().unwrap_or_default();
                let v = if name == "scrollHeight" {
                    l.size.height - l.border.top - l.border.bottom + l.scroll_height()
                } else {
                    l.size.width - l.border.left - l.border.right + l.scroll_width()
                };
                Value::Number(f64::from(v.max(0.0)).round())
            }
            "contentEditable" if d.is_element(n) => Value::Str(d.content_editable(n).into()),
            "isContentEditable" => Value::Bool(d.is_content_editable(n)),
            "nodeValue" => match &node.data {
                NodeData::Text(t) => Value::Str(t.content.clone()),
                NodeData::Comment { contents } => Value::Str(contents.clone()),
                _ => Value::Null,
            },
            "data" | "wholeText" => match &node.data {
                NodeData::Text(t) => Value::Str(t.content.clone()),
                NodeData::Comment { contents } => Value::Str(contents.clone()),
                _ => return Ok(d.expando(n, name)),
            },
            "length" if !element && !document => match &node.data {
                NodeData::Text(t) => Value::Number(t.content.encode_utf16().count() as f64),
                NodeData::Comment { contents } => Value::Number(contents.encode_utf16().count() as f64),
                _ => return Ok(d.expando(n, name)),
            },
            "textContent" => match &node.data {
                NodeData::Document(_) => Value::Null,
                NodeData::Comment { contents } => Value::Str(contents.clone()),
                _ => Value::Str(node.text_content()),
            },
            "innerHTML" if element => Value::Str(d.inner_html(n)),
            "outerHTML" if element => Value::Str(node.outer_html()),
            // Reflected attributes (absent reads as "").
            "id" | "className" | "dir" | "lang" | "name" if element => {
                let attr = if name == "className" { "class" } else { name };
                Value::Str(d.read_attr(n, attr).unwrap_or_default())
            }
            "title" if element => Value::Str(d.read_attr(n, "title").unwrap_or_default()),
            "hidden" | "disabled" | "selected" | "multiple" | "defaultChecked" | "required" | "readOnly" if element => {
                let attr = match name {
                    "defaultChecked" => "checked",
                    "readOnly" => "readonly",
                    other => other,
                };
                Value::Bool(d.read_attr(n, attr).is_some())
            }
            // A text field's (text_field.rs): its editor's text.
            "value" if element && text_field::is_field(d, n) => Value::Str(text_field::value(d, n)),
            "defaultValue" if element && text_field::is_field(d, n) => Value::Str(text_field::default_value(d, n)),
            "value" if element => match node.element_data().and_then(|e| e.text_input_data()) {
                Some(t) => Value::Str(t.editor.raw_text().to_string()),
                None => Value::Str(d.read_attr(n, "value").unwrap_or_default()),
            },
            "defaultValue" if element => Value::Str(d.read_attr(n, "value").unwrap_or_default()),
            "selectionStart" | "selectionEnd" | "selectionDirection" if element && matches!(d.tag(n).as_deref(), Some("input" | "textarea")) => {
                if !text_field::has_selection_api(d, n) {
                    Value::Null
                } else {
                    let (start, end, dir) = text_field::selection(d, n);
                    match name {
                        "selectionStart" => Value::Number(start as f64),
                        "selectionEnd" => Value::Number(end as f64),
                        _ => Value::Str(dir.into()),
                    }
                }
            }
            "maxLength" | "minLength" if element && matches!(d.tag(n).as_deref(), Some("input" | "textarea")) => {
                let attr = if name == "maxLength" { "maxlength" } else { "minlength" };
                Value::Number(d.read_attr(n, attr).and_then(|v| v.trim().parse::<i32>().ok()).filter(|v| *v >= 0).map_or(-1.0, f64::from))
            }
            "placeholder" if element && matches!(d.tag(n).as_deref(), Some("input" | "textarea")) => Value::Str(d.read_attr(n, "placeholder").unwrap_or_default()),
            "form" if element && matches!(d.tag(n).as_deref(), Some("input" | "textarea" | "button" | "select")) => node_value(text_field::form_of(d, n)),
            "checked" if element => Value::Bool(match node.element_data().and_then(|e| e.checkbox_input_checked()) {
                Some(c) => c,
                None => d.read_attr(n, "checked").is_some_and(|v| v != "false"),
            }),
            "type" if element => match d.tag(n).as_deref() {
                Some(tag @ ("input" | "button")) => Value::Str(
                    d.read_attr(n, "type").map(|t| t.to_ascii_lowercase()).unwrap_or_else(|| if tag == "input" { "text".into() } else { "submit".into() }),
                ),
                _ => Value::Str(d.read_attr(n, "type").unwrap_or_default()),
            },
            "tabIndex" if element => Value::Number(match d.read_attr(n, "tabindex").and_then(|v| v.trim().parse::<i32>().ok()) {
                Some(i) => i as f64,
                None if matches!(d.tag(n).as_deref(), Some("a" | "area" | "button" | "input" | "select" | "textarea" | "summary" | "iframe")) => 0.0,
                None => -1.0,
            }),
            "width" | "height" if matches!(d.tag(n).as_deref(), Some("canvas" | "img" | "video")) => {
                let attr = d.read_attr(n, name).and_then(|v| v.trim().parse::<u32>().ok());
                let default = match (d.tag(n).as_deref(), name) {
                    (Some("canvas"), "width") => 300.0,
                    (Some("canvas"), _) => 150.0,
                    _ => 0.0,
                };
                Value::Number(attr.map_or(default, f64::from))
            }
            // The document's members.
            "body" if document => node_value(d.body()),
            "head" if document => node_value(d.head()),
            "documentElement" if document => node_value(d.document_element()),
            "activeElement" if document => node_value(d.doc.get_focussed_node_id().filter(|f| d.is_element(*f)).or_else(|| d.body())),
            "readyState" if document => Value::Str("complete".into()),
            "URL" | "documentURI" if document => Value::Str(d.doc.base_url().to_string()),
            "baseURI" => Value::Str(d.doc.base_url().to_string()),
            "compatMode" if document => Value::Str("CSS1Compat".into()),
            "characterSet" if document => Value::Str("UTF-8".into()),
            // The Fullscreen API: the window full screen (the fullscreen section below).
            "fullscreenEnabled" | "webkitFullscreenEnabled" if document => Value::Bool(fullscreen_enabled()),
            "fullscreenElement" | "webkitFullscreenElement" | "webkitCurrentFullScreenElement" if document => node_value(fullscreen_element(d)),
            "fullscreen" | "webkitIsFullScreen" if document => Value::Bool(fullscreen_element(d).is_some()),
            "pointerLockElement" if document => node_value(pointer_lock_element(d)),
            // Page visibility: hidden while the window is minimized (the visibility section below).
            "visibilityState" | "webkitVisibilityState" if document => Value::Str(if page_hidden() { "hidden" } else { "visible" }.into()),
            "hidden" | "webkitHidden" if document => Value::Bool(page_hidden()),
            _ => return Ok(d.expando(n, name)),
        }))
    })
}

impl Dom {
    fn expando(&self, n: NodeId, name: &str) -> Option<Value> {
        self.expandos.get(&n)?.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
    }
}

/// The event handler properties (`el.onclick = f`).
const HANDLER_EVENTS: &[&str] = &[
    "click", "dblclick", "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "contextmenu",
    "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel",
    "keydown", "keyup", "keypress", "input", "change", "submit", "focus", "blur", "focusin", "focusout", "wheel", "scroll",
    "load", "error", "resize", "touchstart", "touchend", "touchmove", "touchcancel", "fullscreenchange", "fullscreenerror",
    "visibilitychange", "copy", "cut", "paste", "beforeinput",
];

pub fn set(n: NodeId, name: &str, value: Value) -> Result<(), String> {
    // A scroll position written: laid out first (its range), clamped to it, at once (a programmatic scroll).
    if matches!(name, "scrollTop" | "scrollLeft") && with(|d| d.is_element(n)) {
        resolve_layout();
        let to = match &value {
            Value::Number(x) if x.is_finite() => *x,
            other => objects::to_display(other).trim().parse().unwrap_or(0.0),
        };
        with(|d| {
            let at = d.doc.get_node(n).map_or((0.0, 0.0), |node| (node.scroll_offset().x, node.scroll_offset().y));
            let (x, y) = if name == "scrollTop" { (at.0, to) } else { (to, at.1) };
            d.doc.scroll_to(n, x, y, blitz_dom::ScrollBehavior::Instant);
        });
        repaint();
        return Ok(());
    }
    if let Some(kind) = name.strip_prefix("on") {
        if HANDLER_EVENTS.contains(&kind) {
            let closure = match value {
                Value::Closure(c) => Some(c),
                _ => None,
            };
            set_handler(Target::Node(n), kind, closure);
            return Ok(());
        }
    }
    // A text field's selection, set (text_field.rs): setSelectionRange with the other ends kept.
    if matches!(name, "selectionStart" | "selectionEnd" | "selectionDirection") && with(|d| text_field::has_selection_api(d, n)) {
        let (start, end, dir) = with(|d| text_field::selection(d, n));
        let at = match &value {
            Value::Number(x) if x.is_finite() && *x >= 0.0 => *x as usize,
            other => objects::to_display(other).trim().parse().unwrap_or(0),
        };
        match name {
            "selectionStart" => text_field::set_selection_range(n, at, end.max(at), dir),
            "selectionEnd" => text_field::set_selection_range(n, start, at, dir),
            _ => text_field::set_selection_range(n, start, end, &objects::to_display(&value)),
        }
        return Ok(());
    }
    let (element, document) = with(|d| (d.is_element(n), d.is_document(n)));
    if document && name == "title" {
        set_title(objects::to_display(&value));
        return Ok(());
    }
    // Strings of the value, read before the document is borrowed (a node's string reads its interface).
    let text = match &value {
        Value::Null => String::new(),
        v => objects::to_display(v),
    };
    let mut old: Option<Value> = None;
    let r = with(|d| {
        match name {
            "textContent" => d.set_text_content(n, &text),
            "nodeValue" | "data" if !element && !document => d.set_text_content(n, &text),
            "innerHTML" if element => d.set_inner_html(n, &text),
            "className" if element => d.set_attr(n, "class", &text),
            "id" | "title" | "dir" | "lang" | "name" if element => d.set_attr(n, name, &text),
            "type" if element => d.set_attr(n, "type", &text),
            // contenteditable reflected: "true" / "false" / "plaintext-only" set it, "inherit" removes it.
            "contentEditable" if element => match text.to_ascii_lowercase().as_str() {
                "inherit" => d.clear_attr(n, "contenteditable"),
                v @ ("true" | "false" | "plaintext-only") => d.set_attr(n, "contenteditable", v),
                _ => return Err(dom_error("SyntaxError", format!("Failed to set the 'contentEditable' property on 'HTMLElement': The value provided ('{text}') is not one of 'true', 'false', 'plaintext-only', or 'inherit'."))),
            },
            // A text field's value is its editor's text (text_field.rs); before it is laid out, its default value
            // seeds the editor Blitz makes.
            "value" | "defaultValue" if element && text_field::is_field(d, n) => {
                let textarea = d.tag(n).as_deref() == Some("textarea");
                if name == "defaultValue" || !text_field::set_value(d, n, &text) {
                    if textarea { d.set_text_content(n, &text) } else { d.set_attr(n, "value", &text) }
                }
            }
            "value" | "defaultValue" if element => d.set_attr(n, "value", &text),
            "placeholder" if element => d.set_attr(n, "placeholder", &text),
            "maxLength" | "minLength" if element => {
                let attr = if name == "maxLength" { "maxlength" } else { "minlength" };
                let i = match &value {
                    Value::Number(x) if x.is_finite() => x.trunc() as i64,
                    Value::Str(s) => s.trim().parse().unwrap_or(0),
                    _ => 0,
                };
                if i < 0 {
                    return Err(dom_error("IndexSizeError", format!("Failed to set the '{name}' property on 'HTMLInputElement': The value provided ({i}) is negative.")));
                }
                d.set_attr(n, attr, &i.to_string())
            }
            // The checkedness (Blitz's state, as a browser's property is: the attribute stays the default).
            "checked" if element => text_field::set_checked(d, n, truthy(&value)),
            "hidden" | "disabled" | "selected" | "multiple" | "defaultChecked" | "required" | "readOnly" if element => {
                let attr = match name {
                    "defaultChecked" => "checked",
                    "readOnly" => "readonly",
                    other => other,
                };
                if truthy(&value) { d.set_attr(n, attr, "") } else { d.clear_attr(n, attr) }
            }
            "tabIndex" if element => {
                let i = match &value {
                    Value::Number(x) if x.is_finite() => x.trunc() as i64,
                    Value::Str(s) => s.trim().parse().unwrap_or(0),
                    _ => 0,
                };
                d.set_attr(n, "tabindex", &i.to_string());
            }
            "width" | "height" if matches!(d.tag(n).as_deref(), Some("canvas" | "img" | "video")) => {
                let i = match &value {
                    Value::Number(x) if x.is_finite() && *x >= 0.0 => x.trunc() as u64,
                    Value::Str(s) => s.trim().parse().unwrap_or(0),
                    _ => 0,
                };
                d.set_attr(n, name, &i.to_string());
            }
            // Read-only members ignore the write (as JavaScript does outside strict mode).
            "nodeType" | "nodeName" | "tagName" | "parentNode" | "parentElement" | "firstChild" | "lastChild" | "nextSibling"
            | "previousSibling" | "children" | "childNodes" | "isConnected" | "ownerDocument" | "childElementCount" => {}
            // Anything else is a property of the node object (an expando).
            _ => {
                match &value {
                    Value::Object(r) => objects::retain(*r),
                    Value::Closure(c) | Value::Program(c) => abi::closure_retain(*c),
                    _ => {}
                }
                let props = d.expandos.entry(n).or_default();
                match props.iter_mut().find(|(k, _)| k == name) {
                    Some(slot) => old = Some(std::mem::replace(&mut slot.1, value.clone())),
                    None => props.push((name.to_string(), value.clone())),
                }
            }
        }
        Ok(())
    });
    release_value(old);
    r
}

fn release_value(v: Option<Value>) {
    match v {
        Some(Value::Object(r)) => objects::release(r),
        Some(Value::Closure(c) | Value::Program(c)) => abi::closure_release(c),
        _ => {}
    }
}

/// `on<kind> = f` (null clears it).
fn set_handler(target: Target, kind: &str, closure: Option<u64>) {
    if let Some(c) = closure {
        abi::closure_retain(c);
    }
    let old = with(|d| {
        let old: Vec<u64> = d.listeners.iter().filter(|l| l.property && l.target == target && l.kind == kind).map(|l| l.closure).collect();
        d.listeners.retain(|l| !(l.property && l.target == target && l.kind == kind));
        if let Some(c) = closure {
            let id = d.next_listener;
            d.next_listener += 1;
            d.listeners.push(Listener { id, target, kind: kind.to_string(), capture: false, once: false, property: true, closure: c });
        }
        old
    });
    for c in old {
        abi::closure_release(c);
    }
}

const NODE_METHODS: &[&str] = &[
    "appendChild", "insertBefore", "removeChild", "replaceChild", "append", "prepend", "replaceChildren", "remove", "before", "after",
    "replaceWith", "contains", "getRootNode", "hasChildNodes", "cloneNode", "isSameNode", "addEventListener", "removeEventListener",
    "dispatchEvent", "toString",
];
const ELEMENT_METHODS: &[&str] = &[
    "setAttribute", "getAttribute", "removeAttribute", "hasAttribute", "toggleAttribute", "hasAttributes", "setAttributeNS",
    "removeAttributeNS", "getAttributeNS", "click", "focus", "blur", "closest", "matches", "querySelector", "querySelectorAll",
    "getElementsByTagName", "getElementsByClassName", "getBoundingClientRect", "getClientRects",
    "setPointerCapture", "releasePointerCapture", "hasPointerCapture", "requestPointerLock", "requestFullscreen",
    "webkitRequestFullscreen",
];
const DOCUMENT_METHODS: &[&str] = &[
    "createElement", "createElementNS", "createTextNode", "createComment", "createEvent", "getElementById", "querySelector",
    "querySelectorAll", "getElementsByTagName", "getElementsByClassName", "hasFocus", "exitPointerLock",
    "exitFullscreen", "webkitExitFullscreen", "createRange", "getSelection", "createDocumentFragment",
];

/// HTMLMediaElement's methods, on a video or audio element.
const MEDIA_METHODS: &[&str] = &["play", "pause", "load", "canPlayType"];

pub fn has_method(n: NodeId, name: &str) -> bool {
    let (element, document) = with(|d| (d.is_element(n), d.is_document(n)));
    NODE_METHODS.contains(&name) || (element && ELEMENT_METHODS.contains(&name)) || (document && DOCUMENT_METHODS.contains(&name))
        || (MEDIA_METHODS.contains(&name) && matches!(tag_of(n).as_deref(), Some("video" | "audio")))
        || (matches!(name, "setSelectionRange" | "select") && matches!(tag_of(n).as_deref(), Some("input" | "textarea")))
}

pub fn call(n: NodeId, name: &str, args: &[Value]) -> Result<Value, String> {
    if !has_method(n, name) {
        return Err(format!("{name} is not a function"));
    }
    let node_arg = |i: usize| match args.get(i) {
        Some(Value::Object(r)) => objects::node_id(*r).ok_or_else(|| format!("Failed to execute '{name}': parameter {} is not of type 'Node'.", i + 1)),
        _ => Err(format!("Failed to execute '{name}': parameter {} is not of type 'Node'.", i + 1)),
    };
    // Every argument as a string, read before the document is borrowed (a node's string reads its interface).
    let strs: Vec<String> = args.iter().map(objects::to_display).collect();
    let arg = |i: usize| strs.get(i).cloned().unwrap_or_else(|| "undefined".into());
    // A node, or a string as a new text node (append, prepend, before, after, replaceWith, replaceChildren).
    let nodes_of = |args: &[Value]| -> Vec<Result<NodeId, String>> {
        args.iter()
            .map(|v| match v {
                Value::Object(r) if objects::node_id(*r).is_some() => Ok(objects::node_id(*r).unwrap()),
                other => {
                    let s = objects::to_display(other);
                    Err(s)
                }
            })
            .collect()
    };
    match name {
        "toString" => return Ok(Value::Str(format!("[object {}]", interface_name(n)))),
        // No media decoding natively: play() rejects as a browser's does for a source it cannot play (the page's
        // catch moves on, as the intro film closes), and there is nothing to pause or load.
        "play" => {
            let promise = crate::values::new_promise();
            let Value::Object(r) = promise else { unreachable!() };
            crate::values::settle(r, true, &crate::values::new_error("NotSupportedError", "The element has no supported sources."));
            return Ok(promise);
        }
        "pause" | "load" => return Ok(Value::Undefined),
        // The pointer lock (the input section below).
        "requestPointerLock" => return Ok(request_pointer_lock(n)),
        "exitPointerLock" => {
            exit_pointer_lock();
            return Ok(Value::Undefined);
        }
        // A text field's selection (text_field.rs).
        "setSelectionRange" => {
            if !with(|d| text_field::has_selection_api(d, n)) {
                return Err(dom_error("InvalidStateError", "Failed to execute 'setSelectionRange' on 'HTMLInputElement': The input element's type does not support selection."));
            }
            let num = |i: usize| match args.get(i) {
                Some(Value::Number(x)) if x.is_finite() && *x >= 0.0 => *x as usize,
                Some(Value::Number(x)) if x.is_finite() => 0,
                Some(Value::Undefined) | None => 0,
                Some(other) => objects::to_display(other).trim().parse().unwrap_or(0),
            };
            let direction = match args.get(2) {
                Some(Value::Str(s)) => s.clone(),
                _ => "none".into(),
            };
            text_field::set_selection_range(n, num(0), num(1), &direction);
            return Ok(Value::Undefined);
        }
        "select" => {
            if with(|d| text_field::is_field(d, n)) {
                text_field::select_all(n);
            }
            return Ok(Value::Undefined);
        }
        // Fullscreen (the fullscreen section below).
        "requestFullscreen" | "webkitRequestFullscreen" => return Ok(request_fullscreen(n)),
        "exitFullscreen" | "webkitExitFullscreen" => {
            let promise = crate::values::new_promise();
            let Value::Object(r) = promise else { unreachable!() };
            exit_fullscreen(Some(r));
            return Ok(promise);
        }
        "canPlayType" => return Ok(Value::Str(String::new())),
        // Its border box in viewport CSS px, laid out first (a forced reflow, as the size members do); transforms
        // included, as the page sees the box drawn. A node without a box answers a zero rect.
        "getBoundingClientRect" => {
            let [x, y, w, h] = with_quiet(|d| {
                resolve_doc(&mut d.doc, "getBoundingClientRect");
                d.doc.transformed_client_rect(n).map_or([0.0; 4], |r| [r.x, r.y, r.width, r.height])
            });
            return client_rect([x, y, w, h]);
        }
        // Its boxes: none for an element that generates no box (`display: none` on it or an ancestor, the visibility
        // test pad navigation makes), else its border box as getBoundingClientRect gives it (one box: line fragments
        // of an inline element are not split out).
        // Pointer capture: the pointer's events go to this element until it lifts or the capture is released.
        "setPointerCapture" | "releasePointerCapture" | "hasPointerCapture" => {
            let id = match args.first() {
                Some(Value::Number(v)) => *v as i32,
                _ => return Err(format!("Failed to execute '{name}' on 'Element': 1 argument required.")),
            };
            return Ok(match name {
                "setPointerCapture" => {
                    if !ACTIVE_POINTERS.with(|a| a.borrow().contains(&id)) {
                        return Err("NotFoundError: Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.".into());
                    }
                    CAPTURES.with(|c| c.borrow_mut().insert(id, n));
                    Value::Undefined
                }
                "releasePointerCapture" => {
                    CAPTURES.with(|c| {
                        let mut c = c.borrow_mut();
                        if c.get(&id) == Some(&n) {
                            c.remove(&id);
                        }
                    });
                    Value::Undefined
                }
                _ => Value::Bool(CAPTURES.with(|c| c.borrow().get(&id) == Some(&n))),
            });
        }
        "getClientRects" => {
            let rect = with_quiet(|d| {
                resolve_doc(&mut d.doc, "getClientRects");
                let mut at = Some(n);
                while let Some(id) = at {
                    if d.doc.resolved_style_value(id, "display") == "none" {
                        return None;
                    }
                    at = d.doc.get_node(id).and_then(|node| node.parent);
                }
                d.doc.transformed_client_rect(n).map(|r| [r.x, r.y, r.width, r.height])
            });
            let rects = match rect {
                Some(r) => vec![client_rect(r)?],
                None => Vec::new(),
            };
            return Ok(crate::values::new_array(&rects));
        }
        "addEventListener" | "removeEventListener" => return listener(Target::Node(n), name == "addEventListener", args),
        "dispatchEvent" => return dispatch_event_arg(Target::Node(n), args),
        // Ranges, the selection and fragments (selection.rs).
        "createRange" => return Ok(selection::create_range()),
        "getSelection" => return Ok(selection::get_selection()),
        "createDocumentFragment" => return Ok(selection::create_fragment()),
        // The focus moves with its events (blur and focusout at the old element, focus and focusin at the new), as
        // a press moves it; an editing host the selection is not in gets a caret at its start.
        // Only a focusable element takes it (a browser's focus() on another does nothing); `:focus-visible` as the
        // browser's heuristic decides.
        "focus" => {
            let old = with(focused_element);
            if old != Some(n) && with(|d| d.is_element(n) && d.connected(n) && focusable(d, n)) {
                change_focus(old, Some(n))?;
                set_focus_visible(focus_visible_for(n));
                selection::focus_caret(n);
            }
            return Ok(Value::Undefined);
        }
        "blur" => {
            if with(focused_element) == Some(n) {
                change_focus(Some(n), None)?;
                selection::sync_caret();
            }
            return Ok(Value::Undefined);
        }
        // click(): a click with its activation (a checkbox toggles), none for a disabled control.
        "click" => {
            if !with(|d| disabled_control(d, n)) {
                text_field::click_with_activation(n, || {
                    let ev = with(|d| d.new_event("click", true, true, false));
                    fire(Target::Node(n), ev)
                })?;
            }
            return Ok(Value::Undefined);
        }
        "createEvent" => {
            let ev = with(|d| d.new_event("", false, false, false));
            return Ok(objects::aux_value(Aux::Event(ev)));
        }
        "querySelectorAll" => {
            let sel = arg(0);
            let found = with(|d| d.select(n, &sel))?;
            return Ok(objects::aux_value(Aux::List(found.into())));
        }
        "getElementsByTagName" | "getElementsByClassName" => {
            let a = arg(0);
            let sel = if name == "getElementsByTagName" {
                a.trim().to_string()
            } else {
                a.split_ascii_whitespace().map(|c| format!(".{}", css_escape(c))).collect::<String>()
            };
            if sel.is_empty() {
                return Ok(objects::aux_value(Aux::List(Rc::from(Vec::new()))));
            }
            return Ok(objects::aux_value(Aux::Collection(n, sel.into())));
        }
        _ => {}
    }
    let insert_list = match name {
        "append" | "prepend" | "replaceChildren" | "before" | "after" | "replaceWith" => Some(nodes_of(args)),
        _ => None,
    };
    with(|d| {
        Ok(match name {
            "appendChild" => {
                d.append(n, node_arg(0)?)?;
                args[0].clone()
            }
            "insertBefore" => {
                let reference = match args.get(1) {
                    None | Some(Value::Null | Value::Undefined) => None,
                    Some(_) => Some(node_arg(1)?),
                };
                d.insert_before(n, node_arg(0)?, reference)?;
                args[0].clone()
            }
            "removeChild" => {
                let c = node_arg(0)?;
                if d.parent(c) != Some(n) {
                    return Err(dom_error("NotFoundError", "the node to be removed is not a child of this node"));
                }
                d.detach(c);
                args[0].clone()
            }
            "replaceChild" => {
                let (new, old) = (node_arg(0)?, node_arg(1)?);
                if d.parent(old) != Some(n) {
                    return Err(dom_error("NotFoundError", "the node to be replaced is not a child of this node"));
                }
                d.check_hierarchy(n, new)?;
                if new != old {
                    d.detach(new);
                    d.mutate().replace_node_with(old, &[new]);
                }
                args[1].clone()
            }
            "append" | "prepend" | "replaceChildren" | "before" | "after" | "replaceWith" => {
                let mut nodes = Vec::new();
                for item in insert_list.unwrap() {
                    match item {
                        // A DocumentFragment inserts its children (selection.rs).
                        Ok(id) if selection::is_fragment(id) => nodes.extend(d.children(id)),
                        Ok(id) => nodes.push(id),
                        Err(text) => nodes.push(d.mutate().create_text_node(&text)),
                    }
                }
                let parent = match name {
                    "before" | "after" | "replaceWith" => match d.parent(n) {
                        Some(p) => p,
                        None => return Ok(Value::Undefined),
                    },
                    _ => n,
                };
                for &c in &nodes {
                    d.check_hierarchy(parent, c)?;
                }
                // The anchor the nodes go before, chosen before any of them move (a viable next sibling).
                let anchor = match name {
                    "prepend" => d.children(n).into_iter().find(|c| !nodes.contains(c)),
                    "before" => Some(n),
                    "after" | "replaceWith" => {
                        let mut at = d.sibling(n, 1, false);
                        while let Some(s) = at.filter(|s| nodes.contains(s)) {
                            at = d.sibling(s, 1, false);
                        }
                        at
                    }
                    _ => None,
                };
                if name == "replaceChildren" {
                    d.remove_children(n);
                }
                if name == "replaceWith" && !nodes.contains(&n) {
                    d.detach(n);
                }
                for &c in &nodes {
                    if Some(c) != anchor || name != "before" {
                        d.detach(c);
                    }
                }
                match anchor {
                    Some(a) if d.parent(a) == Some(parent) && !nodes.contains(&a) => d.mutate().insert_nodes_before(a, &nodes),
                    _ => d.mutate().append_children(parent, &nodes),
                }
                Value::Undefined
            }
            "remove" => {
                d.detach(n);
                Value::Undefined
            }
            "contains" => match args.first() {
                Some(Value::Object(r)) => match objects::node_id(*r) {
                    Some(mut other) => loop {
                        if other == n {
                            break Value::Bool(true);
                        }
                        match d.parent(other) {
                            Some(p) => other = p,
                            None => break Value::Bool(false),
                        }
                    },
                    None => Value::Bool(false),
                },
                _ => Value::Bool(false),
            },
            "getRootNode" => {
                let mut id = n;
                while let Some(p) = d.parent(id) {
                    id = p;
                }
                node_value(Some(id))
            }
            "hasChildNodes" => Value::Bool(!d.children(n).is_empty()),
            "isSameNode" => Value::Bool(matches!(args.first(), Some(Value::Object(r)) if objects::node_id(*r) == Some(n))),
            "cloneNode" => {
                let deep = args.first().is_some_and(truthy);
                let copy = if deep {
                    d.mutate().deep_clone_node(n)
                } else {
                    let node = d.node(n)?;
                    match &node.data {
                        NodeData::Element(e) => {
                            let (name, attrs) = (e.name.clone(), e.attrs().to_vec());
                            d.mutate().create_element(name, attrs)
                        }
                        NodeData::Text(t) => {
                            let text = t.content.clone();
                            d.mutate().create_text_node(&text)
                        }
                        NodeData::Comment { contents } => {
                            let text = contents.clone();
                            d.mutate().create_comment_node(&text)
                        }
                        _ => return Err(dom_error("NotSupportedError", "this node cannot be cloned")),
                    }
                };
                node_value(Some(copy))
            }
            "setAttribute" => {
                valid_name(&arg(0))?;
                d.set_attr(n, &arg(0), &arg(1));
                Value::Undefined
            }
            "getAttribute" => {
                let q = d.attr_name(n, &arg(0));
                d.read_attr(n, &q.local).map_or(Value::Null, Value::Str)
            }
            "removeAttribute" => {
                d.clear_attr(n, &arg(0));
                Value::Undefined
            }
            "hasAttribute" => {
                let q = d.attr_name(n, &arg(0));
                Value::Bool(d.read_attr(n, &q.local).is_some())
            }
            "hasAttributes" => Value::Bool(d.node(n)?.element_data().is_some_and(|e| !e.attrs().is_empty())),
            "toggleAttribute" => {
                valid_name(&arg(0))?;
                let q = d.attr_name(n, &arg(0));
                let present = d.read_attr(n, &q.local).is_some();
                let on = match args.get(1) {
                    None | Some(Value::Undefined) => !present,
                    Some(force) => truthy(force),
                };
                if on && !present {
                    d.mutate().set_attribute(n, q, "");
                } else if !on && present {
                    d.mutate().clear_attribute(n, q);
                }
                Value::Bool(on)
            }
            "setAttributeNS" => {
                let q = ns_name(args.first().unwrap_or(&Value::Null), &arg(1));
                d.mutate().set_attribute(n, q, &arg(2));
                Value::Undefined
            }
            "removeAttributeNS" => {
                let q = ns_name(args.first().unwrap_or(&Value::Null), &arg(1));
                d.mutate().clear_attribute(n, q);
                Value::Undefined
            }
            "getAttributeNS" => {
                let q = ns_name(args.first().unwrap_or(&Value::Null), &arg(1));
                let el = d.node(n)?.element_data();
                el.and_then(|e| e.attrs().iter().find(|a| a.name.ns == q.ns && a.name.local == q.local).map(|a| a.value.clone())).map_or(Value::Null, Value::Str)
            }
            "hasFocus" => Value::Bool(WINDOW_FOCUSED.with(|f| f.get())),
            "matches" => Value::Bool(d.matches(n, &arg(0))?),
            "closest" => {
                let sel = arg(0);
                let mut at = Some(n);
                let mut found = None;
                while let Some(id) = at {
                    if d.matches(id, &sel)? {
                        found = Some(id);
                        break;
                    }
                    at = d.parent(id);
                }
                node_value(found)
            }
            "querySelector" => node_value(d.select_first(n, &arg(0))?),
            "getElementById" => node_value(d.get_element_by_id(n, &arg(0))),
            "createElement" => {
                valid_name(&arg(0))?;
                node_value(Some(d.mutate().create_element(html_name(&arg(0)), vec![])))
            }
            "createElementNS" => {
                let q = ns_name(args.first().unwrap_or(&Value::Null), &arg(1));
                node_value(Some(d.mutate().create_element(q, vec![])))
            }
            "createTextNode" => node_value(Some(d.mutate().create_text_node(&arg(0)))),
            "createComment" => node_value(Some(d.mutate().create_comment_node(&arg(0)))),
            other => return Err(format!("{other} is not a function")),
        })
    })
}

/// A class name as a selector's identifier (CSS.escape for what class tokens hold).
fn css_escape(s: &str) -> String {
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_ascii_alphanumeric() && !(i == 0 && c.is_ascii_digit()) || c == '-' || c == '_' || !c.is_ascii() {
            out.push(c);
        } else {
            out.push_str(&format!("\\{:x} ", c as u32));
        }
    }
    out
}

/// `addEventListener(type, listener[, capture])` / `removeEventListener`: the third argument is a boolean (capture);
/// an options dictionary is not a host value, so it reads as not capturing.
fn listener(target: Target, add: bool, args: &[Value]) -> Result<Value, String> {
    let kind = str_of(args.first());
    let closure = match args.get(1) {
        Some(Value::Closure(c)) => *c,
        Some(Value::Null | Value::Undefined) | None => return Ok(Value::Undefined),
        Some(_) => return Err(format!("Failed to execute '{}': parameter 2 is not of type 'Object'.", if add { "addEventListener" } else { "removeEventListener" })),
    };
    let capture = args.get(2).is_some_and(|o| matches!(o, Value::Bool(true)));
    let existing = with(|d| d.listeners.iter().position(|l| !l.property && l.target == target && l.kind == kind && l.capture == capture && l.closure == closure));
    match (add, existing) {
        (true, None) => {
            abi::closure_retain(closure);
            with(|d| {
                let id = d.next_listener;
                d.next_listener += 1;
                d.listeners.push(Listener { id, target, kind, capture, once: false, property: false, closure });
            });
        }
        (false, Some(i)) => {
            let c = with(|d| d.listeners.remove(i).closure);
            abi::closure_release(c);
        }
        _ => {}
    }
    Ok(Value::Undefined)
}

fn dispatch_event_arg(target: Target, args: &[Value]) -> Result<Value, String> {
    let ev = match args.first() {
        Some(Value::Object(r)) => match objects::aux_of(*r) {
            Some(Aux::Event(i)) => i,
            _ => return Err("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.".into()),
        },
        _ => return Err("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.".into()),
    };
    let (dispatching, kind) = with(|d| d.event(ev).map(|e| (e.dispatching, e.kind.clone())))?;
    if dispatching || kind.is_empty() {
        return Err(dom_error("InvalidStateError", "the event is already being dispatched or was not initialized"));
    }
    let Some(Value::Object(r)) = args.first() else { unreachable!() };
    Ok(Value::Bool(dispatch(target, ev, *r)?))
}

/// Dispatches a fresh event the host made (one count, released after).
fn fire(target: Target, ev: usize) -> Result<bool, String> {
    let r = objects::aux_ref(Aux::Event(ev));
    let out = dispatch(target, ev, r);
    objects::release(r);
    out
}

/// The DOM's dispatch: the path is the target and its ancestors, then the window when the target is in the document.
/// Capturing listeners run from the window down to the target, then the target's own, then (when the event bubbles)
/// the non-capturing ones back up. stopPropagation ends the dispatch after the current node; stopImmediatePropagation at
/// once. A listener that throws is reported and the dispatch goes on, as the DOM's "inner invoke" says (a browser
/// reports the exception; it never reaches dispatchEvent's or click()'s caller): [`report_exception`]. Answers
/// whether the event was not canceled.
fn dispatch(target: Target, ev: usize, ev_ref: u64) -> Result<bool, String> {
    let path: Vec<Target> = with(|d| {
        let mut path = vec![target];
        if let Target::Node(n) = target {
            let mut last = n;
            let mut at = d.parent(n);
            while let Some(p) = at {
                path.push(Target::Node(p));
                last = p;
                at = d.parent(p);
            }
            if last == d.root() {
                path.push(Target::Window);
            }
        }
        path
    });
    let kind = with(|d| -> Result<String, String> {
        let e = d.event(ev)?;
        e.target = Some(target);
        e.dispatching = true;
        e.stop = false;
        e.stop_immediate = false;
        Ok(e.kind.clone())
    })?;
    let bubbles = with(|d| d.event(ev).map(|e| e.bubbles))?;
    // (node, phase, capturing listeners?) in dispatch order.
    let mut order: Vec<(Target, u8, bool)> = Vec::new();
    for t in path.iter().rev() {
        order.push((*t, if *t == target { 2 } else { 1 }, true));
    }
    for t in path.iter() {
        if *t == target {
            order.push((*t, 2, false));
        } else if bubbles {
            order.push((*t, 3, false));
        }
    }
    for (at, phase, capture) in order {
        let stopped = with(|d| {
            let e = d.event(ev).ok()?;
            if e.stop {
                return None;
            }
            e.phase = phase;
            e.current = Some(at);
            Some(())
        });
        if stopped.is_none() {
            break;
        }
        // The listeners registered at this node for this phase now; one removed meanwhile does not run.
        let ids: Vec<u64> = with(|d| d.listeners.iter().filter(|l| l.target == at && l.kind == kind && l.capture == capture).map(|l| l.id).collect());
        for id in ids {
            let closure = with(|d| {
                let i = d.listeners.iter().position(|l| l.id == id)?;
                let c = d.listeners[i].closure;
                if d.listeners[i].once {
                    d.listeners.remove(i);
                } else {
                    abi::closure_retain(c);
                }
                Some(c)
            });
            let Some(c) = closure else { continue };
            let called = abi::call_closure(c, &[Value::Object(ev_ref)]);
            abi::closure_release(c);
            if called.is_err() {
                report_exception(&format!("a '{kind}' listener"));
            }
            if with(|d| d.event(ev).map(|e| e.stop_immediate).unwrap_or(true)) {
                break;
            }
        }
    }
    let canceled = with(|d| {
        let e = d.event(ev).ok()?;
        e.phase = 0;
        e.current = None;
        e.dispatching = false;
        e.stop = false;
        e.stop_immediate = false;
        Some(e.canceled)
    });
    Ok(!canceled.unwrap_or(false))
}

/// A plain event of `kind` at the window (a host event such as `resize`: not bubbling, not cancelable, trusted).
pub fn fire_window_event(kind: &str) {
    let ev = with(|d| d.new_event(kind, false, false, true));
    let _ = fire(Target::Window, ev);
}

/// A callback threw and the host goes on (a listener, a frame callback): the program's pending exception is taken
/// (ABI 2's scr_host_take_exception) and reported as a browser reports an uncaught one, `Uncaught <value>` on stderr.
pub fn report_exception(context: &str) {
    match abi::take_exception() {
        Some(v) => {
            // An error prints its stack (the program's frames, when it recorded them), as a browser's console does.
            let stack = match &v {
                Value::Object(r) => crate::values::get(*r, "stack").ok().flatten().and_then(|s| match s { Value::Str(s) => Some(s), _ => None }),
                _ => None,
            };
            let text = stack.unwrap_or_else(|| crate::values::inspect(&v, 0).unwrap_or_else(|| objects::to_display(&v)));
            eprintln!("Uncaught {text} (in {context})");
            match v {
                Value::Object(r) => objects::release(r),
                Value::Closure(c) | Value::Program(c) => abi::closure_release(c),
                _ => {}
            }
        }
        None => eprintln!("Uncaught exception in {context}"),
    }
}

// ---- the window as an event target ------------------------------------------------------------------------------

pub fn window_has_method(name: &str) -> bool {
    matches!(name, "addEventListener" | "removeEventListener" | "dispatchEvent" | "close" | "getSelection")
}

pub fn window_call(name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "getSelection" => Ok(selection::get_selection()),
        "addEventListener" | "removeEventListener" => listener(Target::Window, name == "addEventListener", args),
        "dispatchEvent" => dispatch_event_arg(Target::Window, args),
        // The window's page ends (window.rs closes the window at the loop's next turn).
        "close" => {
            crate::window::request_close();
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

// ---- the objects that are not nodes ------------------------------------------------------------------------------

/// The nodes of a list object, now (a live list reads the tree).
fn list_items(a: &Aux) -> Option<Vec<NodeId>> {
    match a {
        Aux::ChildNodes(n) => Some(with(|d| d.children(*n))),
        Aux::List(items) => Some(items.to_vec()),
        Aux::Collection(n, sel) => Some(with(|d| d.select(*n, sel)).unwrap_or_default()),
        _ => None,
    }
}

pub fn aux_get(a: &Aux, name: &str) -> Result<Option<Value>, String> {
    if let Some(items) = list_items(a) {
        if name == "length" {
            return Ok(Some(Value::Number(items.len() as f64)));
        }
        return Ok(name.parse::<usize>().ok().map(|i| items.get(i).map_or(Value::Undefined, |c| Value::Object(objects::node_ref(*c)))));
    }
    match a {
        Aux::Range(slot) => selection::range_get(*slot, name),
        Aux::Selection => selection::selection_get(name),
        Aux::DataTransfer(slot) => Ok(clipboard::transfer_get(*slot, name)),
        Aux::Dataset(n) => Ok(Some(with(|d| d.read_attr(*n, &data_attribute(name))).map_or(Value::Undefined, Value::Str))),
        Aux::ClassList(n) => {
            let tokens = with(|d| d.class_tokens(*n));
            Ok(match name {
                "length" => Some(Value::Number(tokens.len() as f64)),
                "value" => Some(Value::Str(with(|d| d.read_attr(*n, "class")).unwrap_or_default())),
                _ => name.parse::<usize>().ok().map(|i| tokens.get(i).map_or(Value::Undefined, |t| Value::Str(t.clone()))),
            })
        }
        Aux::Style(n) => Ok(Some(Value::Str(match name {
            "cssText" => with(|d| d.read_attr(*n, "style")).unwrap_or_default(),
            _ => with(|d| d.doc.get_style_property(*n, &css_property(name))),
        }))),
        Aux::Event(i) => {
            let i = *i;
            enum Got {
                V(Value),
                T(Option<Target>),
            }
            let got = with(|d| -> Result<Option<Got>, String> {
                let e = d.event(i)?;
                Ok(Some(match name {
                    "type" => Got::V(Value::Str(e.kind.clone())),
                    "target" | "srcElement" => Got::T(e.target),
                    "currentTarget" => Got::T(e.current),
                    "eventPhase" => Got::V(Value::Number(e.phase as f64)),
                    "bubbles" => Got::V(Value::Bool(e.bubbles)),
                    "cancelable" => Got::V(Value::Bool(e.cancelable)),
                    "defaultPrevented" => Got::V(Value::Bool(e.canceled)),
                    "returnValue" => Got::V(Value::Bool(!e.canceled)),
                    "cancelBubble" => Got::V(Value::Bool(e.stop)),
                    "isTrusted" => Got::V(Value::Bool(e.trusted)),
                    "composed" => Got::V(Value::Bool(false)),
                    "timeStamp" => Got::V(Value::Number(e.time)),
                    "relatedTarget" if e.input.is_some() => Got::T(e.input.as_deref().and_then(|i| i.related).map(Target::Node)),
                    _ => match e.input.as_deref() {
                        Some(i) => Got::V(match name {
                            "clientX" | "pageX" | "screenX" | "x" | "offsetX" => Value::Number(i.client.0),
                            "clientY" | "pageY" | "screenY" | "y" | "offsetY" => Value::Number(i.client.1),
                            "button" => Value::Number(i.button as f64),
                            "buttons" => Value::Number(i.buttons as f64),
                            "shiftKey" => Value::Bool(i.mods.shift),
                            "ctrlKey" => Value::Bool(i.mods.ctrl),
                            "altKey" => Value::Bool(i.mods.alt),
                            "metaKey" => Value::Bool(i.mods.meta),
                            // An editing InputEvent's (selection.rs).
                            // A ClipboardEvent's (clipboard.rs).
                            "clipboardData" if i.transfer.is_some() => return Ok(Some(Got::V(i.transfer.map_or(Value::Null, clipboard::transfer_value)))),
                            "inputType" if !i.input_type.is_empty() => Value::Str(i.input_type.clone()),
                            "data" if !i.input_type.is_empty() => i.data.clone().map_or(Value::Null, Value::Str),
                            "isComposing" if !i.input_type.is_empty() => Value::Bool(false),
                            "key" => Value::Str(i.key.clone()),
                            "code" => Value::Str(i.code.clone()),
                            "repeat" if i.keyboard => Value::Bool(i.repeat),
                            // No IME composition natively: every key is a plain key.
                            "isComposing" if i.keyboard => Value::Bool(false),
                            "location" if i.keyboard => Value::Number(key_location(&i.code)),
                            "keyCode" | "which" if i.keyboard => Value::Number(key_code(&i.key, &i.code)),
                            "charCode" if i.keyboard => Value::Number(0.0),
                            "which" => Value::Number(f64::from(i.button) + 1.0),
                            "deltaX" => Value::Number(i.delta.0),
                            "deltaY" => Value::Number(i.delta.1),
                            "deltaZ" => Value::Number(0.0),
                            "movementX" => Value::Number(i.movement.0),
                            "movementY" => Value::Number(i.movement.1),
                            "deltaMode" => Value::Number(0.0),
                            "detail" => Value::Number(i.detail),
                            // The mouse is pointer 1, each finger its own (2 + its id), as a browser numbers them.
                            "pointerId" if i.pointer => Value::Number(i.touch.map_or(1.0, |t| 2.0 + f64::from(t))),
                            "pointerType" if i.pointer => Value::Str(if i.touch.is_some() { "touch" } else { "mouse" }.into()),
                            "isPrimary" if i.pointer => Value::Bool(i.primary),
                            _ => return Ok(None),
                        }),
                        None => return Ok(None),
                    },
                }))
            })?;
            Ok(got.map(|g| match g {
                Got::V(v) => v,
                Got::T(t) => t.map_or(Value::Null, target_value),
            }))
        }
        _ => Ok(None),
    }
}

pub fn aux_has_method(a: &Aux, name: &str) -> bool {
    match a {
        Aux::ChildNodes(_) | Aux::List(_) | Aux::Collection(..) => matches!(name, "item" | "forEach" | "toString"),
        Aux::ClassList(_) => matches!(name, "add" | "remove" | "toggle" | "contains" | "replace" | "item" | "toString" | "forEach"),
        Aux::Style(_) => matches!(name, "setProperty" | "removeProperty" | "getPropertyValue" | "getPropertyPriority" | "toString"),
        // getModifierState: a keyboard or mouse event's (any event answers it; one without input holds no modifier).
        Aux::Event(_) => matches!(name, "stopPropagation" | "stopImmediatePropagation" | "preventDefault" | "initEvent" | "toString" | "getModifierState"),
        // A DOMStringMap's members are its keys only.
        Aux::Dataset(_) => false,
        Aux::Range(_) => selection::RANGE_METHODS.contains(&name),
        Aux::Selection => selection::SELECTION_METHODS.contains(&name),
        Aux::DataTransfer(_) => clipboard::TRANSFER_METHODS.contains(&name),
    }
}

pub fn aux_set(a: &Aux, name: &str, value: Value) -> Result<(), String> {
    match a {
        Aux::Style(n) => {
            let v = css_value(&value);
            with(|d| {
                if name == "cssText" {
                    d.set_attr(*n, "style", &v);
                } else {
                    let p = css_property(name);
                    let mut m = d.mutate();
                    if v.is_empty() { m.remove_style_property(*n, &p) } else { m.set_style_property(*n, &p, &v) }
                }
            });
            Ok(())
        }
        Aux::Dataset(n) => {
            let v = objects::to_display(&value);
            with(|d| d.set_attr(*n, &data_attribute(name), &v));
            Ok(())
        }
        Aux::ClassList(n) if name == "value" => {
            let v = objects::to_display(&value);
            with(|d| d.set_attr(*n, "class", &v));
            Ok(())
        }
        Aux::Event(i) => {
            let on = truthy(&value);
            with(|d| -> Result<(), String> {
                let e = d.event(*i)?;
                match name {
                    "cancelBubble" if on => e.stop = true,
                    "returnValue" if !on && e.cancelable => e.canceled = true,
                    _ => {}
                }
                Ok(())
            })
        }
        // Read-only (a list's length, an index): the write is ignored.
        _ => Ok(()),
    }
}

fn token_arg(v: Option<&Value>) -> Result<String, String> {
    let t = str_of(v);
    if t.is_empty() {
        return Err(dom_error("SyntaxError", "the token is empty"));
    }
    if t.chars().any(|c| c.is_ascii_whitespace()) {
        return Err(dom_error("InvalidCharacterError", "the token contains whitespace"));
    }
    Ok(t)
}

pub fn aux_call(obj: u64, a: &Aux, name: &str, args: &[Value]) -> Result<Value, String> {
    match a {
        Aux::Range(slot) => return selection::range_call(*slot, name, args),
        Aux::Selection => return selection::selection_call(name, args),
        Aux::DataTransfer(slot) if name != "toString" => return clipboard::transfer_call(*slot, name, args),
        _ => {}
    }
    if name == "toString" && !matches!(a, Aux::ClassList(_)) {
        return Ok(Value::Str(aux_display(a)));
    }
    if let Some(items) = list_items(a) {
        return match name {
            "item" => {
                let i = match args.first() {
                    Some(Value::Number(x)) if *x >= 0.0 => *x as usize,
                    _ => 0,
                };
                Ok(node_value(items.get(i).copied()))
            }
            "forEach" => {
                let Some(Value::Closure(c)) = args.first() else { return Err("forEach: the callback is not a function".into()) };
                for (i, n) in items.iter().enumerate() {
                    abi::call_closure(*c, &[Value::Object(objects::node_ref(*n)), Value::Number(i as f64), Value::Object(obj)]).map_err(|()| "forEach: the callback threw".to_string())?;
                }
                Ok(Value::Undefined)
            }
            _ => Err(format!("{name} is not a function")),
        };
    }
    match a {
        Aux::ClassList(n) => {
            let n = *n;
            match name {
                "add" | "remove" => {
                    let tokens = args.iter().map(|v| token_arg(Some(v))).collect::<Result<Vec<_>, _>>()?;
                    with(|d| {
                        let mut list = d.class_tokens(n);
                        for t in tokens {
                            if name == "add" {
                                if !list.contains(&t) {
                                    list.push(t);
                                }
                            } else {
                                list.retain(|x| *x != t);
                            }
                        }
                        // As the DOM's update steps: no attribute is made for an empty remove on an element without one.
                        if !(list.is_empty() && d.read_attr(n, "class").is_none()) {
                            d.set_class_tokens(n, &list);
                        }
                    });
                    Ok(Value::Undefined)
                }
                "toggle" => {
                    let t = token_arg(args.first())?;
                    let force = match args.get(1) {
                        None | Some(Value::Undefined) => None,
                        Some(v) => Some(truthy(v)),
                    };
                    Ok(Value::Bool(with(|d| {
                        let mut list = d.class_tokens(n);
                        let present = list.contains(&t);
                        let on = force.unwrap_or(!present);
                        if on && !present {
                            list.push(t);
                            d.set_class_tokens(n, &list);
                        } else if !on && present {
                            list.retain(|x| *x != t);
                            d.set_class_tokens(n, &list);
                        }
                        on
                    })))
                }
                "contains" => {
                    let t = str_of(args.first());
                    Ok(Value::Bool(with(|d| d.class_tokens(n).contains(&t))))
                }
                "replace" => {
                    let (old, new) = (token_arg(args.first())?, token_arg(args.get(1))?);
                    Ok(Value::Bool(with(|d| {
                        let mut list = d.class_tokens(n);
                        let Some(i) = list.iter().position(|x| *x == old) else { return false };
                        if list.contains(&new) {
                            list.remove(i);
                        } else {
                            list[i] = new;
                        }
                        d.set_class_tokens(n, &list);
                        true
                    })))
                }
                "item" => {
                    let i = match args.first() {
                        Some(Value::Number(x)) if *x >= 0.0 => *x as usize,
                        _ => 0,
                    };
                    Ok(with(|d| d.class_tokens(n)).get(i).map_or(Value::Null, |t| Value::Str(t.clone())))
                }
                "toString" => Ok(Value::Str(with(|d| d.read_attr(n, "class")).unwrap_or_default())),
                "forEach" => {
                    let Some(Value::Closure(c)) = args.first() else { return Err("forEach: the callback is not a function".into()) };
                    for (i, t) in with(|d| d.class_tokens(n)).into_iter().enumerate() {
                        abi::call_closure(*c, &[Value::Str(t), Value::Number(i as f64), Value::Object(obj)]).map_err(|()| "forEach: the callback threw".to_string())?;
                    }
                    Ok(Value::Undefined)
                }
                _ => Err(format!("{name} is not a function")),
            }
        }
        Aux::Style(n) => {
            let n = *n;
            let p = str_of(args.first());
            match name {
                "setProperty" => {
                    let v = args.get(1).map(css_value).unwrap_or_default();
                    with(|d| {
                        let mut m = d.mutate();
                        if v.is_empty() { m.remove_style_property(n, &p) } else { m.set_style_property(n, &p, &v) }
                    });
                    Ok(Value::Undefined)
                }
                "removeProperty" => Ok(Value::Str(with(|d| {
                    let old = d.doc.get_style_property(n, &p);
                    d.mutate().remove_style_property(n, &p);
                    old
                }))),
                "getPropertyValue" => Ok(Value::Str(with(|d| d.doc.get_style_property(n, &p)))),
                "getPropertyPriority" => Ok(Value::Str(String::new())),
                _ => Err(format!("{name} is not a function")),
            }
        }
        Aux::Event(i) if name == "getModifierState" => {
            let key = str_of(args.first());
            let mods = with(|d| d.event(*i).ok().and_then(|e| e.input.as_ref().map(|f| f.mods))).unwrap_or_default();
            Ok(Value::Bool(match key.as_str() {
                "Shift" => mods.shift,
                "Control" => mods.ctrl,
                "Alt" => mods.alt,
                "Meta" => mods.meta,
                // Windows types AltGr as Control and Alt together.
                "AltGraph" => cfg!(windows) && mods.ctrl && mods.alt,
                "CapsLock" | "NumLock" | "ScrollLock" => lock_key_on(&key),
                _ => false,
            }))
        }
        Aux::Event(i) => {
            let i = *i;
            let (kind, bubbles, cancelable) = (str_of(args.first()), args.get(1).is_some_and(truthy), args.get(2).is_some_and(truthy));
            with(|d| -> Result<(), String> {
                let e = d.event(i)?;
                match name {
                    "stopPropagation" => e.stop = true,
                    "stopImmediatePropagation" => {
                        e.stop = true;
                        e.stop_immediate = true;
                    }
                    "preventDefault" => {
                        if e.cancelable {
                            e.canceled = true;
                        }
                    }
                    // Legacy initialization (document.createEvent): ignored while dispatching.
                    "initEvent" if !e.dispatching => {
                        e.kind = kind;
                        e.bubbles = bubbles;
                        e.cancelable = cancelable;
                        e.canceled = false;
                        e.stop = false;
                        e.stop_immediate = false;
                    }
                    "initEvent" => {}
                    _ => return Err(format!("{name} is not a function")),
                }
                Ok(())
            })?;
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

pub fn aux_display(a: &Aux) -> String {
    match a {
        Aux::Style(_) => "[object CSSStyleDeclaration]".into(),
        Aux::Dataset(_) => "[object DOMStringMap]".into(),
        Aux::ClassList(n) => with(|d| d.read_attr(*n, "class")).unwrap_or_default(),
        Aux::ChildNodes(_) | Aux::List(_) => "[object NodeList]".into(),
        Aux::Collection(..) => "[object HTMLCollection]".into(),
        Aux::Range(_) => "[object Range]".into(),
        Aux::Selection => "[object Selection]".into(),
        Aux::DataTransfer(_) => "[object DataTransfer]".into(),
        Aux::Event(i) => {
            let i = *i;
            let kind = with_quiet(|d| d.event(i).map(|e| (e.kind.clone(), e.input.as_ref().map(|f| (f.pointer, !f.key.is_empty() || !f.code.is_empty())))).ok());
            match kind {
                Some((k, Some((true, _)))) if k.starts_with("pointer") => "[object PointerEvent]".into(),
                Some((k, Some(_))) if k == "wheel" => "[object WheelEvent]".into(),
                Some((k, Some(_))) if k == "input" || k == "beforeinput" => "[object InputEvent]".into(),
                Some((k, Some(_))) if matches!(k.as_str(), "copy" | "cut" | "paste") => "[object ClipboardEvent]".into(),
                Some((_, Some((_, true)))) => "[object KeyboardEvent]".into(),
                Some((_, Some(_))) => "[object MouseEvent]".into(),
                _ => "[object Event]".into(),
            }
        }
    }
}

/// The object table freed `a`'s object.
pub fn aux_freed(a: &Aux) {
    if let Aux::Range(slot) = a {
        selection::aux_freed(*slot);
    }
    if let Aux::DataTransfer(slot) = a {
        clipboard::unref(*slot);
    }
    if let Aux::Event(i) = a {
        // A ClipboardEvent's count on its DataTransfer goes with it.
        let transfer = with(|d| {
            let mut transfer = None;
            if let Some(slot) = d.events.get_mut(*i) {
                if let Some(e) = slot.take() {
                    transfer = e.input.and_then(|f| f.transfer);
                    d.free_events.push(*i);
                }
            }
            transfer
        });
        if let Some(t) = transfer {
            clipboard::unref(t);
        }
    }
}

// ---- input from a window -------------------------------------------------------------------------------------------

thread_local! {
    /// The element the pressed button went down on (a click is a down and an up on the same element).
    static PRESSED: std::cell::Cell<Option<(i16, NodeId)>> = const { std::cell::Cell::new(None) };
    /// The last press: its button, when and where it went down, and how many presses it counts (a double click's 2,
    /// the events' `detail`).
    static PRESSES: std::cell::Cell<Option<(i16, std::time::Instant, (f64, f64), u32)>> = const { std::cell::Cell::new(None) };
    /// Each pointer's last position (viewport CSS px), for `movementX` and `movementY`.
    static LAST_AT: RefCell<HashMap<i32, (f64, f64)>> = RefCell::new(HashMap::new());
    /// The element under the mouse: where the next `mouseout` and `mouseleave` go.
    static UNDER: std::cell::Cell<Option<NodeId>> = const { std::cell::Cell::new(None) };
    /// The element holding the pointer lock, and where the mouse stood when it was taken (a locked mouse's events
    /// carry that position, as a browser's do).
    static LOCK: std::cell::Cell<Option<(NodeId, (f64, f64))>> = const { std::cell::Cell::new(None) };
    /// The lock's changes for the document (`pointerlockchange`, `pointerlockerror`), fired at the window's next turn
    /// (a browser fires them in a task after the request).
    static LOCK_EVENTS: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
    /// Whether the window has the system's focus (document.hasFocus()), as the window last said.
    static WINDOW_FOCUSED: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
    /// An Escape press that ended the pointer lock: its release is kept from the page too.
    static ESCAPE_KEPT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Presses this close in time and place count as one multiple click (Windows' default double-click time and box).
const MULTI_CLICK_MS: u128 = 500;
const MULTI_CLICK_PX: f64 = 4.0;

/// The element at viewport CSS px (x, y): Blitz's hit test on the laid-out document (the body when nothing is there).
fn hit_target(d: &mut Dom, x: f64, y: f64) -> NodeId {
    resolve_doc(&mut d.doc, "hit test");
    let mut id = d.doc.hit(x as f32, y as f32).map(|h| h.node_id).filter(|n| d.doc.get_node(*n).is_some());
    // A text node is its parent element's.
    while let Some(n) = id.filter(|n| !d.is_element(*n)) {
        id = d.parent(n);
    }
    id.or_else(|| d.body()).unwrap_or_else(|| d.root())
}

/// Whether the element takes the focus (a press's, focus()'s): a `tabindex`, a control that is not disabled (nor a
/// hidden input), a link with an `href`, an editing host (contenteditable). Disabled controls take none, as a
/// browser's do.
fn focusable(d: &Dom, id: NodeId) -> bool {
    if !d.is_element(id) {
        return false;
    }
    let tag = d.tag(id);
    let control = matches!(tag.as_deref(), Some("button" | "input" | "select" | "textarea"));
    if control && (d.read_attr(id, "disabled").is_some() || in_disabled_fieldset(d, id)) {
        return false;
    }
    if tag.as_deref() == Some("input") && d.read_attr(id, "type").is_some_and(|t| t.eq_ignore_ascii_case("hidden")) {
        return false;
    }
    d.read_attr(id, "tabindex").is_some_and(|t| t.trim().parse::<i32>().is_ok())
        || control
        || matches!(tag.as_deref(), Some("summary" | "iframe"))
        || (tag.as_deref() == Some("a") && d.read_attr(id, "href").is_some())
        // An editing host (contenteditable) takes the focus too.
        || selection::is_editing_host(d, id)
}

/// A control inside a disabled `<fieldset>` (not in its first `<legend>`) is disabled too.
fn in_disabled_fieldset(d: &Dom, id: NodeId) -> bool {
    let mut child = id;
    let mut at = d.parent(id);
    while let Some(p) = at {
        if d.tag(p).as_deref() == Some("fieldset") && d.read_attr(p, "disabled").is_some() {
            let first_legend = d.element_children(p).into_iter().find(|c| d.tag(*c).as_deref() == Some("legend"));
            if first_legend != Some(child) {
                return true;
            }
        }
        child = p;
        at = d.parent(p);
    }
    false
}

/// A disabled form control: its clicks are not dispatched (HTML's rule for disabled controls).
fn disabled_control(d: &Dom, id: NodeId) -> bool {
    matches!(d.tag(id).as_deref(), Some("button" | "input" | "select" | "textarea")) && (d.read_attr(id, "disabled").is_some() || in_disabled_fieldset(d, id))
}

/// Whether `id` or an ancestor of it is a disabled form control.
fn in_disabled_control(d: &Dom, id: NodeId) -> bool {
    let mut at = Some(id);
    while let Some(n) = at {
        if d.is_element(n) && disabled_control(d, n) {
            return true;
        }
        at = d.parent(n);
    }
    false
}

/// Whether the element is being rendered and can be seen (sequential focus navigation skips the rest): neither it nor
/// an ancestor `display: none`, nor itself `visibility: hidden`.
fn rendered(d: &Dom, id: NodeId) -> bool {
    if matches!(d.doc.resolved_style_value(id, "visibility").as_str(), "hidden" | "collapse") {
        return false;
    }
    let mut at = Some(id);
    while let Some(n) = at {
        if d.is_element(n) && d.doc.resolved_style_value(n, "display") == "none" {
            return false;
        }
        at = d.parent(n);
    }
    true
}

/// The element's tab index as sequential focus navigation reads it: its `tabindex`, else 0 for what is focusable.
fn tab_index(d: &Dom, id: NodeId) -> i32 {
    d.read_attr(id, "tabindex").and_then(|t| t.trim().parse::<i32>().ok()).unwrap_or(0)
}

/// The sequential focus navigation order: the focusable, rendered elements with a non-negative tab index, those with
/// a positive one first (ascending, then in tree order), then the rest in tree order.
fn tab_order(d: &Dom) -> Vec<NodeId> {
    let all: Vec<NodeId> = d.descendants(d.root()).into_iter().filter(|n| focusable(d, *n) && tab_index(d, *n) >= 0 && rendered(d, *n)).collect();
    let mut positive: Vec<(i32, usize, NodeId)> = all.iter().enumerate().filter(|(_, n)| tab_index(d, **n) > 0).map(|(i, n)| (tab_index(d, *n), i, *n)).collect();
    positive.sort_by_key(|(t, i, _)| (*t, *i));
    positive.into_iter().map(|(.., n)| n).chain(all.iter().copied().filter(|n| tab_index(d, *n) == 0)).collect()
}

/// Tab (Shift+Tab: backwards) not canceled: the focus moves to the next element in the sequential focus navigation
/// order from the focused element (else from where the last press was), wrapping at its ends (natively there is no
/// browser chrome to move into). The keyboard focused it: `:focus-visible`, a field's text selected.
fn tab_navigation(back: bool) -> Result<(), String> {
    let (old, next) = with(|d| {
        resolve_doc(&mut d.doc, "tab navigation");
        let order = tab_order(d);
        let old = focused_element(d);
        let from = old.or_else(|| NAV_START.with(|s| s.get()).filter(|n| d.connected(*n)));
        if order.is_empty() {
            return (old, None);
        }
        let next = match from.and_then(|f| order.iter().position(|n| *n == f)) {
            Some(i) if back => order[(i + order.len() - 1) % order.len()],
            Some(i) => order[(i + 1) % order.len()],
            None => {
                // From an element outside the order: the first after it (the last before it) in tree order.
                let tree = d.descendants(d.root());
                let pos = |n: NodeId| tree.iter().position(|m| *m == n).unwrap_or(0);
                match from {
                    Some(f) if back => order.iter().rev().copied().find(|n| pos(*n) < pos(f)).unwrap_or(order[order.len() - 1]),
                    Some(f) => order.iter().copied().find(|n| pos(*n) > pos(f)).unwrap_or(order[0]),
                    None if back => order[order.len() - 1],
                    None => order[0],
                }
            }
        };
        (old, Some(next))
    });
    if trace_input() {
        eprintln!("input: Tab from {} to {}", old.map_or("nothing".into(), node_label), next.map_or("nothing".into(), node_label));
    }
    let Some(next) = next else { return Ok(()) };
    if old != Some(next) {
        change_focus(old, Some(next))?;
    }
    set_focus_visible(true);
    selection::focus_caret(next);
    text_field::focused_by_keyboard(next);
    Ok(())
}

thread_local! {
    /// Where sequential focus navigation starts when nothing has the focus: the element last pressed.
    static NAV_START: std::cell::Cell<Option<NodeId>> = const { std::cell::Cell::new(None) };
    /// The last input was the keyboard's (a focus() then shows `:focus-visible`, as a browser's heuristic does).
    static KEYBOARD_MODALITY: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// When the caret last moved or the user last typed: the caret's blink restarts there, solid.
    static CARET_ACTIVITY: std::cell::Cell<Option<std::time::Instant>> = const { std::cell::Cell::new(None) };
}

/// `:focus-visible` for the focused element.
fn set_focus_visible(on: bool) {
    if with_quiet(|d| d.doc.set_focus_visible(on)) {
        repaint();
    }
}

/// The focus-visible heuristic for a focus that was not the keyboard's own move: shown for a text field or an editing
/// host (they take keyboard input), else when the last input was the keyboard.
fn focus_visible_for(n: NodeId) -> bool {
    KEYBOARD_MODALITY.with(|k| k.get()) || with_quiet(|d| text_field::is_field(d, n) || selection::is_editing_host(d, n))
}

/// The caret moved or the user typed: the caret shows solid and its blink restarts.
fn caret_activity() {
    CARET_ACTIVITY.with(|c| c.set(Some(std::time::Instant::now())));
    if with_quiet(|d| d.doc.set_caret_blink_off(false)) {
        repaint();
    }
}

/// The caret's blink: on for the system's blink time, off for as long (Windows' GetCaretBlinkTime, 530 ms by
/// default), from the last activity. Answers whether the phase changed (a repaint).
fn caret_blink_tick() -> bool {
    let ms = caret_blink_ms();
    let off = match (ms, CARET_ACTIVITY.with(|c| c.get())) {
        (Some(ms), Some(at)) if ms > 0 => (at.elapsed().as_millis() / u128::from(ms)) % 2 == 1,
        _ => false,
    };
    with_quiet(|d| {
        // Only while a caret is shown (the focused field's, or an editing host's).
        let shown = d.doc.editing_caret().is_some() || d.doc.get_focussed_node_id().is_some_and(|f| text_field::is_field(d, f));
        d.doc.set_caret_blink_off(off && shown)
    })
}

#[cfg(all(windows, feature = "window"))]
fn caret_blink_ms() -> Option<u32> {
    crate::window::caret_blink_ms()
}

#[cfg(not(all(windows, feature = "window")))]
fn caret_blink_ms() -> Option<u32> {
    Some(500)
}

/// Fires a trusted input event of `kind` at `target` (bubbling; cancelable unless said otherwise).
fn fire_input(target: NodeId, kind: &str, fields: InputFields, cancelable: bool) -> Result<bool, String> {
    fire_input_with(target, kind, fields, true, cancelable)
}

fn fire_input_with(target: NodeId, kind: &str, fields: InputFields, bubbles: bool, cancelable: bool) -> Result<bool, String> {
    let ev = with(|d| {
        let ev = d.new_event(kind, bubbles, cancelable, true);
        if let Ok(e) = d.event(ev) {
            e.input = Some(Box::new(fields));
        }
        ev
    });
    fire(Target::Node(target), ev)
}

/// A plain trusted event at a node (focus and blur, the document's pointer lock changes).
fn fire_plain(target: NodeId, kind: &str, bubbles: bool) -> Result<bool, String> {
    let ev = with(|d| d.new_event(kind, bubbles, false, true));
    fire(Target::Node(target), ev)
}

/// Ends a pointer's capture when its up has been dispatched (whatever the listeners did); a finger is no longer
/// active then (the mouse stays).
struct ReleaseOnUp(Option<i32>);

impl Drop for ReleaseOnUp {
    fn drop(&mut self) {
        if let Some(id) = self.0 {
            CAPTURES.with(|c| c.borrow_mut().remove(&id));
            if id != 1 {
                ACTIVE_POINTERS.with(|a| a.borrow_mut().remove(&id));
                LAST_AT.with(|l| l.borrow_mut().remove(&id));
            }
        }
    }
}

// ---- the pointer lock ----------------------------------------------------------------------------------------------

/// The window's side of the lock: the mouse hidden and held in place, its motion relative (Input::Motion). False
/// when the window cannot take it (not focused, or a platform without one yet).
#[cfg(all(windows, feature = "window"))]
fn platform_lock(on: bool) -> bool {
    crate::window::set_pointer_lock(on)
}

#[cfg(not(all(windows, feature = "window")))]
fn platform_lock(_on: bool) -> bool {
    false
}

/// A lock key's toggle (CapsLock, NumLock, ScrollLock) for getModifierState.
#[cfg(all(windows, feature = "window"))]
fn lock_key_on(key: &str) -> bool {
    crate::window::lock_key_on(key)
}

#[cfg(not(all(windows, feature = "window")))]
fn lock_key_on(_key: &str) -> bool {
    false
}

/// SCRIPTC_HOST_TRACE_INPUT=1: each input event's dispatch and the pointer lock's changes on stderr.
fn trace_input() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE_INPUT").is_some())
}

/// An element as the input trace names it: its tag, id and classes.
fn node_label(n: NodeId) -> String {
    with_quiet(|d| format!("<{} id={:?} class={:?}>", d.tag(n).unwrap_or_default(), d.read_attr(n, "id").unwrap_or_default(), d.read_attr(n, "class").unwrap_or_default()))
}

fn announce_lock(kind: &'static str) {
    if trace_input() {
        eprintln!("input: {kind} (locked: {})", LOCK.with(|l| l.get()).is_some());
    }
    LOCK_EVENTS.with(|l| l.borrow_mut().push(kind));
}

/// The lock's element while it is still in the document; a lock whose element left the document ends here.
fn held_lock() -> Option<(NodeId, (f64, f64))> {
    let held = LOCK.with(|l| l.get())?;
    if with_quiet(|d| d.connected(held.0)) {
        return Some(held);
    }
    exit_pointer_lock();
    None
}

/// `document.pointerLockElement`.
fn pointer_lock_element(d: &Dom) -> Option<NodeId> {
    LOCK.with(|l| l.get()).map(|(n, _)| n).filter(|n| d.connected(*n))
}

/// `element.requestPointerLock()`: the window takes the mouse for the element; a promise settled as the request is.
/// The document hears `pointerlockchange` (or `pointerlockerror`) at the window's next turn.
fn request_pointer_lock(n: NodeId) -> Value {
    let promise = crate::values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    let refuse = |name: &str, message: &str| {
        announce_lock("pointerlockerror");
        crate::values::settle(r, true, &crate::values::new_error(name, message));
    };
    if !with_quiet(|d| d.connected(n)) {
        refuse("WrongDocumentError", "The element is not in a document.");
        return promise;
    }
    match held_lock() {
        Some((held, _)) if held == n => {}
        // Another element's lock moves to this one without letting the mouse go.
        Some((_, at)) => {
            LOCK.with(|l| l.set(Some((n, at))));
            announce_lock("pointerlockchange");
        }
        None => {
            if !platform_lock(true) {
                refuse("NotAllowedError", "The window could not take the pointer.");
                return promise;
            }
            let at = LAST_AT.with(|l| l.borrow().get(&1).copied()).unwrap_or_default();
            LOCK.with(|l| l.set(Some((n, at))));
            announce_lock("pointerlockchange");
        }
    }
    crate::values::settle(r, false, &Value::Undefined);
    promise
}

/// `document.exitPointerLock()` (and every other end of the lock): the mouse back where it was, shown.
fn exit_pointer_lock() {
    if LOCK.with(|l| l.take()).is_some() {
        platform_lock(false);
        announce_lock("pointerlockchange");
    }
}

/// The lock's changes so far, fired at the document (the window's turn calls this before it dispatches input).
pub fn flush_pointer_lock_events() {
    let kinds: Vec<&'static str> = LOCK_EVENTS.with(|l| std::mem::take(&mut *l.borrow_mut()));
    for kind in kinds {
        let root = with_quiet(|d| d.root());
        if let Err(e) = fire_plain(root, kind, true) {
            eprintln!("scriptc-host: {kind}: {e}");
        }
    }
}

// ---- page visibility -----------------------------------------------------------------------------------------------

thread_local! {
    /// Whether the page is hidden (`document.visibilityState`): the window minimized, as a browser's minimized window
    /// hides its tab.
    static PAGE_HIDDEN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// `document.hidden`.
pub fn page_hidden() -> bool {
    PAGE_HIDDEN.with(|h| h.get())
}

/// The window was minimized (hidden) or shown again: on a change, the document hears `visibilitychange` (it bubbles
/// to the window, as a browser's does).
pub fn set_page_hidden(hidden: bool) {
    if PAGE_HIDDEN.with(|h| h.replace(hidden)) == hidden {
        return;
    }
    let root = with_quiet(|d| d.root());
    if let Err(e) = fire_plain(root, "visibilitychange", true) {
        eprintln!("scriptc-host: visibilitychange: {e}");
    }
}

// ---- fullscreen ----------------------------------------------------------------------------------------------------

thread_local! {
    /// The document's fullscreen element (one: the top of a browser's fullscreen stack).
    static FULLSCREEN: std::cell::Cell<Option<NodeId>> = const { std::cell::Cell::new(None) };
    /// Changes owed: the event (`fullscreenchange`, `fullscreenerror`), the element it is fired at, and the promise
    /// settled after it (retained until then; rejected for an error), fired at the window's next turn, after the
    /// resize the change brought (a browser's fullscreen steps run after its resize steps).
    static FULLSCREEN_EVENTS: RefCell<Vec<(&'static str, NodeId, Option<u64>)>> = const { RefCell::new(Vec::new()) };
    /// `navigator.keyboard.lock()`: None unlocked, else the codes held (empty: every key). Only Escape's matters
    /// natively: while full screen and locked, its press reaches the page and holding it leaves fullscreen.
    static KEYBOARD_LOCK: RefCell<Option<Vec<String>>> = const { RefCell::new(None) };
    /// When a locked Escape went down while full screen (held this long, fullscreen ends).
    static ESCAPE_HELD: std::cell::Cell<Option<std::time::Instant>> = const { std::cell::Cell::new(None) };
}

/// How long a locked Escape is held to leave fullscreen (Chromium's "press and hold Esc").
const ESCAPE_HOLD_MS: u128 = 1500;

#[cfg(all(windows, feature = "window"))]
fn platform_fullscreen(on: bool) -> bool {
    crate::window::set_fullscreen(on)
}

#[cfg(not(all(windows, feature = "window")))]
fn platform_fullscreen(_on: bool) -> bool {
    false
}

/// `document.fullscreenEnabled`: a window that can go full screen.
#[cfg(all(windows, feature = "window"))]
fn fullscreen_enabled() -> bool {
    crate::window::fullscreen_available()
}

#[cfg(not(all(windows, feature = "window")))]
fn fullscreen_enabled() -> bool {
    false
}

/// `document.fullscreenElement`, while it is in the document.
fn fullscreen_element(d: &Dom) -> Option<NodeId> {
    FULLSCREEN.with(|f| f.get()).filter(|n| d.connected(*n))
}

/// Whether the document is full screen (page.rs: `display-mode: fullscreen`).
pub fn fullscreen_active() -> bool {
    FULLSCREEN.with(|f| f.get()).is_some()
}

fn owe_fullscreen(kind: &'static str, n: NodeId, promise: Option<u64>) {
    if let Some(p) = promise {
        objects::retain(p);
    }
    FULLSCREEN_EVENTS.with(|e| e.borrow_mut().push((kind, n, promise)));
}

/// The window's own fullscreen key (Alt+Enter, F11): the document element full screen, or fullscreen ended, as the
/// page's own button would; the document hears `fullscreenchange` either way, so its controls agree. True when it
/// changed (false: no document element yet, or no window to make full screen).
pub fn toggle_fullscreen() -> bool {
    if FULLSCREEN.with(|f| f.get()).is_some() {
        exit_fullscreen(None);
        return true;
    }
    let Some(root) = with_quiet(|d| d.document_element()) else { return false };
    if !fullscreen_enabled() || !platform_fullscreen(true) {
        return false;
    }
    FULLSCREEN.with(|f| f.set(Some(root)));
    ESCAPE_HELD.with(|e| e.set(None));
    owe_fullscreen("fullscreenchange", root, None);
    true
}

/// `element.requestFullscreen()`: the window goes full screen for the element; the promise settles after the
/// document heard `fullscreenchange` (or `fullscreenerror`).
fn request_fullscreen(n: NodeId) -> Value {
    let promise = crate::values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    let ok = with_quiet(|d| d.connected(n) && d.is_element(n)) && fullscreen_enabled();
    if !ok {
        owe_fullscreen("fullscreenerror", n, Some(r));
        return promise;
    }
    let held = FULLSCREEN.with(|f| f.get());
    if held == Some(n) {
        // Already this element's: the promise resolves with no change.
        crate::values::settle(r, false, &Value::Undefined);
        return promise;
    }
    if held.is_none() && !platform_fullscreen(true) {
        owe_fullscreen("fullscreenerror", n, Some(r));
        return promise;
    }
    FULLSCREEN.with(|f| f.set(Some(n)));
    ESCAPE_HELD.with(|e| e.set(None));
    owe_fullscreen("fullscreenchange", n, Some(r));
    promise
}

/// `document.exitFullscreen()` (and fullscreen's every other end): the window back as it was. Asked of a document
/// that is not full screen, its promise rejects, as a browser's does.
fn exit_fullscreen(promise: Option<u64>) {
    let Some(n) = FULLSCREEN.with(|f| f.take()) else {
        if let Some(r) = promise {
            crate::values::settle(r, true, &crate::values::new_error("TypeError", "Document not active"));
        }
        return;
    };
    ESCAPE_HELD.with(|e| e.set(None));
    platform_fullscreen(false);
    owe_fullscreen("fullscreenchange", n, promise);
}

/// Fullscreen's changes so far, each fired at its element (the document, when the element left it) and its promise
/// settled; before them, a fullscreen element that left the document ends fullscreen, and so does a locked Escape
/// held long enough. The window's turn calls this each turn.
pub fn flush_fullscreen() {
    if ESCAPE_HELD.with(|e| e.get()).is_some_and(|since| since.elapsed().as_millis() >= ESCAPE_HOLD_MS) {
        exit_fullscreen(None);
    }
    if FULLSCREEN.with(|f| f.get()).is_some_and(|n| !with_quiet(|d| d.connected(n))) {
        exit_fullscreen(None);
    }
    let owed: Vec<(&'static str, NodeId, Option<u64>)> = FULLSCREEN_EVENTS.with(|e| std::mem::take(&mut *e.borrow_mut()));
    for (kind, n, promise) in owed {
        let target = with_quiet(|d| if d.connected(n) { n } else { d.root() });
        if trace_input() {
            eprintln!("input: {kind} at {} (full screen: {})", node_label(target), fullscreen_active());
        }
        if let Err(e) = fire_plain(target, kind, true) {
            eprintln!("scriptc-host: {kind}: {e}");
        }
        if let Some(r) = promise {
            if kind == "fullscreenerror" {
                crate::values::settle(r, true, &crate::values::new_error("TypeError", "Fullscreen request denied"));
            } else {
                crate::values::settle(r, false, &Value::Undefined);
            }
            objects::release(r);
        }
    }
}

/// `navigator.keyboard.lock(codes)` (None: `unlock()`; an empty list: every key).
pub fn keyboard_lock(codes: Option<Vec<String>>) {
    KEYBOARD_LOCK.with(|k| *k.borrow_mut() = codes);
    if !escape_locked() {
        ESCAPE_HELD.with(|e| e.set(None));
    }
}

/// Whether the keyboard lock holds Escape.
fn escape_locked() -> bool {
    KEYBOARD_LOCK.with(|k| k.borrow().as_ref().is_some_and(|codes| codes.is_empty() || codes.iter().any(|c| c == "Escape")))
}

/// The CSS cursor (its keyword) of what the mouse is over, for the window to show.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cursor_name() -> &'static str {
    with_quiet(|d| d.doc.get_cursor().map_or("default", |c| c.name()))
}

/// The images of the CSS cursor of what the mouse is over, in order (a `url()`, or an `image-set()`'s candidate for
/// the display), each with its hotspot when given (the image's CSS px) and its resolution (dppx): the window shows
/// the first it can make a cursor of, else [`cursor_name`]'s keyword.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cursor_images() -> Vec<(String, Option<(f32, f32)>, f32)> {
    with_quiet(|d| d.doc.get_cursor_images())
}

// ---- keys -------------------------------------------------------------------------------------------------------

/// KeyboardEvent.location from the key's code: 1 left, 2 right (of a doubled modifier), 3 the numpad, else 0.
fn key_location(code: &str) -> f64 {
    match code {
        "ShiftLeft" | "ControlLeft" | "AltLeft" | "MetaLeft" => 1.0,
        "ShiftRight" | "ControlRight" | "AltRight" | "MetaRight" => 2.0,
        _ if code.starts_with("Numpad") || code == "NumLock" => 3.0,
        _ => 0.0,
    }
}

/// The legacy `keyCode` (and `which`) of a keydown or keyup: the US layout's virtual key, as browsers answer it.
fn key_code(key: &str, code: &str) -> f64 {
    if let Some(c) = code.strip_prefix("Key").filter(|c| c.len() == 1) {
        return f64::from(c.as_bytes()[0]);
    }
    if let Some(d) = code.strip_prefix("Digit").and_then(|d| d.parse::<u8>().ok()) {
        return f64::from(b'0' + d);
    }
    if let Some(d) = code.strip_prefix("Numpad").and_then(|d| d.parse::<u8>().ok()) {
        return 96.0 + f64::from(d);
    }
    if let Some(n) = key.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()).filter(|n| (1..=24).contains(n)) {
        return 111.0 + f64::from(n);
    }
    let by_key = match key {
        "Backspace" => 8,
        "Tab" => 9,
        "Enter" => 13,
        "Shift" => 16,
        "Control" => 17,
        "Alt" => 18,
        "Pause" => 19,
        "CapsLock" => 20,
        "Escape" => 27,
        " " => 32,
        "PageUp" => 33,
        "PageDown" => 34,
        "End" => 35,
        "Home" => 36,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        "PrintScreen" => 44,
        "Insert" => 45,
        "Delete" => 46,
        "Meta" => 91,
        "ContextMenu" => 93,
        "NumLock" => 144,
        "ScrollLock" => 145,
        _ => 0,
    };
    if by_key != 0 {
        return f64::from(by_key);
    }
    f64::from(match code {
        "NumpadMultiply" => 106,
        "NumpadAdd" => 107,
        "NumpadSubtract" => 109,
        "NumpadDecimal" => 110,
        "NumpadDivide" => 111,
        "Semicolon" => 186,
        "Equal" => 187,
        "Comma" => 188,
        "Minus" => 189,
        "Period" => 190,
        "Slash" => 191,
        "Backquote" => 192,
        "BracketLeft" => 219,
        "Backslash" => 220,
        "BracketRight" => 221,
        "Quote" => 222,
        "IntlBackslash" => 226,
        _ => 0,
    })
}

// ---- dispatch ---------------------------------------------------------------------------------------------------

/// The element with the focus, if it is still in the document; a focused element that left the document gives the
/// focus up (the document's focus fixup: keys then go to the body).
fn focused_element(d: &mut Dom) -> Option<NodeId> {
    let f = d.doc.get_focussed_node_id()?;
    if d.is_element(f) && d.connected(f) {
        return Some(f);
    }
    d.doc.clear_focus();
    None
}

/// The mouse moved onto `new` (None: out of the window): `pointerout`/`mouseout` and `pointerleave`/`mouseleave` for
/// what it left, `pointerover`/`mouseover` and `pointerenter`/`mouseenter` for what it entered, as a browser orders
/// them; the document's hover state (CSS :hover) follows the mouse.
fn move_under(new: Option<NodeId>, at: Option<(f64, f64)>, f: &InputFields) -> Result<(), String> {
    with(|d| {
        let changed = match at {
            Some((x, y)) => d.doc.set_hover_to(x as f32, y as f32),
            None => d.doc.clear_hover(),
        };
        if changed {
            repaint();
        }
    });
    let old = UNDER.with(|u| u.replace(new)).filter(|o| with_quiet(|d| d.connected(*o)));
    if old == new {
        return Ok(());
    }
    // Each side's element and its ancestors (nearest first), and what the two share.
    let chain = |n: Option<NodeId>| -> Vec<NodeId> {
        with_quiet(|d| {
            let mut out = Vec::new();
            let mut at = n;
            while let Some(id) = at {
                if d.is_element(id) {
                    out.push(id);
                }
                at = d.parent(id);
            }
            out
        })
    };
    let (old_chain, new_chain) = (chain(old), chain(new));
    if trace_input() {
        eprintln!("input: mouse left {} for {}", old.map_or("nothing".into(), node_label), new.map_or("nothing".into(), node_label));
    }
    let fields = |related: Option<NodeId>, pointer: bool| {
        let mut g = f.clone();
        g.related = related;
        g.pointer = pointer;
        g.button = if pointer { -1 } else { 0 };
        g.movement = (0.0, 0.0);
        g
    };
    if let Some(o) = old {
        let left: Vec<NodeId> = old_chain.iter().copied().filter(|n| !new_chain.contains(n)).collect();
        for pointer in [true, false] {
            fire_input(o, if pointer { "pointerout" } else { "mouseout" }, fields(new, pointer), true)?;
            for n in &left {
                fire_input_with(*n, if pointer { "pointerleave" } else { "mouseleave" }, fields(new, pointer), false, false)?;
            }
        }
    }
    if let Some(n) = new {
        let entered: Vec<NodeId> = new_chain.iter().rev().copied().filter(|m| !old_chain.contains(m)).collect();
        for pointer in [true, false] {
            fire_input(n, if pointer { "pointerover" } else { "mouseover" }, fields(old, pointer), true)?;
            for m in &entered {
                fire_input_with(*m, if pointer { "pointerenter" } else { "mouseenter" }, fields(old, pointer), false, false)?;
            }
        }
    }
    Ok(())
}

/// Dispatches one input event from the window: pointer and mouse events at the hit-tested element (a click when the
/// button goes up on the element it went down on), wheel there, keys at the focused element (else the body); a
/// press focuses the nearest focusable ancestor (blurring the old one). While the pointer is locked, the mouse's
/// events go to the lock's element. Err when a listener threw.
pub fn input(ev: &Input) -> Result<(), String> {
    if trace_input() {
        eprintln!("input: {ev:?} (locked: {})", LOCK.with(|l| l.get()).is_some());
    }
    match ev {
        Input::Pointer { kind, x, y, button, buttons, mods, touch } => {
            let pointer_id = touch.map_or(1, |t| 2 + t);
            if matches!(kind, PointerKind::Down) {
                ACTIVE_POINTERS.with(|a| a.borrow_mut().insert(pointer_id));
            }
            let locked = if touch.is_none() { held_lock() } else { None };
            // A locked mouse stays where the lock found it.
            let (x, y) = locked.map_or((*x, *y), |(_, at)| at);
            let movement = match locked {
                Some(_) => (0.0, 0.0),
                None => {
                    let last = LAST_AT.with(|l| l.borrow_mut().insert(pointer_id, (x, y)));
                    match (kind, last) {
                        (PointerKind::Move, Some((lx, ly))) => (x - lx, y - ly),
                        _ => (0.0, 0.0),
                    }
                }
            };
            if trace_input() && movement != (0.0, 0.0) {
                eprintln!("input: movement ({}, {})", movement.0, movement.1);
            }
            // A captured pointer's events go to the capturing element (still in the document), not the hit one.
            let captured = CAPTURES.with(|c| c.borrow().get(&pointer_id).copied()).filter(|n| with_quiet(|d| d.doc.get_node(*n).is_some()));
            let target = match locked {
                Some((n, _)) => n,
                None => captured.unwrap_or_else(|| with(|d| hit_target(d, x, y))),
            };
            if trace_input() && !matches!(kind, PointerKind::Move) {
                eprintln!("input: at {}", node_label(target));
            }
            // The pointer lifts: its capture ends (after this up), and a finger stops being active.
            let _release = ReleaseOnUp(matches!(kind, PointerKind::Up).then_some(pointer_id));
            // The first finger down is the primary pointer until it lifts; the others (a pinch's second finger) send
            // pointer events only, as a browser's do: no compatibility mouse events, no click.
            let primary = match touch {
                None => true,
                Some(id) => PRIMARY_TOUCH.with(|p| {
                    if matches!(kind, PointerKind::Down) && p.get().is_none() {
                        p.set(Some(*id));
                    }
                    let primary = p.get() == Some(*id);
                    if primary && matches!(kind, PointerKind::Up) {
                        p.set(None);
                    }
                    primary
                }),
            };
            let mut f = InputFields { client: (x, y), button: *button, buttons: *buttons, mods: *mods, pointer: true, touch: *touch, primary, movement, ..Default::default() };
            if !primary {
                let name = match kind {
                    PointerKind::Down => "pointerdown",
                    PointerKind::Up => "pointerup",
                    _ => "pointermove",
                };
                if matches!(kind, PointerKind::Move) {
                    f.button = -1;
                }
                fire_input(target, name, f, true)?;
                return Ok(());
            }
            if touch.is_some() && pan(kind, pointer_id, (x, y), target, captured.is_some(), &f)? {
                return Ok(());
            }
            // The mouse's hover follows it (not a finger's, not a locked mouse's).
            if touch.is_none() && locked.is_none() && !matches!(kind, PointerKind::Wheel { .. }) {
                move_under(Some(target), Some((x, y)), &f)?;
            }
            match kind {
                PointerKind::Move => {
                    f.button = -1;
                    fire_input(target, "pointermove", f.clone(), true)?;
                    // A browser sends no compatibility mousemove while a finger drags (only a tap's, at its end).
                    if touch.is_some() {
                        return Ok(());
                    }
                    f.pointer = false;
                    f.button = 0;
                    fire_input(target, "mousemove", f, true)?;
                    text_field::drag(x, y, *buttons);
                }
                PointerKind::Down => {
                    KEYBOARD_MODALITY.with(|k| k.set(false));
                    caret_activity();
                    PRESSED.with(|p| p.set(Some((*button, target))));
                    // The press count: another press of the same button soon after, close by, counts on.
                    let count = PRESSES.with(|p| {
                        let count = match p.get() {
                            Some((b, at, (px, py), c)) if b == *button && at.elapsed().as_millis() <= MULTI_CLICK_MS && (x - px).abs() <= MULTI_CLICK_PX && (y - py).abs() <= MULTI_CLICK_PX => c + 1,
                            _ => 1,
                        };
                        p.set(Some((*button, std::time::Instant::now(), (x, y), count)));
                        count
                    });
                    with(|d| {
                        if d.doc.active_node() {
                            repaint();
                        }
                    });
                    fire_input(target, "pointerdown", f.clone(), true)?;
                    f.pointer = false;
                    f.detail = f64::from(count);
                    let proceed = fire_input(target, "mousedown", f.clone(), true)?;
                    if proceed && locked.is_none() {
                        focus_for_press(target)?;
                        // In an editing host the press puts the caret where it landed (selection.rs); in a text field
                        // too, and its drag selects (text_field.rs).
                        selection::press_caret(x, y);
                        if *button == 0 && touch.is_none() {
                            text_field::press(target, x, y, count, mods.shift);
                        }
                    }
                    // Elsewhere than on Windows the context menu comes with the press.
                    if !cfg!(windows) && *button == 2 && touch.is_none() {
                        fire_input(target, "contextmenu", f, true)?;
                    }
                }
                PointerKind::Up => {
                    let count = PRESSES.with(|p| p.get().filter(|(b, ..)| b == button).map_or(1, |(.., c)| c));
                    if *buttons == 0 {
                        with(|d| {
                            if d.doc.unactive_node() {
                                repaint();
                            }
                        });
                    }
                    fire_input(target, "pointerup", f.clone(), true)?;
                    f.pointer = false;
                    f.detail = f64::from(count);
                    fire_input(target, "mouseup", f.clone(), true)?;
                    let pressed = PRESSED.with(|p| p.take());
                    if let Some((b, down_on)) = pressed.filter(|(b, _)| b == button) {
                        // The click goes to the nearest element containing both the down's and the up's targets.
                        let common = with(|d| {
                            let mut at = Some(down_on);
                            while let Some(n) = at {
                                let mut t = Some(target);
                                while let Some(m) = t {
                                    if m == n {
                                        return Some(n);
                                    }
                                    t = d.parent(m);
                                }
                                at = d.parent(n);
                            }
                            None
                        });
                        if b == 0 {
                            text_field::release();
                        }
                        // A disabled control's click is not dispatched (nor its double click).
                        if let Some(c) = common.filter(|c| !with_quiet(|d| in_disabled_control(d, *c))) {
                            if b == 0 {
                                // The click with its activation: a checkbox toggled before it, a submit button's
                                // submission and a label's click of its control after it (text_field.rs).
                                text_field::click_with_activation(c, || fire_input(c, "click", f.clone(), true))?;
                            } else {
                                fire_input(c, "auxclick", f.clone(), true)?;
                            }
                            if b == 0 && count == 2 {
                                fire_input(c, "dblclick", f.clone(), true)?;
                            }
                        }
                    }
                    // On Windows the context menu comes with the release.
                    if cfg!(windows) && *button == 2 && touch.is_none() {
                        fire_input(target, "contextmenu", f, true)?;
                    }
                }
                PointerKind::Wheel { dx, dy } => {
                    f.pointer = false;
                    f.button = 0;
                    f.delta = (*dx, *dy);
                    // Not cancelled, the wheel scrolls what is under it (deltas are a browser's: positive down/right).
                    if fire_input(target, "wheel", f, true)? {
                        user_scroll(target, *dx, *dy)?;
                    }
                }
            }
            Ok(())
        }
        Input::Motion { dx, dy, buttons, mods } => {
            // Motion after the lock ended (still queued) is no event: the cursor did not move.
            let Some((n, at)) = held_lock() else { return Ok(()) };
            let mut f = InputFields { client: at, button: -1, buttons: *buttons, mods: *mods, pointer: true, primary: true, movement: (*dx, *dy), ..Default::default() };
            fire_input(n, "pointermove", f.clone(), true)?;
            f.pointer = false;
            f.button = 0;
            fire_input(n, "mousemove", f, true)?;
            Ok(())
        }
        Input::LockLost => {
            exit_pointer_lock();
            Ok(())
        }
        Input::Leave => {
            if held_lock().is_none() {
                move_under(None, None, &InputFields::default())?;
            }
            Ok(())
        }
        Input::Focus(on) => {
            let el = with(focused_element);
            WINDOW_FOCUSED.with(|f| f.set(*on));
            if *on {
                fire_window_event("focus");
                if let Some(n) = el {
                    fire_plain(n, "focus", false)?;
                    fire_plain(n, "focusin", true)?;
                }
            } else {
                // The lock goes with the focus (the window has given the mouse back already).
                exit_pointer_lock();
                if let Some(n) = el {
                    fire_plain(n, "blur", false)?;
                    fire_plain(n, "focusout", true)?;
                }
                fire_window_event("blur");
            }
            Ok(())
        }
        Input::Key { down, key, code, mods, repeat } => {
            // Escape is the browser's while the pointer is locked: it ends the lock, and the page hears neither its
            // press nor its release.
            if *down && key == "Escape" && held_lock().is_some() {
                exit_pointer_lock();
                // An Escape the keyboard lock does not hold ends fullscreen with the pointer lock (a browser's
                // Escape leaves every exclusive mode at once).
                if fullscreen_active() && !escape_locked() {
                    exit_fullscreen(None);
                }
                ESCAPE_KEPT.with(|k| k.set(true));
                return Ok(());
            }
            // Escape is the browser's while full screen too: it leaves, and the page hears neither its press nor its
            // release, unless the keyboard lock holds it (navigator.keyboard.lock): then the page hears it, and
            // holding it leaves (flush_fullscreen).
            if key == "Escape" && fullscreen_active() {
                if !escape_locked() {
                    if *down {
                        exit_fullscreen(None);
                        ESCAPE_KEPT.with(|k| k.set(true));
                        return Ok(());
                    }
                } else if !*down {
                    ESCAPE_HELD.with(|e| e.set(None));
                } else if !*repeat {
                    ESCAPE_HELD.with(|e| e.set(Some(std::time::Instant::now())));
                }
            }
            if !*down && key == "Escape" && ESCAPE_KEPT.with(|k| k.replace(false)) {
                return Ok(());
            }
            let target = with(|d| focused_element(d).or_else(|| d.body()).unwrap_or_else(|| d.root()));
            if trace_input() {
                eprintln!("input: at {}", node_label(target));
            }
            if *down && !matches!(key.as_str(), "Shift" | "Control" | "Alt" | "Meta") {
                KEYBOARD_MODALITY.with(|k| k.set(true));
                caret_activity();
            }
            let f = InputFields { mods: *mods, key: key.clone(), code: code.clone(), repeat: *repeat, keyboard: true, ..Default::default() };
            let proceed = fire_input(target, if *down { "keydown" } else { "keyup" }, f, true)?;
            // Tab moves the focus (sequential focus navigation); the editing commands' keys (copy, cut, paste, undo,
            // redo) are clipboard.rs's.
            if *down && proceed && key == "Tab" && !mods.ctrl && !mods.alt && !mods.meta {
                return tab_navigation(mods.shift);
            }
            if *down && proceed && clipboard::key_default(key, *mods)? {
                return Ok(());
            }
            // A key down no listener canceled does what it does in an editing host (selection.rs: typing, deleting,
            // moving the caret).
            if *down && proceed {
                // A text field's default goes to the field focused now (a keydown listener may have moved the
                // focus, as a chat box's Enter does): text_field.rs; else an editing host's.
                let done = match with(focused_element) {
                    Some(f) => text_field::key_default(f, key, *mods)?,
                    None => false,
                };
                if !done {
                    selection::key_default(target, key, *mods)?;
                }
            }
            Ok(())
        }
    }
}

/// A press moves focus to the nearest focusable ancestor of the target (none: the focus is cleared): `blur` and
/// `focusout` at the old element, `focus` and `focusin` at the new (blur and focus do not bubble).
fn focus_for_press(target: NodeId) -> Result<(), String> {
    let (old, new) = with(|d| {
        let mut at = Some(target);
        let mut new = None;
        while let Some(n) = at {
            if d.is_element(n) && focusable(d, n) {
                new = Some(n);
                break;
            }
            at = d.parent(n);
        }
        (focused_element(d), new)
    });
    // Sequential focus navigation starts from where the press was.
    NAV_START.with(|s| s.set(Some(target)));
    if old == new {
        return Ok(());
    }
    change_focus(old, new)?;
    // A mouse focus shows `:focus-visible` only on what takes typing.
    if let Some(n) = new {
        set_focus_visible(with_quiet(|d| text_field::is_field(d, n) || selection::is_editing_host(d, n)));
    }
    Ok(())
}

/// The focus moves from `old` to `new` (None: cleared): `blur` and `focusout` at the old element, `focus` and
/// `focusin` at the new (blur and focus do not bubble).
fn change_focus(old: Option<NodeId>, new: Option<NodeId>) -> Result<(), String> {
    // A text field the user edited fires `change` as it loses the focus, before its `blur` (text_field.rs).
    text_field::focus_moving(old, new)?;
    with(|d| match new {
        Some(n) => {
            d.doc.set_focus_to(n);
        }
        None => d.doc.clear_focus(),
    });
    repaint();
    if let Some(n) = old.filter(|n| with(|d| d.is_element(*n))) {
        fire_plain(n, "blur", false)?;
        fire_plain(n, "focusout", true)?;
    }
    if let Some(n) = new.filter(|n| with(|d| d.is_element(*n))) {
        fire_plain(n, "focus", false)?;
        fire_plain(n, "focusin", true)?;
    }
    Ok(())
}

/* ── interfaces (instanceof) ────────────────────────────────────────── */

/// The DOM interfaces the host's values implement, as globals: interface objects whose `instanceof` answers from a
/// node's kind (namespace and tag) or an event's type.
pub const INTERFACES: &[&str] = &[
    "HTMLElement", "SVGElement", "Element", "Node", "Text", "Comment", "Document", "DocumentFragment", "Window",
    "Event", "UIEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "InputEvent", "WheelEvent", "TouchEvent",
    "HTMLIFrameElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLFormElement", "HTMLAnchorElement",
    "HTMLImageElement", "HTMLCanvasElement", "HTMLDivElement", "HTMLSpanElement", "HTMLButtonElement", "HTMLLabelElement",
    "HTMLOptionElement", "HTMLVideoElement", "HTMLAudioElement", "HTMLParagraphElement", "HTMLUListElement", "HTMLOListElement",
    "HTMLLIElement", "HTMLTableElement", "HTMLStyleElement", "HTMLLinkElement", "HTMLScriptElement", "HTMLBodyElement",
    "HTMLHeadElement", "HTMLHtmlElement", "HTMLDialogElement", "HTMLDetailsElement", "HTMLProgressElement",
    "HTMLTemplateElement", "HTMLTitleElement", "HTMLBRElement", "Range", "Selection", "ClipboardEvent", "DataTransfer",
];

/// Node's constants (nodeType values, compareDocumentPosition's bits), read off the Node interface object and every
/// interface below it (`Node.TEXT_NODE`, `HTMLElement.ELEMENT_NODE`), as a browser's constructors inherit them.
pub fn node_constant(interface: &str, name: &str) -> Option<f64> {
    let node_interface = matches!(interface, "Node" | "Element" | "HTMLElement" | "SVGElement" | "Text" | "Comment" | "Document" | "DocumentFragment")
        || (interface.starts_with("HTML") && interface.ends_with("Element"));
    if !node_interface {
        return None;
    }
    Some(match name {
        "ELEMENT_NODE" => 1.0,
        "ATTRIBUTE_NODE" => 2.0,
        "TEXT_NODE" => 3.0,
        "CDATA_SECTION_NODE" => 4.0,
        "PROCESSING_INSTRUCTION_NODE" => 7.0,
        "COMMENT_NODE" => 8.0,
        "DOCUMENT_NODE" => 9.0,
        "DOCUMENT_TYPE_NODE" => 10.0,
        "DOCUMENT_FRAGMENT_NODE" => 11.0,
        "DOCUMENT_POSITION_DISCONNECTED" => 1.0,
        "DOCUMENT_POSITION_PRECEDING" => 2.0,
        "DOCUMENT_POSITION_FOLLOWING" => 4.0,
        "DOCUMENT_POSITION_CONTAINS" => 8.0,
        "DOCUMENT_POSITION_CONTAINED_BY" => 16.0,
        "DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC" => 32.0,
        _ => return None,
    })
}

/// The interfaces a node implements, most general first.
pub fn node_interfaces(n: NodeId) -> Vec<&'static str> {
    if selection::is_fragment(n) {
        return vec!["Node", "DocumentFragment"];
    }
    with_quiet(|d| {
        let Some(node) = d.doc.get_node(n) else { return Vec::new() };
        let mut out = vec!["Node"];
        match &node.data {
            NodeData::Document(_) => out.push("Document"),
            NodeData::Text(_) => out.push("Text"),
            NodeData::Comment { .. } => out.push("Comment"),
            _ => {
                if let Some(e) = node.element_data() {
                    out.push("Element");
                    if e.name.ns == ns!(html) {
                        out.push("HTMLElement");
                        out.push(HTML_INTERFACES.iter().find(|(t, _)| *t == &*e.name.local).map_or("HTMLElement", |(_, i)| *i));
                    } else if e.name.ns == ns!(svg) {
                        out.push("SVGElement");
                    }
                }
            }
        }
        out
    })
}

/// The interfaces a non-node DOM object implements (an event by its type).
pub fn aux_interfaces(a: &Aux) -> Vec<&'static str> {
    match a {
        Aux::Range(_) => return vec!["Range"],
        Aux::Selection => return vec!["Selection"],
        Aux::DataTransfer(_) => return vec!["DataTransfer"],
        _ => {}
    }
    let Aux::Event(slot) = a else { return Vec::new() };
    let kind = with_quiet(|d| d.events.get(*slot).and_then(|e| e.as_ref()).map(|e| e.kind.clone())).unwrap_or_default();
    let mut out = vec!["Event"];
    let ui: &[&'static str] = match kind.as_str() {
        "click" | "dblclick" | "auxclick" | "contextmenu" | "mousedown" | "mouseup" | "mousemove" | "mouseover" | "mouseout" | "mouseenter" | "mouseleave" => &["UIEvent", "MouseEvent"],
        // The document's pointerlockchange and pointerlockerror are plain events.
        k if k.starts_with("pointer") && !k.starts_with("pointerlock") => &["UIEvent", "MouseEvent", "PointerEvent"],
        "wheel" => &["UIEvent", "MouseEvent", "WheelEvent"],
        "keydown" | "keyup" | "keypress" => &["UIEvent", "KeyboardEvent"],
        "focus" | "blur" | "focusin" | "focusout" => &["UIEvent", "FocusEvent"],
        "input" | "beforeinput" => &["UIEvent", "InputEvent"],
        "copy" | "cut" | "paste" => &["ClipboardEvent"],
        k if k.starts_with("touch") => &["UIEvent", "TouchEvent"],
        _ => &[],
    };
    out.extend_from_slice(ui);
    out
}

/// A dataset key's attribute (`fooBar` is `data-foo-bar`: each ASCII upper-case letter a dash and its lower case).
fn data_attribute(key: &str) -> String {
    let mut out = String::from("data-");
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// The event interfaces a program may construct.
pub const CONSTRUCTIBLE_EVENTS: &[&str] = &["Event", "UIEvent", "MouseEvent", "PointerEvent", "WheelEvent", "KeyboardEvent", "FocusEvent", "InputEvent"];

/// `new MouseEvent(type, init)` (and the other constructible interfaces), as a browser answers it: an event of `type`,
/// its fields from `init` when that is another event (a program may replay input on its canvas so), else the
/// dictionary defaults (not bubbling, not cancelable, no position).
pub fn construct_event(args: &[Value]) -> Result<Value, String> {
    let Some(kind) = args.first().filter(|v| !matches!(v, Value::Undefined)).map(objects::to_display) else {
        return Err("Failed to construct 'Event': 1 argument required, but only 0 present.".into());
    };
    let from = match args.get(1) {
        Some(Value::Object(r)) => match objects::aux_of(*r) {
            Some(Aux::Event(slot)) => Some(slot),
            _ => None,
        },
        _ => None,
    };
    let slot = with(|d| {
        let copied = from.and_then(|s| d.events.get(s).and_then(|e| e.as_ref()).map(|e| (e.bubbles, e.cancelable, e.input.clone())));
        let (bubbles, cancelable, input) = copied.unwrap_or((false, false, None));
        let slot = d.new_event(&kind, bubbles, cancelable, false);
        if let Some(Some(e)) = d.events.get_mut(slot) {
            e.input = input;
        }
        slot
    });
    Ok(objects::aux_value(Aux::Event(slot)))
}

/// The document's animation clock, in seconds: the program's (timers.rs), which the window's paint resolves at too.
/// Two clocks had a CSS transition started on one read on the other, seconds apart: a fade-in (a page's root
/// opacity) never left its start, and everything under it drew see-through.
///
/// The frame's clock (timers.rs `frame_clock_ms`: the window samples it once a frame, `begin_frame`), as a browser
/// samples its animations once per frame: the frame's many forced layouts (a script's offsetWidth, a canvas's box) and
/// its paint read the same time, so Blitz ticks the CSS animations once a frame and every other resolve on an unchanged
/// document returns at once (`BaseDocument::needs_resolve`). With no window frame yet, the program's clock now.
pub fn document_time() -> f64 {
    // BLITZ_LEGACY_RESOLVE=1 (blitz-dom util.rs, an A/B switch): the program's clock at each read, as before.
    if blitz_dom::util::legacy_resolve() {
        return crate::timers::now_ms() / 1000.0;
    }
    crate::timers::frame_clock_ms() / 1000.0
}

/// The document laid out now (an observer's delivery reads boxes after this).
pub fn resolve_layout() {
    with_quiet(|d| resolve_doc(&mut d.doc, "resolve_layout: observers, layout reads"));
}

/// The document restyled and laid out (`why`: the caller, for SCRIPTC_HOST_TRACE_CALLS). Blitz's resolve returns at
/// once when nothing changed since the last (`BaseDocument::needs_resolve`): every caller may resolve freely.
pub fn resolve_doc(doc: &mut BaseDocument, why: &'static str) {
    let now = document_time();
    if crate::abi::calls::on() && !doc.needs_resolve(now) {
        crate::abi::calls::count("resolve clean (returned at once)", 0);
    }
    let _trace = crate::abi::calls::span(|| format!("resolve ({why})"));
    doc.resolve(now);
}

/// The canvas a layer's scene draws for (a layer's scene attach): the document paints a hole there (blitz-paint
/// draw_native_surface), so the scene composited under the page shows through it.
pub fn set_native_surface(id: NodeId) {
    SURFACES.with(|s| s.borrow_mut().0 = Some(id));
    apply_native_surfaces();
}

/// The secondary views' canvases this frame (the layer's scene: view_frames): each a hole too, its view composited under it.
pub fn set_view_surfaces(ids: &[NodeId]) {
    SURFACES.with(|s| s.borrow_mut().1 = ids.to_vec());
    apply_native_surfaces();
}

thread_local! {
    /// The main scene's canvas and the views' canvases: the document's holes (BaseDocument::native_surfaces).
    static SURFACES: std::cell::RefCell<(Option<NodeId>, Vec<NodeId>)> = const { std::cell::RefCell::new((None, Vec::new())) };
}

fn apply_native_surfaces() {
    let want: std::collections::HashSet<NodeId> = SURFACES.with(|s| {
        let s = s.borrow();
        s.0.into_iter().chain(s.1.iter().copied()).collect()
    });
    // Unchanged, the document is left clean (the window asks every frame for its canvases). Changed, the canvases
    // added and removed repaint (Blitz damages them: a hole appears or closes).
    if with_quiet(|d| d.doc.set_native_surfaces(want)) {
        repaint();
    }
}

/// A canvas's drawing buffer: its `width` / `height` attributes, 300 x 150 by default (as a browser sizes a canvas
/// context's texture). No layout.
pub fn canvas_buffer(id: NodeId) -> Option<(u32, u32)> {
    with_quiet(|d| {
        let node = d.doc.get_node(id)?;
        let attr = |name: &str| node.element_data()?.attrs().iter().find(|a| &*a.name.local == name).and_then(|a| a.value.trim().parse::<u32>().ok());
        Some((attr("width").unwrap_or(300).max(1), attr("height").unwrap_or(150).max(1)))
    })
}

/// A canvas this frame: its drawing buffer, and its border box in physical pixels;
/// None while it has no box.
pub fn canvas_frame(id: NodeId) -> Option<((u32, u32), [f32; 4])> {
    let buffer = canvas_buffer(id)?;
    with_quiet(|d| {
        resolve_doc(&mut d.doc, "canvas_frame: the window's frame");
        let scale = d.doc.viewport().scale();
        let node = d.doc.get_node(id)?;
        let at = node.absolute_position(0.0, 0.0);
        let size = node.final_layout().size;
        if size.width <= 0.0 || size.height <= 0.0 {
            return None;
        }
        Some((buffer, [at.x * scale, at.y * scale, size.width * scale, size.height * scale]))
    })
}

/// Whether a view's canvas shows on the page now: in the document, and neither it nor an ancestor is `display: none`,
/// `visibility: hidden` or fully transparent (a faded-out stage, a closed pane), as a browser would draw it.
pub fn canvas_shown(id: NodeId) -> bool {
    with_quiet(|d| {
        let Some(node) = d.doc.get_node(id) else { return false };
        if !node.flags.is_in_document() {
            return false;
        }
        if node.primary_styles().is_some_and(|s| {
            format!("{:?}", s.get_inherited_box().visibility) != "Visible"
        }) {
            return false;
        }
        let mut at = Some(id);
        while let Some(n) = at.and_then(|n| d.doc.get_node(n)) {
            if let Some(s) = n.primary_styles() {
                if s.clone_opacity() <= 0.0 || s.clone_display().is_none() {
                    return false;
                }
            }
            at = n.parent;
        }
        true
    })
}

/// The content box of a node in CSS px (x, y at the padding edge, as ResizeObserver's contentRect gives them, the way
/// a ResizeObserver measures it); None for a node that no longer exists.
pub fn content_box(id: NodeId) -> Option<[f32; 4]> {
    with_quiet(|d| {
        let node = d.doc.get_node(id)?;
        let l = node.final_layout();
        let width = (l.size.width - l.border.left - l.border.right - l.padding.left - l.padding.right).max(0.0);
        let height = (l.size.height - l.border.top - l.border.bottom - l.padding.top - l.padding.bottom).max(0.0);
        Some([l.padding.left, l.padding.top, width, height])
    })
}

/// The document's mutation count (MutationObserver's clock).
pub fn mutation_count() -> u64 {
    with_quiet(|d| d.mutations)
}

/// `getComputedStyle(el).getPropertyValue(name)`: Blitz's resolved value, as a browser reads it.
/// A DOMRect-shaped object (x, y, width, height and the edges) for a box in viewport CSS px. The allocation's count is
/// the operation's already (values::new_object), dropped once the result is out.
fn client_rect([x, y, w, h]: [f64; 4]) -> Result<Value, String> {
    let rect = crate::values::new_object();
    let Value::Object(r) = rect else { unreachable!() };
    for (k, v) in [("x", x), ("y", y), ("width", w), ("height", h), ("left", x), ("top", y), ("right", x + w), ("bottom", y + h)] {
        crate::values::set(r, k, Value::Number(v))?;
    }
    Ok(rect)
}

pub fn resolved_style(id: NodeId, property: &str) -> String {
    with_quiet(|d| {
        resolve_doc(&mut d.doc, "getComputedStyle");
        d.doc.resolved_style_value(id, property)
    })
}
