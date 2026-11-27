//! [fork] Paint damage: the regions of the window a frame changed, so a host can
//! repaint and upload only those instead of the whole frame (browsers do the same; a
//! static frame then costs nothing and a text change a small patch).
//!
//! Each resolve notes the elements carrying damage of their own (a restyle, a repaint-only
//! style change, changed text, a scroll), before that damage spreads up the tree
//! (`propagate_damage_flags`). When the host takes the damage (once per paint, however many
//! resolves the frame's forced layouts ran), every element's screen rectangle (its border box
//! grown by what it paints outside it: shadows, outlines, filters; through its transforms and
//! the scroll offsets above it, in device pixels) is measured and compared with the record
//! of the last paint. The damage is the union of the old and new rectangles of every element
//! that moved, resized, appeared, disappeared or carries damage of its own. A new viewport or
//! a viewport scroll makes the whole window damaged, as does the first frame.

use blitz_traits::node_id::NodeId;
use kurbo::{Affine, Rect};

use crate::BaseDocument;

/// What a host must repaint since it last took the damage.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum PaintDamage {
    /// Nothing changed.
    #[default]
    None,
    /// The whole window.
    Full,
    /// These regions, in device pixels (unioned where they overlap, at most a few).
    Regions(Vec<Rect>),
}

impl PaintDamage {
    fn add(&mut self, rect: Rect) {
        if rect.is_zero_area() || !rect.is_finite() {
            return;
        }
        match self {
            PaintDamage::Full => {}
            PaintDamage::None => *self = PaintDamage::Regions(vec![rect]),
            PaintDamage::Regions(list) => list.push(rect),
        }
    }

    /// Clip to the viewport, round out to whole pixels, merge overlapping regions and keep at
    /// most `MAX_REGIONS` (the two whose union grows least are merged first); a region set
    /// covering most of the window becomes `Full`.
    fn normalize(&mut self, width: f64, height: f64) {
        const MAX_REGIONS: usize = 6;
        let PaintDamage::Regions(list) = self else { return };
        let window = Rect::new(0.0, 0.0, width, height);
        let mut rects: Vec<Rect> = list
            .iter()
            .map(|r| r.intersect(window))
            .filter(|r| r.width() > 0.0 && r.height() > 0.0)
            .map(|r| Rect::new(r.x0.floor(), r.y0.floor(), r.x1.ceil(), r.y1.ceil()))
            .collect();
        loop {
            let mut merged = false;
            'outer: for i in 0..rects.len() {
                for j in i + 1..rects.len() {
                    if rects[i].overlaps(rects[j]) || rects[i].contains_rect(rects[j]) || rects[j].contains_rect(rects[i]) {
                        rects[i] = rects[i].union(rects[j]);
                        rects.swap_remove(j);
                        merged = true;
                        break 'outer;
                    }
                }
            }
            if !merged {
                break;
            }
        }
        while rects.len() > MAX_REGIONS {
            let (mut best, mut cost) = ((0, 1), f64::INFINITY);
            for i in 0..rects.len() {
                for j in i + 1..rects.len() {
                    let grow = rects[i].union(rects[j]).area() - rects[i].area() - rects[j].area();
                    if grow < cost {
                        (best, cost) = ((i, j), grow);
                    }
                }
            }
            rects[best.0] = rects[best.0].union(rects[best.1]);
            rects.swap_remove(best.1);
        }
        let area: f64 = rects.iter().map(|r| r.area()).sum();
        *self = if rects.is_empty() {
            PaintDamage::None
        } else if area > window.area() * 0.6 {
            PaintDamage::Full
        } else {
            PaintDamage::Regions(rects)
        };
    }
}

/// A node's slot in the tree's storage (NodeId's low 32 bits): the index of its entries in
/// the per-node vectors below, which also hold the id (a reused slot is another node).
#[inline]
fn slot(id: NodeId) -> usize {
    id.as_u64() as u32 as usize
}

/// Per-node entries by slot: the value for `id`, if its slot holds `id`'s.
#[inline]
fn lookup<T: Copy>(v: &[Option<(NodeId, T)>], id: NodeId) -> Option<T> {
    match v.get(slot(id)) {
        Some(Some((at, value))) if *at == id => Some(*value),
        _ => None,
    }
}

#[inline]
fn store<T>(v: &mut Vec<Option<(NodeId, T)>>, id: NodeId, value: T) {
    let at = slot(id);
    if v.len() <= at {
        v.resize_with(at + 1, || None);
    }
    v[at] = Some((id, value));
}

