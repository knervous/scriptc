//! [fork] The caret of an editing host (a `contenteditable` element holding the focus), placed by the
//! embedder's DOM selection: a boundary point (a text node and a UTF-16 offset in its data, or an element and a
//! child index). blitz-paint draws it in the inline root that lays the point's text out.
//!
//! A boundary point and an inline root's text (`TextLayout::text`) are mapped by walking the root's subtree in the
//! order `build_inline_layout_into` pushes it: the root's `::before`, its children (an inline span's own
//! `::before`, children, `::after`; a `<br>` one "\n"; an atomic inline box nothing), the root's `::after`. Text
//! counts as its node holds it, so the mapping is exact where white space is preserved (`pre`, `pre-wrap`,
//! `break-spaces`, as an editing host's usually is); where the layout's text differs in length (white space
//! collapsed, a case transform that changed lengths) no position is given.

use blitz_traits::node_id::NodeId;
use style::values::computed::Display;
use style::values::specified::box_::{DisplayInside, DisplayOutside};

use crate::layout::replaced::is_inline_box_element;
use crate::node::{ListItemLayout, ListItemLayoutPosition, Marker};
use crate::{BaseDocument, NodeData};

/// A DOM boundary point: `offset` is a UTF-16 offset in a text node's data, or a child index in an element.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EditingCaret {
    pub node: NodeId,
    pub offset: usize,
}

/// A caret move by the layout (`BaseDocument::caret_moved`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaretMove {
    LineStart,
    LineEnd,
    LineUp,
    LineDown,
}

/// One piece of an inline root's text: a text node's data (or a `<br>`'s "\n", or a list marker's text, which
/// belongs to the root) at a byte range of the layout's text.
#[derive(Clone, Copy, Debug)]
pub struct InlineTextPiece {
    pub node: NodeId,
    pub start: usize,
    pub len: usize,
}

/// Byte index of the `utf16`th UTF-16 unit in `s` (clamped to its end; inside a surrogate pair, the pair's start).
pub fn utf16_to_byte(s: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        if units + c.len_utf16() > utf16 {
            return i;
        }
        units += c.len_utf16();
    }
    s.len()
}

/// UTF-16 units in `s` before byte index `byte` (clamped).
pub fn byte_to_utf16(s: &str, byte: usize) -> usize {
    s.char_indices().take_while(|(i, _)| *i < byte).map(|(_, c)| c.len_utf16()).sum()
}

impl BaseDocument {
    /// The editing caret the embedder set (None: no caret is drawn).
    pub fn editing_caret(&self) -> Option<EditingCaret> {
        self.editing_caret
    }

    /// Sets the editing caret (None hides it); the inline roots it leaves and enters are repainted. Answers whether
    /// it changed.
    pub fn set_editing_caret(&mut self, caret: Option<EditingCaret>) -> bool {
        if self.editing_caret == caret {
            return false;
        }
        let old = self.editing_caret.and_then(|c| self.inline_root_of(c.node));
        self.editing_caret = caret;
        let new = caret.and_then(|c| self.inline_root_of(c.node));
        for root in [old, new].into_iter().flatten() {
            self.damage_element(root);
        }
        true
    }

    /// Whether the caret's blink is in its off phase (nothing drawn).
    pub fn caret_blink_off(&self) -> bool {
        self.caret_blink_off
    }

    /// The caret's blink phase, from the embedder's clock (a browser blinks it, solid while the user types or moves
    /// it): the editing caret's inline root and the focused text input are repainted when it changes. Answers whether
    /// it changed.
    pub fn set_caret_blink_off(&mut self, off: bool) -> bool {
        if self.caret_blink_off == off {
            return false;
        }
        self.caret_blink_off = off;
        if let Some(root) = self.editing_caret.and_then(|c| self.inline_root_of(c.node)) {
            self.damage_element(root);
        } else if let Some(id) = self.get_focussed_node_id() {
            // An empty editing host draws its caret itself (no inline root); a text input draws its own.
            self.damage_element(id);
        }
        true
    }

    /// Where the caret at `caret` goes by `how` in its inline root's layout (lines as laid out, grapheme clusters as
    /// shaped): a DOM boundary point, or None when its text is not mapped (see the module's note). Up from the first
    /// line goes to the text's start, Down from the last to its end, as a browser's caret does.
    pub fn caret_moved(&self, caret: EditingCaret, how: CaretMove) -> Option<EditingCaret> {
        let (root, byte) = self.caret_inline_position(caret)?;
        let layout = &self.get_node(root)?.element_data()?.inline_layout_data.as_ref()?.layout;
        let sel = parley::Selection::from_byte_index(layout, byte, parley::Affinity::Downstream);
        let to = match how {
            CaretMove::LineStart => sel.line_start(layout, false),
            CaretMove::LineEnd => sel.line_end(layout, false),
            CaretMove::LineUp => sel.previous_line(layout, false),
            CaretMove::LineDown => sel.next_line(layout, false),
        };
        self.inline_boundary_at(root, to.focus().index())
    }

