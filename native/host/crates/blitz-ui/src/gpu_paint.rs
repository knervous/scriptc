//! The UI drawn on the GPU: blitz-paint records into a Vello scene and Vello renders it on
//! the host's own wgpu device straight into the texture the host composites, so no pixel
//! comes back to the CPU and nothing is uploaded. Paint damage still applies: a frame
//! repaints only the regions its resolve damaged, each rendered into a scratch texture and
//! copied into place (Vello renders whole targets, so a region needs its own).
//!
//! Vello writes straight (unpremultiplied) alpha into `Rgba8Unorm` storage textures; the
//! host blends the target as straight alpha, unlike vello_cpu's premultiplied buffers.

use std::sync::Arc;
use std::time::Instant;

use anyrender::{Filter, NormalizedCoord, Paint, PaintRef, PaintScene, RenderContext};
use anyrender_vello::VelloScenePainter;
use kurbo::{Affine, Rect, Shape, Stroke};
use vello::peniko::{BlendMode, Color, Fill, FontData, ImageBrush, StyleRef};
use blitz_paint::paint_scene_region;
use vello::wgpu;

use crate::gpu_filter::{self, FilterPasses, Job, Recording};
use crate::{PaintDamage, PaintProfile};

/// The format Vello renders into (and so the format of the host's target).
pub const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
/// The usages the host's target needs: Vello stores into it, regions are copied into it.
pub const TARGET_USAGE: wgpu::TextureUsages = wgpu::TextureUsages::STORAGE_BINDING.union(wgpu::TextureUsages::COPY_DST);

/// Vello on one device, its scene and the region scratch texture.
pub struct GpuUiPainter {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: vello::Renderer,
    scene: vello::Scene,
    /// Grows to the largest region painted (Vello clips to the render size it is given).
    scratch: Option<(wgpu::Texture, wgpu::TextureView)>,
    /// What the paints recorded (profiling) and what kinds of command they leave out.
    pub census: Census,
    pub skip: Skip,
    /// Vello's antialiasing (VELLO_AA: area, msaa8, msaa16; area by default).
    aa: vello::AaConfig,
    /// VELLO_EMPTY=1: encode no commands (an empty scene), to tell Vello's pipeline from what a page draws.
    empty: bool,
    /// CSS filters' passes (gpu_filter.rs), made at the first paint with a filter. BLITZ_UI_FILTERS=0 draws filtered
    /// layers as if they had none, as before.
    filters: Option<FilterPasses>,
    filters_on: bool,
    /// The placeholder images filtered layers draw as, kept paint to paint (gpu_filter `Placeholders`).
    placeholders: gpu_filter::Placeholders,
}

/// Kinds of paint command a profile can leave out, to see what each costs the GPU.
#[derive(Clone, Copy, Debug, Default)]
pub struct Skip {
    pub images: bool,
    pub text: bool,
    pub shadows: bool,
    /// Layers with opacity, a blend or a filter become plain clips.
    pub layers: bool,
    /// Clip layers are dropped (content then paints unclipped).
    pub clips: bool,
    pub gradients: bool,
}

impl Skip {
    /// From a comma list: images, text, shadows, layers, clips, gradients.
    pub fn parse(list: &str) -> Skip {
        let has = |k: &str| list.split(',').any(|w| w.trim() == k);
        Skip { images: has("images"), text: has("text"), shadows: has("shadows"), layers: has("layers"), clips: has("clips"), gradients: has("gradients") }
    }
}

/// Commands recorded by kind, over every paint since it was last cleared.
#[derive(Clone, Copy, Debug, Default)]
pub struct Census {
    pub fills: u64,
    pub strokes: u64,
    pub gradients: u64,
    /// Image fills and the image pixels they sample (the images' own size).
    pub images: u64,
    pub image_pixels: u64,
    pub glyph_runs: u64,
    pub glyphs: u64,
    pub shadows: u64,
    /// Layers with opacity, a blend or a filter; and plain clip layers.
    pub layers: u64,
    pub clips: u64,
    /// Of `layers`: those at full opacity, normal blend, no filter (a clip in effect).
    pub plain_layers: u64,
}