/// The per-document state (part of [`BaseDocument`]).
#[derive(Default)]
pub(crate) struct PaintDamageState {
    /// Each element's screen rectangle as last painted, by slot.
    rects: Vec<Option<(NodeId, Rect)>>,
    /// The record being measured (swapped with `rects`; kept for its allocation).
    next: Vec<Option<(NodeId, Rect)>>,
    /// Whether `rects` holds a record (none before the first measurement).
    measured: bool,
    /// The pass's memo: each element's transform to the window, by slot.
    affines: Vec<Option<(NodeId, Affine)>>,
    /// The pass's memo: how far (device px) its ancestors' filters spread an element's pixels, by slot.
    reach: Vec<Option<(NodeId, f64)>>,
    /// Elements damaged by their own changes since the last measurement, by slot (a bit each), and listed.
    own_bits: Vec<u64>,
    own: Vec<NodeId>,
    /// The viewport (size, scale, scroll) the record was measured in.
    viewport: Option<(u32, u32, u64, u64, u64)>,
    /// Damage accumulated since the host last took it.
    pending: PaintDamage,
    /// Whether to track it at all (a host opts in with `track_paint_damage`).
    pub(crate) enabled: bool,
}

impl PaintDamageState {
    /// `id` carries damage of its own (`propagate_damage_flags`, during a resolve).
    #[inline]
    pub(crate) fn note_own(&mut self, id: NodeId) {
        if !self.enabled {
            return;
        }
        let at = slot(id);
        let (word, bit) = (at / 64, 1u64 << (at % 64));
        if self.own_bits.len() <= word {
            self.own_bits.resize(word + 1, 0);
        }
        if self.own_bits[word] & bit == 0 {
            self.own_bits[word] |= bit;
            self.own.push(id);
        }
    }

    #[inline]
    fn is_own(&self, id: NodeId) -> bool {
        let at = slot(id);
        self.own_bits.get(at / 64).is_some_and(|w| w & (1u64 << (at % 64)) != 0)
    }

    fn clear_own(&mut self) {
        for id in self.own.drain(..) {
            let at = slot(id);
            if let Some(w) = self.own_bits.get_mut(at / 64) {
                *w = 0;
            }
        }
    }
}

impl BaseDocument {
    /// Start (or stop) recording paint damage; the next paint repaints the whole window.
    pub fn track_paint_damage(&mut self, enabled: bool) {
        let state = &mut self.paint_damage;
        state.enabled = enabled;
        state.rects.clear();
        state.measured = false;
        state.clear_own();
        state.viewport = None;
        state.pending = if enabled { PaintDamage::Full } else { PaintDamage::None };
    }

    /// The damage since the last call (what to repaint now), cleared. The document must be
    /// resolved (a host resolves, then takes the damage, then paints it).
    pub fn take_paint_damage(&mut self) -> PaintDamage {
        if !self.paint_damage.enabled {
            return PaintDamage::Full;
        }
        self.measure_paint_damage();
        std::mem::take(&mut self.paint_damage.pending)
    }

    /// Mark the whole window damaged (a host changed something the document cannot see).
    pub fn damage_everything(&mut self) {
        self.paint_damage.pending = PaintDamage::Full;
    }