    /// Whether `caret` sits on a grapheme cluster's boundary in its inline root's layout (true when its text is not
    /// mapped: the caller's own steps stand).
    pub fn caret_on_cluster_boundary(&self, caret: EditingCaret) -> bool {
        let Some((root, byte)) = self.caret_inline_position(caret) else { return true };
        let Some(layout) = self.get_node(root).and_then(|n| n.element_data()).and_then(|e| e.inline_layout_data.as_ref()).map(|l| &l.layout) else {
            return true;
        };
        parley::Cursor::from_byte_index(layout, byte, parley::Affinity::Downstream).index() == byte
    }

    /// The selection highlight an embedder's DOM selection paints: from (inline root, byte) to (inline root, byte) of
    /// their inline text (`caret_inline_position`), or None for none; the inline roots it leaves and covers are
    /// repainted. Answers whether it changed.
    pub fn set_selection_highlight(&mut self, highlight: Option<((NodeId, usize), (NodeId, usize))>) -> bool {
        let before = self.get_text_selection_ranges();
        match highlight {
            Some(((a, ao), (f, fo))) => self.set_text_selection(a, ao, f, fo),
            None => self.clear_text_selection(),
        }
        let after = self.get_text_selection_ranges();
        if before == after {
            return false;
        }
        for (root, ..) in before.into_iter().chain(after) {
            self.damage_element(root);
        }
        true
    }

    /// The nearest inline root at or above `node` (by the DOM's parents).
    pub fn inline_root_of(&self, node: NodeId) -> Option<NodeId> {
        let mut at = Some(node);
        while let Some(id) = at {
            let n = self.get_node(id)?;
            if n.flags.is_inline_root() && n.element_data().is_some_and(|e| e.inline_layout_data.is_some()) {
                return Some(id);
            }
            at = n.parent;
        }
        None
    }

    /// The pieces of `root`'s inline text in layout order, or None when `root` has no inline layout or the pieces
    /// do not add up to its text (see the module's note).
    pub fn inline_text_pieces(&self, root: NodeId) -> Option<Vec<InlineTextPiece>> {
        let node = self.get_node(root)?;
        let text_len = node.element_data()?.inline_layout_data.as_ref()?.text.len();
        let mut pieces = Vec::new();
        let mut at = 0usize;
        if let Some(ListItemLayout { marker, position: ListItemLayoutPosition::Inside }) =
            node.element_data().and_then(|e| e.list_item_data.as_deref())
        {
            let len = match marker {
                Marker::Char(c) => format!("{c} ").len(),
                Marker::String(s) => s.len(),
            };
            pieces.push(InlineTextPiece { node: root, start: 0, len });
            at = len;
        }
        if let Some(before) = node.before() {
            self.push_inline_pieces(before, &mut pieces, &mut at);
        }
        for &child in node.children.iter() {
            self.push_inline_pieces(child, &mut pieces, &mut at);
        }
        if let Some(after) = node.after() {
            self.push_inline_pieces(after, &mut pieces, &mut at);
        }
        (at == text_len).then_some(pieces)
    }

