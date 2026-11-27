//! Spike: an app's UI as a Rust document instead of a webview. Blitz
//! (DioxusLabs) gives a DOM (`blitz-dom`) with Firefox's Stylo for CSS, Taffy
//! for layout and Parley for text; `blitz-paint` paints it through AnyRender,
//! here the CPU backend (vello_cpu) into an RGBA buffer the host uploads to
//! Dawn.
//!
//! `UiDocument` owns one document for headless rendering (`blitz_render`).

#[cfg(feature = "gpu-vello")]
pub mod gpu_filter;
#[cfg(feature = "gpu-vello")]
pub mod gpu_paint;

use std::sync::Arc;
use std::time::Instant;

use anyrender::{ImageRenderer, render_to_buffer};
pub use anyrender_vello_cpu::VelloCpuImageRenderer;
use blitz_dom::{DocumentConfig, LocalName, NodeId, QualName, local_name, ns};

fn nid(n: u64) -> NodeId {
    NodeId::from_u64(n)
}
use blitz_html::HtmlDocument;
use blitz_net::Provider;
use blitz_paint::{paint_scene, paint_scene_region};
pub use blitz_dom::PaintDamage;
use blitz_traits::shell::{ColorScheme, Viewport};

pub struct UiDocument {
    doc: HtmlDocument,
    net: Arc<Provider>,
    _runtime: tokio::runtime::Runtime,
    width: u32,
    height: u32,
    scale: f32,
    started: Instant,
    /// The frame clock (seconds) resolves and paints use while set, as a window's frame samples its document clock
    /// once ([`Self::set_frame_clock`]); the clock now while None.
    frame_clock: Option<f64>,
    /// Set by every mutation: the next `render` repaints.
    pub dirty: bool,
}

/// Timings of the last render, in milliseconds.
#[derive(Clone, Copy, Debug, Default)]
pub struct RenderTimes {
    pub resolve_ms: f64,
    pub paint_ms: f64,
}

impl UiDocument {
    /// A document from `html` (its head carries the CSS), files resolved
    /// against `base_url`, laid out for `width` x `height` CSS pixels at `scale`.
    pub fn new(html: &str, base_url: &str, width: u32, height: u32, scale: f32) -> UiDocument {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime for blitz-net");
        let net = {
            let _guard = runtime.enter();
            Arc::new(Provider::new(None))
        };
        let doc = {
            let _guard = runtime.enter();
            HtmlDocument::from_html(
                html,
                DocumentConfig {
                    base_url: Some(base_url.to_string()),
                    net_provider: Some(net.clone() as _),
                    viewport: Some(Viewport::new((width as f32 * scale) as u32, (height as f32 * scale) as u32, scale, ColorScheme::Dark)),
                    ..Default::default()
                },
            )
        };
        let mut ui = UiDocument { doc, net, _runtime: runtime, width, height, scale, started: Instant::now(), frame_clock: None, dirty: true };
        ui.settle_resources();
        ui
    }