/// A scene painter that counts what passes through it and leaves out what `skip` names; a layer with a CSS filter is
/// recorded into a scene of its own (gpu_filter.rs) and drawn as the image its job makes.
struct Filtered<'p, P: PaintScene> {
    inner: &'p mut P,
    census: &'p mut Census,
    skip: Skip,
    /// Per pushed layer: where its pop goes.
    pushed: Vec<Pushed>,
    /// Filtered layers being recorded, innermost last: what is drawn goes to the last.
    recording: Vec<Recording>,
    /// Filtered layers recorded whole, for gpu_filter to render before the page's scene.
    jobs: &'p mut Vec<Job>,
    /// The region painted, in its own space (device pixels): a filtered layer is cut to it, less a margin for blur.
    bounds: Rect,
    /// Whether filters are drawn (BLITZ_UI_FILTERS=0: no).
    filters: bool,
    /// The images filtered layers draw as, reused paint to paint (gpu_filter `Placeholders`).
    placeholders: &'p mut gpu_filter::Placeholders,
}

/// Where a pushed layer went, so its pop follows.
#[derive(Clone, Copy)]
enum Pushed {
    /// The page's scene.
    Inner,
    /// The innermost recording's scene.
    Recorded,
    /// Nowhere (skipped).
    Skipped,
    /// It is a recording of its own.
    Filter,
}

/// How far past the painted region a filtered layer keeps its content (device pixels): what a blur or shadow there draws
/// into the region.
const FILTER_MARGIN: f64 = 96.0;

/// Runs `$body` with `$p` the painter what is drawn now goes to: the innermost recording's, else the page's.
macro_rules! target {
    ($self:ident, |$p:ident| $body:expr) => {
        if let Some(rec) = $self.recording.last_mut() {
            #[allow(unused_mut)]
            let mut $p = VelloScenePainter::new(&mut rec.scene);
            $body
        } else {
            let $p = &mut *$self.inner;
            $body
        }
    };
}

impl<P: PaintScene> RenderContext for Filtered<'_, P> {}