    /// Compare every element's screen rectangle with the last paint's and add what changed
    /// to the pending damage. Measures nothing when no element carries damage of its own and
    /// the viewport is the same (nothing on screen can have moved).
    pub(crate) fn measure_paint_damage(&mut self) {
        if !self.paint_damage.enabled {
            return;
        }
        let scale = self.viewport.scale_f64();
        let (vw, vh) = self.viewport.window_size;
        let scroll = self.viewport_scroll();
        let viewport = (vw, vh, scale.to_bits(), scroll.x.to_bits(), scroll.y.to_bits());
        let viewport_changed = self.paint_damage.viewport != Some(viewport);
        if self.paint_damage.own.is_empty() && !viewport_changed && self.paint_damage.measured {
            return;
        }
        if self.try_root_element().is_none() {
            return;
        }
        // A `::before`/`::after` (an anonymous node) damaged by its own change, such as its background image
        // arriving, is measured as its element: the pass below measures elements only, so a pseudo-element's own
        // damage repainted nothing (static plates drawn on `::before` never appeared on a phone).
        let anonymous: Vec<NodeId> = self.paint_damage.own.iter().copied().filter(|id| self.nodes.get(*id).is_some_and(|n| !n.is_element())).collect();
        for id in anonymous {
            let mut at = self.nodes[id].parent;
            while let Some(p) = at {
                if self.nodes[p].is_element() {
                    self.paint_damage.note_own(p);
                    break;
                }
                at = self.nodes[p].parent;
            }
        }

        let mut next = std::mem::take(&mut self.paint_damage.next);
        let mut affines = std::mem::take(&mut self.paint_damage.affines);
        let mut reach = std::mem::take(&mut self.paint_damage.reach);
        next.clear();
        affines.clear();
        reach.clear();
        let trace = std::env::var_os("BLITZ_DAMAGE_TRACE").is_some();
        // BLITZ_LEGACY_RESOLVE=1: a filtered element with damage of its own makes the whole window damaged, as before
        // filters had a reach.
        let legacy = crate::util::legacy_resolve();
        let unbounded = legacy
            && self.paint_damage.own.iter().any(|id| self.nodes.get(*id).and_then(|n| n.primary_styles()).is_some_and(|s| !s.get_effects().filter.0.is_empty()));
        let whole = viewport_changed || !self.paint_damage.measured || unbounded;
        let mut damage = if whole { PaintDamage::Full } else { std::mem::take(&mut self.paint_damage.pending) };

        for (id, node) in self.nodes.iter() {
            if !node.is_element() || !node.flags.is_in_document() {
                continue;
            }
            let affine = self.screen_affine(id, scale, scroll, &mut affines);
            let inherited = self.inherited_filter_reach(id, scale, scroll, &mut affines, &mut reach);
            let size = node.final_layout().size;
            let outset = (ink_outset(node) + filter_reach(node)) * scale;
            let local = Rect::new(0.0, 0.0, size.width as f64 * scale, size.height as f64 * scale).inflate(outset, outset);
            let new = affine.transform_rect_bbox(local).inflate(inherited, inherited);
            store(&mut next, id, new);
            if whole {
                continue;
            }
            match lookup(&self.paint_damage.rects, id) {
                None => damage.add(new),
                Some(old) if old != new => {
                    // BLITZ_DAMAGE_TRACE: an element that moved or resized (both rectangles damaged).
                    if trace {
                        eprintln!("damage moved: {id:?} {} {old:?} -> {new:?}", element_name(node));
                    }
                    damage.add(old);
                    damage.add(new);
                }
                Some(old) if self.paint_damage.is_own(id) => {
                    if trace {
                        eprintln!("damage: {id:?} {} rect {new:?}", element_name(node));
                    }
                    damage.add(old.union(new));
                }
                Some(_) => {}
            }
        }
        if !whole {
            // Gone since the last paint.
            for (id, old) in self.paint_damage.rects.iter().flatten() {
                if lookup(&next, *id).is_none() {
                    damage.add(*old);
                }
            }
            damage.normalize(vw as f64, vh as f64);
        }
        if trace {
            eprintln!(
                "damage: viewport changed {viewport_changed}, first {}, {} own, {damage:?}",
                !self.paint_damage.measured,
                self.paint_damage.own.len()
            );
        }

        let state = &mut self.paint_damage;
        state.pending = damage;
        state.next = std::mem::replace(&mut state.rects, next);
        state.affines = affines;
        state.reach = reach;
        state.measured = true;
        state.viewport = Some(viewport);
        state.clear_own();
    }

    /// [fork] Damage the element's last painted rectangle (a change the resolve does not see: an editing caret
    /// moved inside it). Nothing before the first frame records it (that frame is whole anyway).
    pub(crate) fn damage_element(&mut self, id: NodeId) {
        if !self.paint_damage.enabled {
            return;
        }
        if let Some(rect) = lookup(&self.paint_damage.rects, id) {
            let (vw, vh) = self.viewport.window_size;
            self.paint_damage.pending.add(rect);
            self.paint_damage.pending.normalize(vw as f64, vh as f64);
        }
    }