    /// Resolve until fonts and images have arrived (bounded).
    pub fn settle_resources(&mut self) {
        let _guard = self._runtime.enter();
        for _ in 0..2000 {
            let now = self.started.elapsed().as_secs_f64();
            self.doc.resolve(now);
            if self.net.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    fn now(&self) -> f64 {
        self.frame_clock.unwrap_or_else(|| self.started.elapsed().as_secs_f64())
    }

    /// The seconds since the document was made (the clock now, whatever the frame clock).
    pub fn wall_clock(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    /// Resolves and paints run at `clock` (seconds on [`Self::wall_clock`]) until it is set again; None: at the clock
    /// now, each time.
    pub fn set_frame_clock(&mut self, clock: Option<f64>) {
        self.frame_clock = clock;
    }

    pub fn size(&self) -> (u32, u32) {
        ((self.width as f32 * self.scale) as u32, (self.height as f32 * self.scale) as u32)
    }

    /// Style, layout and paint into RGBA8 (premultiplied as vello_cpu writes it).
    pub fn render(&mut self) -> (Vec<u8>, RenderTimes) {
        let _guard = self._runtime.enter();
        let t0 = Instant::now();
        let now = self.now();
        self.doc.resolve(now);
        let resolve_ms = t0.elapsed().as_secs_f64() * 1e3;
        let (w, h) = self.size();
        let scale = self.scale as f64;
        let t1 = Instant::now();
        let doc = &mut self.doc;
        let buffer = render_to_buffer::<VelloCpuImageRenderer, _>(|scene| paint_scene(scene, doc, scale, w, h, 0, 0), w, h);
        self.dirty = false;
        (buffer, RenderTimes { resolve_ms, paint_ms: t1.elapsed().as_secs_f64() * 1e3 })
    }

    /// Track paint damage from now on (blitz-dom `track_paint_damage`) for
    /// [`UiDocument::render_damage_with`].
    pub fn track_paint_damage(&mut self) {
        self.doc.track_paint_damage(true);
    }

    /// One frame repainting only what changed into `frame` ([`paint_damage_with`]).
    pub fn render_damage_with<R: ImageRenderer>(&mut self, renderer: &mut R, frame: &mut Vec<u8>, scratch: &mut Vec<u8>) -> (PaintDamage, PaintProfile) {
        let _guard = self._runtime.enter();
        let now = self.now();
        let (w, h) = self.size();
        self.dirty = false;
        paint_damage_with(renderer, &mut self.doc, frame, w, h, self.scale, now, scratch)
    }

    /// One frame through `renderer` (any anyrender backend, sized to [`UiDocument::size`]).
    /// Paint what changed on the GPU (gpu_paint) into `target`; `full` paints it all.
    #[cfg(feature = "gpu-vello")]
    pub fn render_gpu(&mut self, painter: &mut gpu_paint::GpuUiPainter, target: &vello::wgpu::Texture, full: bool) -> (PaintDamage, PaintProfile) {
        let _guard = self._runtime.enter();
        let now = self.now();
        self.dirty = false;
        painter.paint_damage(&mut self.doc, target, self.scale, now, full)
    }

    pub fn render_with<R: ImageRenderer>(&mut self, renderer: &mut R, buf: &mut Vec<u8>) -> PaintProfile {
        let _guard = self._runtime.enter();
        let now = self.now();
        let (w, h) = self.size();
        self.dirty = false;
        paint_with(renderer, &mut self.doc, w, h, self.scale, now, buf)
    }

    /// One frame (resolve, then paint) with the time each stage took ([`PaintProfile`]).
    pub fn render_profiled(&mut self) -> (Vec<u8>, PaintProfile) {
        let _guard = self._runtime.enter();
        let now = self.now();
        let (w, h) = self.size();
        self.dirty = false;
        paint_document_profiled(&mut self.doc, w, h, self.scale, now)
    }

    /// The runtime its loads run on: a caller that mutates outside `render` (a mutation can
    /// start an image load) enters it.
    pub fn runtime(&self) -> tokio::runtime::Handle {
        self._runtime.handle().clone()
    }

    /// Restyle and relay out everything on the next render (blitz-dom's
    /// invalidate_everything): the reference for an incremental render.
    pub fn invalidate_everything(&mut self) {
        self.doc.invalidate_everything();
        self.dirty = true;
    }

    /// [`paint_region_with`] on this document (resolved as it stands).
    pub fn render_region_with<R: ImageRenderer>(&mut self, renderer: &mut R, region: kurbo::Rect, out: &mut Vec<u8>) {
        let _guard = self._runtime.enter();
        paint_region_with(renderer, &mut self.doc, self.scale, region, out);
    }

    /// The document, to read (node ids for a workload to mutate).
    pub fn document(&self) -> &blitz_dom::BaseDocument {
        &self.doc
    }

    /// The pointer moved to CSS-pixel (x, y) (blitz-dom `set_hover_to`): `:hover` follows it.
    pub fn hover_at(&mut self, x: f32, y: f32) {
        self.dirty = true;
        self.doc.set_hover_to(x, y);
    }

    /// The user scrolled `id` by (dx, dy) CSS px of content movement (blitz-dom `scroll_node_by`).
    pub fn scroll_node(&mut self, id: u64, dx: f64, dy: f64) {
        self.dirty = true;
        self.doc.scroll_node_by(nid(id), dx, dy, |_| {});
    }

    /// A forced layout at `now` on the document's clock (a script's offsetWidth): the document resolved, then `node`'s
    /// border box width read (0 for no node).
    pub fn forced_layout(&mut self, now: f64, node: u64) -> f32 {
        let _guard = self._runtime.enter();
        self.doc.resolve(now);
        self.doc.get_node(nid(node)).map_or(0.0, |n| n.final_layout().size.width)
    }

    /// The topmost element at CSS-pixel (x, y), as `document.elementFromPoint`.
    pub fn element_at(&mut self, x: f32, y: f32) -> Option<u64> {
        let now = self.now();
        self.doc.resolve(now);
        self.doc.element_from_point(x, y).map(NodeId::as_u64)
    }

    pub fn by_id(&self, id: &str) -> Option<u64> {
        self.doc.get_element_by_id(id).map(NodeId::as_u64)
    }

    // ---- mutations (each through blitz-dom's DocumentMutator) -------------

    pub fn create_element(&mut self, tag: &str) -> u64 {
        self.dirty = true;
        let name = QualName::new(None, ns!(html), LocalName::from(tag));
        self.doc.mutate().create_element(name, Vec::new()).as_u64()
    }
    pub fn create_text(&mut self, text: &str) -> u64 {
        self.dirty = true;
        self.doc.mutate().create_text_node(text).as_u64()
    }
    pub fn create_comment(&mut self, text: &str) -> u64 {
        self.dirty = true;
        self.doc.mutate().create_comment_node(text).as_u64()
    }
    pub fn set_attribute(&mut self, id: u64, name: &str, value: &str) {
        self.dirty = true;
        self.doc.mutate().set_attribute(nid(id), QualName::new(None, ns!(), LocalName::from(name)), value);
    }
    pub fn remove_attribute(&mut self, id: u64, name: &str) {
        self.dirty = true;
        self.doc.mutate().clear_attribute(nid(id), QualName::new(None, ns!(), LocalName::from(name)));
    }
    pub fn set_style(&mut self, id: u64, prop: &str, value: &str) {
        self.dirty = true;
        self.doc.mutate().set_style_property(nid(id), prop, value);
    }
    pub fn remove_style(&mut self, id: u64, prop: &str) {
        self.dirty = true;
        self.doc.mutate().remove_style_property(nid(id), prop);
    }
    /// DOM appendChild: an attached child moves.
    pub fn append(&mut self, parent: u64, child: u64) {
        let (parent, child) = (nid(parent), nid(child));
        self.dirty = true;
        let mut m = self.doc.mutate();
        if m.node_has_parent(child) {
            m.remove_node(child);
        }
        m.append_children(parent, &[child]);
    }
    /// DOM insertBefore(child, anchor) on `parent`.
    pub fn insert_before(&mut self, _parent: u64, child: u64, anchor: u64) {
        let (child, anchor) = (nid(child), nid(anchor));
        self.dirty = true;
        let mut m = self.doc.mutate();
        if m.node_has_parent(child) {
            m.remove_node(child);
        }
        m.insert_nodes_before(anchor, &[child]);
    }
    pub fn remove(&mut self, child: u64) {
        self.dirty = true;
        self.doc.mutate().remove_node(nid(child));
    }
    pub fn set_text(&mut self, id: u64, text: &str) {
        self.dirty = true;
        self.doc.mutate().set_node_text(nid(id), text);
    }
}

// Silences an unused-import warning on the local_name macro re-export.
#[allow(unused_imports)]
use local_name as _;

/// Style, layout and paint any blitz document into premultiplied RGBA8 of
/// `width` x `height` device pixels (a document a host other than this
/// crate owns, such as a wasm runtime's).
pub fn paint_document(doc: &mut blitz_dom::BaseDocument, width: u32, height: u32, scale: f32, now: f64) -> Vec<u8> {
    paint_document_profiled(doc, width, height, scale, now).0
}

/// Where one paint's time went, in ms: Blitz's resolve (style, layout, paint tree; the
/// blitz-dom `log-phase-times` feature splits it further), making the vello_cpu renderer
/// (one per paint, as anyrender's render_to_buffer does), recording the scene
/// (blitz-paint's commands) and rasterizing it (vello_cpu's flush and render).
#[derive(Clone, Copy, Debug, Default)]
pub struct PaintProfile {
    pub resolve_ms: f64,
    pub renderer_ms: f64,
    pub scene_ms: f64,
    pub raster_ms: f64,
    /// The GPU finishing the paint, where a host measures it (blitz-profile's `vello-direct`).
    pub gpu_ms: f64,
}

/// [`paint_document`] with the time each stage took.
pub fn paint_document_profiled(doc: &mut blitz_dom::BaseDocument, width: u32, height: u32, scale: f32, now: f64) -> (Vec<u8>, PaintProfile) {
    let t = Instant::now();
    let mut renderer = VelloCpuImageRenderer::new(width, height);
    let mut buf = Vec::with_capacity((width * height * 4) as usize);
    let renderer_ms = t.elapsed().as_secs_f64() * 1e3;
    let profile = paint_with(&mut renderer, doc, width, height, scale, now, &mut buf);
    (buf, PaintProfile { renderer_ms, ..profile })
}

/// A vello_cpu renderer for `width` x `height` (for hosts without anyrender in scope).
pub fn new_renderer(width: u32, height: u32) -> VelloCpuImageRenderer {
    VelloCpuImageRenderer::new(width, height)
}

/// One frame of `doc` repainting only what changed: `frame` (`width` x `height` RGBA8, the
/// last frame) gets the regions the resolve damaged (blitz-dom paint damage; the document
/// must track it, `track_paint_damage`) repainted in place, each through `renderer` resized
/// to the region. Answers the damage painted and the time each stage took (scene and
/// raster summed over the regions).
pub fn paint_damage_with<R: ImageRenderer>(renderer: &mut R, doc: &mut blitz_dom::BaseDocument, frame: &mut Vec<u8>, width: u32, height: u32, scale: f32, now: f64, scratch: &mut Vec<u8>) -> (PaintDamage, PaintProfile) {
    let ms = |t: Instant| t.elapsed().as_secs_f64() * 1e3;
    let t = Instant::now();
    doc.resolve(now);
    let resolve_ms = ms(t);
    let mut damage = doc.take_paint_damage();
    if frame.len() != (width * height * 4) as usize {
        damage = PaintDamage::Full;
    }
    let mut profile = PaintProfile { resolve_ms, ..Default::default() };
    let regions: Vec<kurbo::Rect> = match &damage {
        PaintDamage::None => return (damage, profile),
        PaintDamage::Full => vec![kurbo::Rect::new(0.0, 0.0, width as f64, height as f64)],
        PaintDamage::Regions(list) => list.clone(),
    };
    frame.resize((width * height * 4) as usize, 0);
    for region in regions {
        let (x, y, w, h) = (region.x0 as u32, region.y0 as u32, region.width() as u32, region.height() as u32);
        if w == 0 || h == 0 {
            continue;
        }
        renderer.resize(w, h);
        renderer.reset();
        scratch.clear();
        let mut scene_ms = 0.0;
        let t = Instant::now();
        renderer.render_to_vec(
            |scene| {
                let t = Instant::now();
                paint_scene_region(scene, doc, scale as f64, region);
                scene_ms = ms(t);
            },
            scratch,
        );
        profile.raster_ms += ms(t) - scene_ms;
        profile.scene_ms += scene_ms;
        let row = (w * 4) as usize;
        for r in 0..h as usize {
            let at = ((y as usize + r) * width as usize + x as usize) * 4;
            frame[at..at + row].copy_from_slice(&scratch[r * row..(r + 1) * row]);
        }
    }
    (damage, profile)
}

/// Paint `region` alone (as [`paint_damage_with`] does) into `out` (region-sized RGBA8).
pub fn paint_region_with<R: ImageRenderer>(renderer: &mut R, doc: &mut blitz_dom::BaseDocument, scale: f32, region: kurbo::Rect, out: &mut Vec<u8>) {
    renderer.resize(region.width() as u32, region.height() as u32);
    renderer.reset();
    out.clear();
    renderer.render_to_vec(|scene| paint_scene_region(scene, doc, scale as f64, region), out);
}

/// One frame of `doc` into `buf` through any anyrender backend `renderer` (sized
/// `width` x `height` by the caller), with the time each stage took (no renderer creation).
pub fn paint_with<R: ImageRenderer>(renderer: &mut R, doc: &mut blitz_dom::BaseDocument, width: u32, height: u32, scale: f32, now: f64, buf: &mut Vec<u8>) -> PaintProfile {
    let ms = |t: Instant| t.elapsed().as_secs_f64() * 1e3;
    let t = Instant::now();
    doc.resolve(now);
    let resolve_ms = ms(t);
    let renderer_ms = 0.0;
    // A renderer kept across frames keeps its scene until reset: each frame starts empty.
    renderer.reset();
    buf.clear();
    let mut scene_ms = 0.0;
    let t = Instant::now();
    renderer.render_to_vec(
        |scene| {
            let t = Instant::now();
            paint_scene(scene, doc, scale as f64, width, height, 0, 0);
            scene_ms = ms(t);
        },
        buf,
    );
    let raster_ms = ms(t) - scene_ms;
    PaintProfile { resolve_ms, renderer_ms, scene_ms, raster_ms, gpu_ms: 0.0 }
}