impl<P: PaintScene> PaintScene for Filtered<'_, P> {
    fn reset(&mut self) {
        self.inner.reset();
    }

    fn push_layer(&mut self, fill: Fill, blend: impl Into<BlendMode>, alpha: f32, transform: Affine, clip: &impl Shape, filter: Option<Arc<Filter>>, backdrop_filter: Option<Arc<Filter>>) {
        self.census.layers += 1;
        let blend = blend.into();
        if alpha >= 1.0 && blend == BlendMode::default() && filter.is_none() && backdrop_filter.is_none() {
            self.census.plain_layers += 1;
        }
        if self.skip.layers {
            self.push_clip_layer(fill, transform, clip);
            return;
        }
        if self.filters
            && let Some(filter) = filter.as_ref().filter(|f| gpu_filter::has_effect(f))
        {
            // Its content in a scene of its own, on whole pixels, cut to the region (less a margin) and to the largest
            // side a job takes.
            let mut bbox = transform.transform_rect_bbox(clip.bounding_box()).intersect(self.bounds.inflate(FILTER_MARGIN, FILTER_MARGIN)).expand();
            if bbox.width() > gpu_filter::MAX_SIDE || bbox.height() > gpu_filter::MAX_SIDE {
                bbox = bbox.intersect(self.bounds).expand();
            }
            let c = transform.as_coeffs();
            self.recording.push(Recording {
                scene: vello::Scene::new(),
                bbox,
                filter: filter.clone(),
                transform: Affine::new([c[0], c[1], c[2], c[3], 0.0, 0.0]),
                level: self.recording.len(),
                alpha,
                blend,
            });
            self.pushed.push(Pushed::Filter);
            return;
        }
        let to = if self.recording.is_empty() { Pushed::Inner } else { Pushed::Recorded };
        self.pushed.push(to);
        target!(self, |p| p.push_layer(fill, blend, alpha, transform, clip, filter.clone(), backdrop_filter.clone()));
    }

    fn push_clip_layer(&mut self, fill: Fill, transform: Affine, clip: &impl Shape) {
        self.census.clips += 1;
        if self.skip.clips {
            self.pushed.push(Pushed::Skipped);
            return;
        }
        self.pushed.push(if self.recording.is_empty() { Pushed::Inner } else { Pushed::Recorded });
        target!(self, |p| p.push_clip_layer(fill, transform, clip));
    }

    fn pop_layer(&mut self) {
        match self.pushed.pop().unwrap_or(Pushed::Inner) {
            Pushed::Inner => self.inner.pop_layer(),
            Pushed::Recorded => {
                if let Some(rec) = self.recording.last_mut() {
                    VelloScenePainter::new(&mut rec.scene).pop_layer();
                }
            }
            Pushed::Skipped => {}
            Pushed::Filter => {
                let Some(rec) = self.recording.pop() else { return };
                if rec.bbox.width() < 1.0 || rec.bbox.height() < 1.0 {
                    return;
                }
                // Where it was, the image its job makes (its opacity and blend applied to the filtered whole).
                let (w, h) = (rec.bbox.width() as u32, rec.bbox.height() as u32);
                let image = self.placeholders.take(w, h);
                let brush = ImageBrush::new(image.clone());
                let origin = Affine::translate((rec.bbox.x0, rec.bbox.y0));
                let layered = rec.alpha < 1.0 || rec.blend != BlendMode::default();
                let (alpha, blend, bbox) = (rec.alpha, rec.blend, rec.bbox);
                target!(self, |p| {
                    if layered {
                        p.push_layer(Fill::NonZero, blend, alpha, Affine::IDENTITY, &bbox, None, None);
                    }
                    p.draw_image(brush.as_ref(), origin);
                    if layered {
                        p.pop_layer();
                    }
                });
                self.jobs.push(Job { recording: rec, image });
            }
        }
    }

    fn stroke<'a>(&mut self, style: &Stroke, transform: Affine, brush: impl Into<PaintRef<'a>>, brush_transform: Option<Affine>, shape: &impl Shape) {
        self.census.strokes += 1;
        let brush = brush.into();
        if self.keep(&brush) {
            target!(self, |p| p.stroke(style, transform, brush, brush_transform, shape));
        }
    }

    fn fill<'a>(&mut self, style: Fill, transform: Affine, brush: impl Into<PaintRef<'a>>, brush_transform: Option<Affine>, shape: &impl Shape) {
        self.census.fills += 1;
        let brush = brush.into();
        if self.keep(&brush) {
            target!(self, |p| p.fill(style, transform, brush, brush_transform, shape));
        }
    }

    fn draw_glyphs<'a, 's: 'a>(
        &'s mut self,
        font: &'a FontData,
        font_size: f32,
        hint: bool,
        normalized_coords: &'a [NormalizedCoord],
        embolden: kurbo::Vec2,
        style: impl Into<StyleRef<'a>>,
        brush: impl Into<PaintRef<'a>>,
        brush_alpha: f32,
        transform: Affine,
        glyph_transform: Option<Affine>,
        glyphs: impl Iterator<Item = anyrender::Glyph> + Clone,
    ) {
        self.census.glyph_runs += 1;
        self.census.glyphs += glyphs.clone().count() as u64;
        if !self.skip.text {
            let (style, brush) = (style.into(), brush.into());
            target!(self, |p| p.draw_glyphs(font, font_size, hint, normalized_coords, embolden, style, brush, brush_alpha, transform, glyph_transform, glyphs));
        }
    }

    fn draw_box_shadow(&mut self, transform: Affine, rect: Rect, brush: Color, radius: f64, std_dev: f64) {
        self.census.shadows += 1;
        if !self.skip.shadows {
            target!(self, |p| p.draw_box_shadow(transform, rect, brush, radius, std_dev));
        }
    }
}

impl<P: PaintScene> Filtered<'_, P> {
    /// Counts a brush's kind; whether `skip` lets it through.
    fn keep(&mut self, brush: &PaintRef<'_>) -> bool {
        match brush {
            Paint::Image(image) => {
                self.census.images += 1;
                self.census.image_pixels += image.image.width as u64 * image.image.height as u64;
                !self.skip.images
            }
            Paint::Gradient(_) => {
                self.census.gradients += 1;
                !self.skip.gradients
            }
            _ => true,
        }
    }
}