    /// The transform from `id`'s border-box coordinates (device pixels) to the window's, as
    /// blitz-paint draws it: its containing block's, less that block's scroll, then its own
    /// offset and transform. Memoised in `memo` for the pass.
    fn screen_affine(&self, id: NodeId, scale: f64, scroll: crate::Point<f64>, memo: &mut Vec<Option<(NodeId, Affine)>>) -> Affine {
        if let Some(a) = lookup(memo, id) {
            return a;
        }
        let node = &self.nodes[id];
        let parent = match node.containing_block() {
            Some(cb) if self.nodes.contains_key(cb) => {
                let cb_affine = self.screen_affine(cb, scale, scroll, memo);
                let s = self.nodes[cb].scroll_offset();
                cb_affine * Affine::translate((-s.x * scale, -s.y * scale))
            }
            _ => Affine::translate((-scroll.x * scale, -scroll.y * scale)),
        };
        let location = node.final_layout().location;
        let mut affine = parent * Affine::translate((location.x as f64 * scale, location.y as f64 * scale));
        if let Some(t) = node.transform().as_deref() {
            affine *= *t;
        }
        store(memo, id, affine);
        affine
    }

    /// How far (device px) the filters of `id`'s ancestors spread its pixels: a blurred or
    /// drop-shadowed element's whole subtree is drawn into its filter's layer, so a change
    /// to a descendant changes the pixels around it that far out. Memoised for the pass.
    fn inherited_filter_reach(
        &self,
        id: NodeId,
        scale: f64,
        scroll: crate::Point<f64>,
        affines: &mut Vec<Option<(NodeId, Affine)>>,
        memo: &mut Vec<Option<(NodeId, f64)>>,
    ) -> f64 {
        if let Some(r) = lookup(memo, id) {
            return r;
        }
        let reach = match self.nodes[id].parent {
            Some(parent) if self.nodes.get(parent).is_some_and(|p| p.is_element()) => {
                let own = filter_reach(&self.nodes[parent]);
                let own = if own > 0.0 {
                    // In the filtered element's space: through its transform's scale.
                    let a = self.screen_affine(parent, scale, scroll, affines).as_coeffs();
                    own * scale * a[0].hypot(a[1]).max(a[2].hypot(a[3]))
                } else {
                    0.0
                };
                own + self.inherited_filter_reach(parent, scale, scroll, affines, memo)
            }
            _ => 0.0,
        };
        store(memo, id, reach);
        reach
    }
}

/// BLITZ_DAMAGE_TRACE's name for an element.
fn element_name(node: &crate::Node) -> String {
    node.element_data()
        .map(|e| format!("<{} id={:?} class={:?}>", e.name.local, e.id.as_ref().map(|a| a.to_string()), e.attr(crate::local_name!("class"))))
        .unwrap_or_default()
}

/// How far (CSS px) an element paints outside its border box: its box shadows, outline and
/// text shadows, plus a pixel for antialiasing. Its filter's reach is [`filter_reach`].
pub fn ink_outset(node: &crate::Node) -> f64 {
    let Some(style) = node.primary_styles() else { return 1.0 };
    let mut outset: f64 = 1.0;
    for shadow in style.get_effects().box_shadow.0.iter() {
        let reach = shadow.base.horizontal.px().abs().max(shadow.base.vertical.px().abs()) + shadow.base.blur.px() + shadow.spread.px().max(0.0);
        outset = outset.max(reach as f64 + 1.0);
    }
    for shadow in style.get_inherited_text().text_shadow.0.iter() {
        let reach = shadow.horizontal.px().abs().max(shadow.vertical.px().abs()) + shadow.blur.px();
        outset = outset.max(reach as f64 + 1.0);
    }
    let outline = style.get_outline();
    if !outline.outline_style.none_or_hidden() {
        let reach = outline.outline_width.0.to_f32_px() + outline.outline_offset.to_f32_px().max(0.0);
        outset = outset.max(reach as f64 + 1.0);
    }
    outset
}

/// How far (CSS px) an element's `filter` spreads the pixels drawn into it (its own and its
/// subtree's): a blur three standard deviations, a drop shadow three of its blur plus its
/// offset; colour filters (brightness, opacity, ...) none; a chain the sum. A `url()` filter is
/// not drawn (blitz-paint filters.rs), so it spreads nothing either.
pub fn filter_reach(node: &crate::Node) -> f64 {
    use style::computed_values::filter::single_value::T as Filter;
    let Some(style) = node.primary_styles() else { return 0.0 };
    let filters = &style.get_effects().filter.0;
    if filters.is_empty() {
        return 0.0;
    }
    let mut reach = 0.0f64;
    for filter in filters.iter() {
        match filter {
            Filter::Blur(sigma) => reach += 3.0 * sigma.px() as f64,
            Filter::DropShadow(shadow) => {
                reach += 3.0 * shadow.blur.px() as f64 + shadow.horizontal.px().abs().max(shadow.vertical.px().abs()) as f64;
            }
            _ => {}
        }
    }
    reach
}