    fn push_inline_pieces(&self, id: NodeId, pieces: &mut Vec<InlineTextPiece>, at: &mut usize) {
        let Some(node) = self.get_node(id) else { return };
        match &node.data {
            NodeData::Text(t) => {
                pieces.push(InlineTextPiece { node: id, start: *at, len: t.content.len() });
                *at += t.content.len();
            }
            NodeData::Element(e) | NodeData::AnonymousBlock(e) => {
                if *e.name.local == *"input" && e.attr(markup5ever::local_name!("type")) == Some("hidden") {
                    return;
                }
                // As build_inline_layout_into reads it (a pseudo-element without one is inline).
                let display = node.display_style().unwrap_or(Display::inline());
                match (display.outside(), display.inside()) {
                    (DisplayOutside::None, DisplayInside::None) => {}
                    (DisplayOutside::None, DisplayInside::Contents) => {
                        for &c in node.children.iter() {
                            self.push_inline_pieces(c, pieces, at);
                        }
                    }
                    (DisplayOutside::Inline, DisplayInside::Flow) if !is_inline_box_element(&e.name.local) => {
                        if *e.name.local == *"br" {
                            pieces.push(InlineTextPiece { node: id, start: *at, len: 1 });
                            *at += 1;
                            return;
                        }
                        if let Some(b) = node.before() {
                            self.push_inline_pieces(b, pieces, at);
                        }
                        for &c in node.children.iter() {
                            self.push_inline_pieces(c, pieces, at);
                        }
                        if let Some(a) = node.after() {
                            self.push_inline_pieces(a, pieces, at);
                        }
                    }
                    // An atomic inline (an inline box): no text of its own in the root's.
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// Whether `node` is `ancestor` or below it (DOM parents).
    fn is_inclusive_descendant(&self, mut node: NodeId, ancestor: NodeId) -> bool {
        loop {
            if node == ancestor {
                return true;
            }
            match self.get_node(node).and_then(|n| n.parent) {
                Some(p) => node = p,
                None => return false,
            }
        }
    }

    /// The caret's inline root and byte offset in its text. A point in an element is the start of the first piece at
    /// or after its child (the end of the last one before it when none follows); an editing host with no text of
    /// its own (only generated content, a placeholder) puts the caret at its start, before that content, as a
    /// browser shows it.
    pub fn caret_inline_position(&self, caret: EditingCaret) -> Option<(NodeId, usize)> {
        let root = self.inline_root_of(caret.node)?;
        let Some(pieces) = self.inline_text_pieces(root) else {
            // Unmapped text (see the module's note): an empty host still has its caret at its start.
            let empty = self.get_node(root)?.children.is_empty();
            return empty.then_some((root, 0));
        };
        let node = self.get_node(caret.node)?;
        if let NodeData::Text(t) = &node.data {
            let piece = pieces.iter().find(|p| p.node == caret.node)?;
            return Some((root, piece.start + utf16_to_byte(&t.content, caret.offset)));
        }
        // No text of the host's own (only generated content, a placeholder): its start.
        if !pieces.iter().any(|p| p.node != root && !self.is_generated(p.node, root)) {
            return Some((root, 0));
        }
        // The pieces are contiguous: a point between children is the start of the first piece in the children after
        // it, else the end of the last piece in those before it, else (an empty element) the point before the element.
        let (mut container, mut index) = (caret.node, caret.offset);
        loop {
            let n = self.get_node(container)?;
            let children = &n.children;
            let k = index.min(children.len());
            let first_after = children[k..].iter().find_map(|c| pieces.iter().find(|p| self.is_inclusive_descendant(p.node, *c)));
            if let Some(p) = first_after {
                return Some((root, p.start));
            }
            let last_before = children[..k].iter().rev().find_map(|c| pieces.iter().rev().find(|p| self.is_inclusive_descendant(p.node, *c)));
            if let Some(p) = last_before {
                return Some((root, p.start + p.len));
            }
            if container == root {
                return Some((root, 0));
            }
            let parent = n.parent?;
            index = self.get_node(parent)?.children.iter().position(|c| *c == container)?;
            container = parent;
        }
    }

    /// Whether `node` is generated content of `root` (inside its ::before or ::after, which are not its children).
    fn is_generated(&self, node: NodeId, root: NodeId) -> bool {
        let Some(r) = self.get_node(root) else { return false };
        [r.before(), r.after()].into_iter().flatten().any(|pe| self.is_inclusive_descendant(node, pe))
    }

    /// The DOM boundary point at byte `byte` of `root`'s inline text: a text node and the UTF-16 offset in it, or,
    /// past a `<br>`, the br's parent and the index after it. Generated content maps to the root's start or end.
    pub fn inline_boundary_at(&self, root: NodeId, byte: usize) -> Option<EditingCaret> {
        let pieces = self.inline_text_pieces(root)?;
        let mut last: Option<EditingCaret> = None;
        for p in &pieces {
            let node = self.get_node(p.node)?;
            if p.node == root || self.is_generated(p.node, root) {
                if byte < p.start + p.len.max(1) && last.is_none() {
                    return Some(EditingCaret { node: root, offset: 0 });
                }
                continue;
            }
            match &node.data {
                NodeData::Text(t) => {
                    if byte <= p.start + p.len {
                        let within = byte.saturating_sub(p.start);
                        return Some(EditingCaret { node: p.node, offset: byte_to_utf16(&t.content, within) });
                    }
                    last = Some(EditingCaret { node: p.node, offset: t.content.encode_utf16().count() });
                }
                _ => {
                    let parent = node.parent?;
                    let index = self.get_node(parent)?.children.iter().position(|c| *c == p.node)?;
                    if byte <= p.start {
                        return Some(EditingCaret { node: parent, offset: index });
                    }
                    last = Some(EditingCaret { node: parent, offset: index + 1 });
                }
            }
        }
        Some(last.unwrap_or(EditingCaret { node: root, offset: self.get_node(root)?.children.len() }))
    }
}

// ---- [fork] text inputs, for an embedder that dispatches its own events ------------------------------------------

/// What a pointer does to a text input's selection (blitz's own pointer handling, events/pointer.rs, for an embedder
/// whose events do not go through `EventDriver`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextInputPointer {
    /// A press: the caret where it landed (Shift: the selection extended there); a double press selects the word, a
    /// third the line.
    Press { clicks: u32, shift: bool },
    /// A drag with the button held: the selection extended to the pointer.
    Drag,
}

impl BaseDocument {
    /// Runs `f` on the text input's editor (a driver over the document's font and layout contexts), then keeps its
    /// caret in view and repaints it. None when `node_id` is no text input (an `<input>` of a text type or a
    /// `<textarea>`, once laid out).
    pub fn edit_text_input<R>(
        &mut self,
        node_id: NodeId,
        f: impl FnOnce(&mut parley::PlainEditorDriver<'_, crate::node::TextBrush>) -> R,
    ) -> Option<R> {
        let node = self.nodes.get_mut(node_id)?;
        let input = node.element_data_mut()?.text_input_data_mut()?;
        let r = {
            let mut font_ctx = self.font_ctx.lock().unwrap();
            let mut driver = input.editor.driver(&mut font_ctx, &mut self.layout_ctx);
            f(&mut driver)
        };
        self.clamp_text_input_scroll(node_id);
        self.nodes[node_id].insert_damage(style::selector_parser::RestyleDamage::REPAINT);
        Some(r)
    }

    /// A checkbox's or radio button's checkedness set (`:checked` restyled, the input repainted), as its activation
    /// sets it. False when `node_id` is no laid-out checkbox or radio input.
    pub fn set_input_checked(&mut self, node_id: NodeId, checked: bool) -> bool {
        let is_checkbox = self.nodes.get(node_id).and_then(|n| n.element_data()).and_then(|e| e.checkbox_input_checked()).is_some();
        if !is_checkbox {
            return false;
        }
        self.snapshot_node_and(node_id, style_dom::ElementState::CHECKED, |node| {
            if let Some(el) = node.element_data_mut() {
                el.set_checkbox_input_checked(checked);
            }
            node.mark_ancestors_dirty();
        });
        // [fork] And restyled regardless: the snapshot above is taken only when a loaded stylesheet depends on
        // `:checked` now, so a state set before the page's sheets arrived (a saved setting) was never matched, and
        // the box showed unchecked until toggled.
        self.nodes[node_id].set_restyle_hint(style::invalidation::element::restyle_hints::RestyleHint::restyle_subtree());
        self.nodes[node_id].insert_damage(style::selector_parser::RestyleDamage::REPAINT);
        true
    }

    /// A pointer at viewport CSS px (x, y) placing a text input's selection, as blitz's own pointer handling does
    /// (the point in the input's content box, its text scrolled and a single line centred). False when `node_id` is
    /// no laid-out text input.
    pub fn text_input_pointer(&mut self, node_id: NodeId, x: f64, y: f64, action: TextInputPointer) -> bool {
        let Some(rect) = self.transformed_client_rect(node_id) else { return false };
        let scale = self.viewport.scale_f64();
        let Some(node) = self.nodes.get(node_id) else { return false };
        let layout = *node.final_layout();
        let Some(input) = node.element_data().and_then(|e| e.text_input_data()) else { return false };
        // The point in the border box's own CSS px (a scaled ancestor's transform undone along the axes).
        let sx = if rect.width > 0.0 { f64::from(layout.size.width) / rect.width } else { 1.0 };
        let sy = if rect.height > 0.0 { f64::from(layout.size.height) / rect.height } else { 1.0 };
        let (lx, ly) = ((x - rect.x) * sx, (y - rect.y) * sy);
        let mut top = f64::from(layout.padding.top + layout.border.top);
        if !input.is_multiline {
            if let Some(text) = input.editor.try_layout() {
                let content_h = layout.content_box_height();
                top += f64::from(((content_h - text.height() / text.scale()) / 2.0).max(0.0));
            }
        }
        let left = f64::from(layout.padding.left + layout.border.left) + node.text_input_h_align_offset();
        let scroll = f64::from(input.scroll_offset) * scale;
        let (scroll_x, scroll_y) = if input.is_multiline { (0.0, scroll) } else { (scroll, 0.0) };
        let tx = ((lx - left) * scale + scroll_x) as f32;
        let ty = ((ly - top) * scale + scroll_y) as f32;
        self.edit_text_input(node_id, |driver| match action {
            TextInputPointer::Press { clicks: 1, shift: true } => driver.shift_click_extension(tx, ty),
            TextInputPointer::Press { clicks: 1 | 0, .. } => driver.move_to_point(tx, ty),
            TextInputPointer::Press { clicks: 2, .. } => driver.select_word_at_point(tx, ty),
            TextInputPointer::Press { .. } => driver.select_hard_line_at_point(tx, ty),
            TextInputPointer::Drag => driver.extend_selection_to_point(tx, ty),
        })
        .is_some()
    }
}