impl GpuUiPainter {
    /// Vello's pipelines on `device` (compiled once here: tens of ms).
    ///
    /// Bisecting a device that fails under Vello (on Mali GPUs): VELLO_CPU=1 runs Vello's
    /// stages before the fine rasterizer on the CPU; VELLO_AA picks the antialiasing; VELLO_SKIP leaves
    /// out kinds of command ([`Skip::parse`]); VELLO_EMPTY=1 paints nothing.
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Result<GpuUiPainter, String> {
        // Vello's stages run on the GPU everywhere. On Android's Mali-G715 they lost the device until the vendored
        // vello_shaders stopped reading workgroup arrays at [i - 1u] inside select() (vendor/vello_shaders/PROVENANCE.md);
        // VELLO_CPU=1 runs them on the CPU, VELLO_GPU_FROM=<stage> only those before <stage>.
        let use_cpu = std::env::var("VELLO_CPU").as_deref() == Ok("1");
        let (aa, support) = match std::env::var("VELLO_AA").as_deref() {
            Ok("msaa8") => (vello::AaConfig::Msaa8, vello::AaSupport { area: false, msaa8: true, msaa16: false }),
            Ok("msaa16") => (vello::AaConfig::Msaa16, vello::AaSupport { area: false, msaa8: false, msaa16: true }),
            _ => (vello::AaConfig::Area, vello::AaSupport::area_only()),
        };
        let skip = std::env::var("VELLO_SKIP").map(|s| Skip::parse(&s)).unwrap_or_default();
        let empty = std::env::var("VELLO_EMPTY").as_deref() == Ok("1");
        if use_cpu || empty || std::env::var_os("VELLO_AA").is_some() || std::env::var_os("VELLO_SKIP").is_some() {
            println!("vello: cpu stages {use_cpu}, aa {aa:?}, skip {skip:?}, empty {empty}");
        }
        let renderer = vello::Renderer::new(device, vello::RendererOptions { use_cpu, antialiasing_support: support, num_init_threads: None, pipeline_cache: None })
            .map_err(|e| format!("vello: {e}"))?;
        let filters_on = std::env::var("BLITZ_UI_FILTERS").as_deref() != Ok("0");
        Ok(GpuUiPainter { device: device.clone(), queue: queue.clone(), renderer, scene: vello::Scene::new(), scratch: None, census: Census::default(), skip, aa, empty, filters: None, filters_on, placeholders: gpu_filter::Placeholders::default() })
    }

    /// Resolve `doc` and repaint what changed into `target` (`width` x `height`,
    /// [`TARGET_FORMAT`] with [`TARGET_USAGE`]); `full` repaints it all (a new target).
    /// Answers the damage painted and the CPU time each stage took (the GPU's work is
    /// submitted, not waited for: `raster_ms` is Vello's encoding and submission).
    pub fn paint_damage(&mut self, doc: &mut blitz_dom::BaseDocument, target: &wgpu::Texture, scale: f32, now: f64, full: bool) -> (PaintDamage, PaintProfile) {
        self.paint_damage_over(doc, target, None, scale, now, full)
    }

    /// [`paint_damage`](Self::paint_damage) into one of two textures a host alternates (it composites one on another
    /// thread while this paints the other): a paint of regions first copies `previous` (the last paint, the same size
    /// and usage plus COPY_SRC) into `target` whole, so the regions land on the document as it last stood. A whole
    /// paint, or no damage, copies nothing.
    pub fn paint_damage_over(&mut self, doc: &mut blitz_dom::BaseDocument, target: &wgpu::Texture, previous: Option<&wgpu::Texture>, scale: f32, now: f64, full: bool) -> (PaintDamage, PaintProfile) {
        let ms = |t: Instant| t.elapsed().as_secs_f64() * 1e3;
        let t = Instant::now();
        doc.resolve(now);
        let mut profile = PaintProfile { resolve_ms: ms(t), ..Default::default() };
        let mut damage = doc.take_paint_damage();
        // BLITZ_UI_FULL_PAINT=1: every paint is whole (a check that a fault is the damage's, not the painting's).
        static FULL_PAINT: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        if full || (*FULL_PAINT.get_or_init(|| std::env::var("BLITZ_UI_FULL_PAINT").as_deref() == Ok("1")) && !matches!(damage, PaintDamage::None)) {
            damage = PaintDamage::Full;
        }
        let (width, height) = (target.width(), target.height());
        let window = kurbo::Rect::new(0.0, 0.0, width as f64, height as f64);
        let regions: Vec<kurbo::Rect> = match &damage {
            PaintDamage::None => return (damage, profile),
            PaintDamage::Full => vec![window],
            PaintDamage::Regions(list) => merge_regions(list, window),
        };
        damage_trace(&damage, &regions, width, height);
        if let Some(previous) = previous.filter(|p| !matches!(damage, PaintDamage::Full) && p.width() == width && p.height() == height) {
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("ui previous paint") });
            encoder.copy_texture_to_texture(previous.as_image_copy(), target.as_image_copy(), wgpu::Extent3d { width, height, depth_or_array_layers: 1 });
            self.queue.submit([encoder.finish()]);
        }
        for region in regions {
            let (x, y, w, h) = (region.x0 as u32, region.y0 as u32, region.width() as u32, region.height() as u32);
            if w == 0 || h == 0 || x + w > width || y + h > height {
                continue;
            }
            let t = Instant::now();
            self.scene.reset();
            let mut jobs = Vec::new();
            {
                let mut painter = VelloScenePainter::new(&mut self.scene);
                let mut filtered = Filtered {
                    inner: &mut painter,
                    census: &mut self.census,
                    skip: self.skip,
                    pushed: Vec::new(),
                    recording: Vec::new(),
                    jobs: &mut jobs,
                    bounds: Rect::new(0.0, 0.0, f64::from(w), f64::from(h)),
                    filters: self.filters_on,
                    placeholders: &mut self.placeholders,
                };
                if !self.empty {
                    paint_scene_region(&mut filtered, doc, scale as f64, region);
                }
            }
            profile.scene_ms += ms(t);
            // The filtered layers' images, rendered and filtered before the scene that draws them.
            if !jobs.is_empty() {
                let scopes = own_scopes(&self.device);
                let filters = self.filters.get_or_insert_with(|| FilterPasses::new(&self.device));
                filters.run(&self.device, &self.queue, &mut self.renderer, self.aa, jobs);
                report_scopes(scopes);
            }
            let t = Instant::now();
            let params = vello::RenderParams { base_color: vello::peniko::Color::TRANSPARENT, width: w, height: h, antialiasing_method: self.aa };
            if region == window {
                let view = target.create_view(&wgpu::TextureViewDescriptor::default());
                let scopes = own_scopes(&self.device);
                if let Err(e) = self.renderer.render_to_texture(&self.device, &self.queue, &self.scene, &view, &params) {
                    eprintln!("gpu ui paint: {e}");
                }
                report_scopes(scopes);
            } else {
                let view = self.scratch(w, h);
                let scopes = own_scopes(&self.device);
                if let Err(e) = self.renderer.render_to_texture(&self.device, &self.queue, &self.scene, &view, &params) {
                    eprintln!("gpu ui paint: {e}");
                }
                report_scopes(scopes);
                let scratch = &self.scratch.as_ref().unwrap().0;
                let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("ui region") });
                encoder.copy_texture_to_texture(
                    scratch.as_image_copy(),
                    wgpu::TexelCopyTextureInfo { texture: target, mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All },
                    wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                );
                self.queue.submit([encoder.finish()]);
            }
            if let Some(filters) = self.filters.as_mut() {
                filters.release(&mut self.renderer);
            }
            self.placeholders.reset();
            profile.raster_ms += ms(t);
        }
        self.scene.reset();
        (damage, profile)
    }

    /// The scratch texture's view, grown to at least `w` x `h`.
    fn scratch(&mut self, w: u32, h: u32) -> wgpu::TextureView {
        let fits = self.scratch.as_ref().is_some_and(|(t, _)| t.width() >= w && t.height() >= h);
        if !fits {
            let (cw, ch) = self.scratch.as_ref().map_or((0, 0), |(t, _)| (t.width(), t.height()));
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("ui region scratch"),
                size: wgpu::Extent3d { width: w.max(cw), height: h.max(ch), depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: TARGET_FORMAT,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            self.scratch = Some((texture, view));
        }
        self.scratch.as_ref().unwrap().1.clone()
    }
}

/// The regions a paint renders: several small ones become their bounding box, painted once. Each region is a Vello
/// render of its own (the scene re-encoded from the document, its own dispatches and submit) plus a copy, so an animated
/// scene's 4-6 scattered regions a frame (floating labels, a dial, a readout) cost more than the one box around them while
/// that box stays under half the window. BLITZ_UI_MERGE=0 paints each region (an A/B in one binary).
fn merge_regions(list: &[kurbo::Rect], window: kurbo::Rect) -> Vec<kurbo::Rect> {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if list.len() < 2 || !*ON.get_or_init(|| std::env::var("BLITZ_UI_MERGE").as_deref() != Ok("0")) {
        return list.to_vec();
    }
    let bounds = list[1..].iter().fold(list[0], |a, r| a.union(*r)).intersect(window);
    if bounds.area() * 2.0 < window.area() {
        vec![bounds]
    } else {
        list.to_vec()
    }
}

/// Error scopes of the painter's own around a Vello render: the device is the page's too, and a scope the page has open
/// (gpu-stream's pushErrorScope) would otherwise take the painter's errors, and the page see errors it did not make.
fn own_scopes(device: &wgpu::Device) -> Vec<wgpu::ErrorScopeGuard> {
    [wgpu::ErrorFilter::Validation, wgpu::ErrorFilter::OutOfMemory, wgpu::ErrorFilter::Internal].iter().map(|f| device.push_error_scope(*f)).collect()
}

/// The painter's scopes popped, innermost first; each new error printed once (a broken painter fails every frame alike).
fn report_scopes(scopes: Vec<wgpu::ErrorScopeGuard>) {
    static SEEN: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    for scope in scopes.into_iter().rev() {
        if let Some(e) = pollster::block_on(scope.pop()) {
            let text = e.to_string();
            let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
            if !seen.contains(&text) && seen.len() < 16 {
                eprintln!("gpu ui paint: {text}");
                seen.push(text);
            }
        }
    }
}

/// BLITZ_UI_DAMAGE=1: every two seconds, what the paints since covered: how many were whole-window and how many
/// regions, the pixels painted per paint as a share of the window, and the largest regions (x, y, w x h).
fn damage_trace(damage: &PaintDamage, regions: &[kurbo::Rect], width: u32, height: u32) {
    struct Stats {
        since: Instant,
        paints: u32,
        full: u32,
        regions: u32,
        pixels: f64,
        largest: Vec<(f64, kurbo::Rect)>,
    }
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    static STATS: std::sync::Mutex<Option<Stats>> = std::sync::Mutex::new(None);
    if !*ON.get_or_init(|| std::env::var("BLITZ_UI_DAMAGE").as_deref() == Ok("1")) {
        return;
    }
    let mut guard = STATS.lock().unwrap_or_else(|e| e.into_inner());
    let st = guard.get_or_insert_with(|| Stats { since: Instant::now(), paints: 0, full: 0, regions: 0, pixels: 0.0, largest: Vec::new() });
    st.paints += 1;
    if matches!(damage, PaintDamage::Full) {
        st.full += 1;
    } else {
        st.regions += regions.len() as u32;
    }
    for r in regions {
        let area = r.width() * r.height();
        st.pixels += area;
        st.largest.push((area, *r));
    }
    st.largest.sort_by(|a, b| b.0.total_cmp(&a.0));
    st.largest.dedup_by(|a, b| a.1 == b.1);
    st.largest.truncate(4);
    if st.since.elapsed().as_secs_f64() < 2.0 {
        return;
    }
    let window = f64::from(width) * f64::from(height);
    let largest: Vec<String> = st.largest.iter().map(|(_, r)| format!("{:.0},{:.0} {:.0}x{:.0}", r.x0, r.y0, r.width(), r.height())).collect();
    eprintln!(
        "ui damage: {} paints ({} whole, {} regions): {:.0}% of the window per paint; largest {}",
        st.paints,
        st.full,
        st.regions,
        100.0 * st.pixels / window / f64::from(st.paints),
        largest.join(" | ")
    );
    *guard = None;
}
