//! CSS `filter` for the GPU painter (gpu_paint.rs). Vello has no filter effects: a layer pushed with one used to draw as
//! if it had none, so every brightness, saturate, grayscale, blur and drop-shadow in the UI was missing natively (72 of
//! them across one app's stylesheets, 2026-11-23: a selected card on its landing page lost its glow).
//!
//! A filtered layer is recorded into a scene of its own ([`Recording`]), and the page's scene draws in its place an
//! image whose pixels are the recording rendered and filtered here. Before the page's scene renders, [`FilterPasses`]
//! takes the paint's jobs level by level (a filter inside a filter renders first, its image then drawn by the outer
//! recording), packs each level's recordings into one texture and renders them with one Vello render, then runs each
//! job's filter chain as compute passes over its own rectangle, and registers each result with Vello as the job's image
//! (`override_image`: copied into Vello's atlas when a scene that draws it renders).
//!
//! The chain is anyrender's linear list (blitz-paint filters.rs): colour matrices (opacity, brightness, contrast,
//! grayscale, hue-rotate, invert, saturate, sepia; consecutive ones composed into one pass), Gaussian blur (two
//! separable passes) and drop shadow (the alpha blurred in two passes, offset, tinted and composited under the source).
//! An offset is a shift; what anyrender can express beyond that (lighting, turbulence, morphology...) passes through
//! unchanged, as blitz never asks for it. Textures hold straight (unpremultiplied) RGBA8 as Vello writes it; the passes
//! work premultiplied where CSS does (blur, compositing) and straight where it does (colour matrices, in sRGB).

use std::sync::Arc;

use anyrender::Filter;
use anyrender::filters::FilterEffect;
use kurbo::{Affine, Rect};
use vello::peniko::{BlendMode, ImageData};
use vello::wgpu;

/// One filtered layer as the paint recorded it: its content in a scene of its own, where it lands on the page (device
/// pixels, whole), its filter and the scale its lengths take (the layer's transform), and the image the page draws.
pub struct Recording {
    pub scene: vello::Scene,
    /// Whole device pixels in the region's space, never empty for a job.
    pub bbox: Rect,
    pub filter: Arc<Filter>,
    /// The layer's linear transform: the filter's lengths (blur, shadow offset) are in its user space.
    pub transform: Affine,
    /// How deep among filtered layers it was pushed (0: not inside another).
    pub level: usize,
    pub alpha: f32,
    pub blend: BlendMode,
}

/// A recording waiting for its pixels, and the placeholder image the page's scene draws for it.
pub struct Job {
    pub recording: Recording,
    pub image: ImageData,
}

/// The largest side a filtered layer may take (device pixels): beyond it the layer is cut to the region it paints in.
pub const MAX_SIDE: f64 = 2048.0;

/// The placeholder images filtered layers draw as, reused paint to paint by size. Each placeholder is an atlas entry in
/// Vello (by its blob's id), and Vello keeps an entry resident until it has gone unused for a while: a fresh placeholder
/// per layer per paint (as before) filled the atlas with the dead results of every paint a filter was on in (a
/// selection ring's glow), until the page's own images were evicted and no longer fit (Vello then skips an image: the
/// page's panels, slots and icons painted blank on the phone). Reused, a layer's result overwrites its own entry
/// (`mark_override_image_dirty`).
#[derive(Default)]
pub struct Placeholders {
    by_size: std::collections::HashMap<(u32, u32), Vec<ImageData>>,
    /// How many of each size this region's paint has taken.
    taken: std::collections::HashMap<(u32, u32), usize>,
    count: usize,
}

impl Placeholders {
    /// The paint's next placeholder of `w` x `h` (another than any it took since [`Self::reset`]).
    pub fn take(&mut self, w: u32, h: u32) -> ImageData {
        let n = self.taken.entry((w, h)).or_insert(0);
        let list = self.by_size.entry((w, h)).or_default();
        if *n == list.len() {
            list.push(placeholder(w, h));
            self.count += 1;
        }
        let image = list[*n].clone();
        *n += 1;
        image
    }

    /// After a region's paint (its results drawn): its placeholders may be taken again. A set grown past what a page's
    /// filtered layers need (sizes that keep changing) starts over; its old entries then leave Vello's atlas as stale.
    pub fn reset(&mut self) {
        self.taken.clear();
        if self.count > 64 {
            self.by_size.clear();
            self.count = 0;
        }
    }
}

/// A placeholder image of `w` x `h` (an empty blob: its pixels come from a texture, `override_image`).
pub fn placeholder(w: u32, h: u32) -> ImageData {
    ImageData {
        data: vello::peniko::Blob::new(Arc::new(&[])),
        format: vello::peniko::ImageFormat::Rgba8,
        alpha_type: vello::peniko::ImageAlphaType::Alpha,
        width: w,
        height: h,
    }
}

/// Whether `filter` changes anything this module can do: a chain of only identities (and kinds it passes through) is
/// drawn as a plain layer, without a recording.
pub fn has_effect(filter: &Filter) -> bool {
    filter.nodes().iter().any(|node| match &node.effect {
        FilterEffect::ColorMatrix(m) => m.0 != IDENTITY,
        FilterEffect::GaussianBlur(b) => b.std_deviation > 0.0,
        FilterEffect::DropShadow(s) => s.color.components[3] > 0.0,
        FilterEffect::Offset(v) => v.x != 0.0 || v.y != 0.0,
        _ => false,
    })
}

const IDENTITY: [f32; 20] = [1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 0., 1., 0.];

/// `a` after `b` (4x5 colour matrices, row-major, the fifth column an offset): applying the result is applying `b`
/// then `a`.
fn compose(a: &[f32; 20], b: &[f32; 20]) -> [f32; 20] {
    let mut out = [0.0; 20];
    for r in 0..4 {
        for c in 0..5 {
            let mut v = if c == 4 { a[r * 5 + 4] } else { 0.0 };
            for k in 0..4 {
                v += a[r * 5 + k] * b[k * 5 + c];
            }
            out[r * 5 + c] = v;
        }
    }
    out
}

/// One pass of a job's chain, in device pixels.
#[derive(Clone, Copy)]
enum Pass {
    Matrix([f32; 20]),
    /// sigma, along x (true) or y; `alpha_only`: the drop shadow's alpha.
    Blur { sigma: f32, horizontal: bool, alpha_only: bool },
    /// The source composited over the shadow (the input two passes back, read at `-offset`), tinted `color`.
    Shadow { dx: f32, dy: f32, color: [f32; 4] },
    Shift { dx: f32, dy: f32 },
}

/// The chain as passes, at `scale` device pixels per user unit (`linear`: the layer's transform without translation).
fn passes(filter: &Filter, linear: Affine) -> Vec<Pass> {
    let scale = linear.determinant().abs().sqrt() as f32;
    let vector = |x: f32, y: f32| {
        let p = linear * kurbo::Point::new(f64::from(x), f64::from(y));
        (p.x as f32, p.y as f32)
    };
    let mut out: Vec<Pass> = Vec::new();
    for node in filter.nodes() {
        match &node.effect {
            FilterEffect::ColorMatrix(m) if m.0 != IDENTITY => match out.last_mut() {
                Some(Pass::Matrix(prev)) => *prev = compose(&m.0, prev),
                _ => out.push(Pass::Matrix(m.0)),
            },
            FilterEffect::GaussianBlur(b) if b.std_deviation > 0.0 => {
                let sigma = b.std_deviation * scale;
                out.push(Pass::Blur { sigma, horizontal: true, alpha_only: false });
                out.push(Pass::Blur { sigma, horizontal: false, alpha_only: false });
            }
            FilterEffect::DropShadow(s) if s.color.components[3] > 0.0 => {
                let sigma = s.std_deviation * scale;
                let (dx, dy) = vector(s.dx, s.dy);
                if sigma > 0.0 {
                    out.push(Pass::Blur { sigma, horizontal: true, alpha_only: true });
                    out.push(Pass::Blur { sigma, horizontal: false, alpha_only: true });
                }
                out.push(Pass::Shadow { dx, dy, color: s.color.components });
            }
            FilterEffect::Offset(v) if v.x != 0.0 || v.y != 0.0 => {
                let (dx, dy) = vector(v.x as f32, v.y as f32);
                out.push(Pass::Shift { dx, dy });
            }
            _ => {}
        }
    }
    out
}

/// The parameters of one dispatch (std140-compatible: vec4s), at a 256-byte stride for dynamic offsets.
#[repr(C)]
#[derive(Clone, Copy)]
struct Params {
    /// The job's rectangle in the textures: x, y, w, h.
    rect: [i32; 4],
    /// kind (0 matrix, 1 blur, 2 shadow, 3 shift), alpha_only, horizontal, radius.
    mode: [i32; 4],
    /// The colour matrix's rows (r, g, b, a coefficients) and its offsets.
    m: [[f32; 4]; 4],
    offset: [f32; 4],
    /// sigma, dx, dy, unused.
    blur: [f32; 4],
    /// The shadow's colour (straight).
    color: [f32; 4],
}

const STRIDE: u64 = 256;

const SHADER: &str = r#"
struct Params {
    rect: vec4<i32>,
    mode: vec4<i32>,
    m0: vec4<f32>,
    m1: vec4<f32>,
    m2: vec4<f32>,
    m3: vec4<f32>,
    offset: vec4<f32>,
    blur: vec4<f32>,
    color: vec4<f32>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var aux: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> p: Params;

// Whether `q` (relative to the job's rectangle) is inside it: outside, a texel is transparent (neighbours packed beside
// it are not its pixels).
fn inside(q: vec2<i32>) -> bool {
    return q.x >= 0 && q.y >= 0 && q.x < p.rect.z && q.y < p.rect.w;
}

// The two inputs' texels, each read from its own binding: never a texture passed as a function's parameter, which
// Mali's SPIR-V compiler (Pixel 8, libGLES_mali image_addr_is_yuv) dereferences null on and takes the process down.
fn load_src(q: vec2<i32>) -> vec4<f32> {
    if (!inside(q)) {
        return vec4<f32>(0.0);
    }
    return textureLoad(src, p.rect.xy + q, 0);
}

fn load_aux(q: vec2<i32>) -> vec4<f32> {
    if (!inside(q)) {
        return vec4<f32>(0.0);
    }
    return textureLoad(aux, p.rect.xy + q, 0);
}

fn premul(c: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(c.rgb * c.a, c.a);
}

fn unpremul(c: vec4<f32>) -> vec4<f32> {
    if (c.a <= 0.0) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(clamp(c.rgb / c.a, vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let q = vec2<i32>(id.xy);
    if (q.x >= p.rect.z || q.y >= p.rect.w) {
        return;
    }
    var out = vec4<f32>(0.0);
    switch p.mode.x {
        case 0: {
            // Colour matrix on straight sRGB values, as CSS's filter functions are defined.
            let c = load_src(q);
            let v = vec4<f32>(dot(p.m0, c), dot(p.m1, c), dot(p.m2, c), dot(p.m3, c)) + p.offset;
            out = clamp(v, vec4<f32>(0.0), vec4<f32>(1.0));
            if (out.a <= 0.0) {
                out = vec4<f32>(0.0);
            }
        }
        case 1: {
            // One direction of a Gaussian blur, premultiplied; the shadow's blur carries alpha only.
            let sigma = p.blur.x;
            let radius = p.mode.w;
            var step = vec2<i32>(1, 0);
            if (p.mode.z == 0) {
                step = vec2<i32>(0, 1);
            }
            var sum = vec4<f32>(0.0);
            var weights = 0.0;
            for (var i = -radius; i <= radius; i = i + 1) {
                let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
                let c = load_src(q + step * i);
                if (p.mode.y == 1) {
                    sum = sum + vec4<f32>(0.0, 0.0, 0.0, c.a * w);
                } else {
                    sum = sum + premul(c) * w;
                }
                weights = weights + w;
            }
            sum = sum / weights;
            if (p.mode.y == 1) {
                out = vec4<f32>(0.0, 0.0, 0.0, sum.a);
            } else {
                out = unpremul(sum);
            }
        }
        case 2: {
            // The source over its shadow: the blurred alpha (aux) read at -offset, tinted.
            let shift = vec2<i32>(round(p.blur.yz));
            let a = load_aux(q - shift).a * p.color.a;
            let shadow = vec4<f32>(p.color.rgb * a, a);
            let s = premul(load_src(q));
            out = unpremul(s + shadow * (1.0 - s.a));
        }
        default: {
            let shift = vec2<i32>(round(p.blur.yz));
            out = load_src(q - shift);
        }
    }
    textureStore(dst, p.rect.xy + q, out);
}
"#;

/// The filter passes and their textures on one device.
pub struct FilterPasses {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
    params: Option<wgpu::Buffer>,
    /// Three textures per batch of a paint (Vello renders into the first, the passes go between them), kept for the
    /// next paint; `used` of them taken by this paint's batches so far.
    textures: Vec<wgpu::Texture>,
    used: usize,
    /// What each paint registered with Vello, unregistered before the next.
    registered: Vec<ImageData>,
}

impl FilterPasses {
    pub fn new(device: &wgpu::Device) -> FilterPasses {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("ui filter"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let texture = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ui filter"),
            entries: &[
                texture(0),
                texture(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture { access: wgpu::StorageTextureAccess::WriteOnly, format: wgpu::TextureFormat::Rgba8Unorm, view_dimension: wgpu::TextureViewDimension::D2 },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: true, min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<Params>() as u64) },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("ui filter"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("ui filter"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        FilterPasses { pipeline, layout, params: None, textures: Vec::new(), used: 0, registered: Vec::new() }
    }

    /// Forgets what the last paint registered with Vello (its images are no longer drawn), and frees its textures for
    /// the next paint.
    pub fn release(&mut self, renderer: &mut vello::Renderer) {
        for image in self.registered.drain(..) {
            renderer.override_image(&image, None);
        }
        self.used = 0;
    }

    /// Renders and filters `jobs`, deepest level first, and registers each result as its job's image.
    pub fn run(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, renderer: &mut vello::Renderer, aa: vello::AaConfig, jobs: Vec<Job>) {
        if jobs.is_empty() {
            return;
        }
        // The first few paints with filters say so (a device that draws none can then be told from one that never had
        // any to draw).
        static SAID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        if SAID.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < 3 {
            let sizes: Vec<String> = jobs.iter().take(6).map(|j| format!("{}x{}", j.recording.bbox.width(), j.recording.bbox.height())).collect();
            eprintln!("gpu ui filter: {} filtered layers ({})", jobs.len(), sizes.join(" "));
        }
        let deepest = jobs.iter().map(|j| j.recording.level).max().unwrap_or(0);
        let mut by_level: Vec<Vec<Job>> = (0..=deepest).map(|_| Vec::new()).collect();
        for job in jobs {
            by_level[job.recording.level].push(job);
        }
        let limit = device.limits().max_texture_dimension_2d.min(8192);
        for level in by_level.into_iter().rev() {
            let mut rest = level;
            // Each batch fits one texture.
            while !rest.is_empty() {
                let (batch, placed, size) = pack(&mut rest, limit);
                self.run_batch(device, queue, renderer, aa, batch, &placed, size);
            }
        }
    }

    fn texture(&mut self, device: &wgpu::Device, i: usize, size: (u32, u32)) -> wgpu::Texture {
        while self.textures.len() <= i {
            self.textures.push(new_texture(device, (1, 1)));
        }
        let t = &self.textures[i];
        if t.width() < size.0 || t.height() < size.1 {
            self.textures[i] = new_texture(device, (size.0.max(t.width()), size.1.max(t.height())));
        }
        self.textures[i].clone()
    }

    #[allow(clippy::too_many_arguments)]
    fn run_batch(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, renderer: &mut vello::Renderer, aa: vello::AaConfig, batch: Vec<Job>, placed: &[(u32, u32)], size: (u32, u32)) {
        // Every job's textures for this batch are fresh ones: an outer level's Vello render copies the inner level's
        // results into its atlas when it runs, so those may not be written over before then. Three per batch.
        let base = self.used;
        self.used += 3;
        let textures: Vec<wgpu::Texture> = (0..3).map(|i| self.texture(device, base + i, size)).collect();
        // The batch's recordings, each at its place, rendered by Vello in one go.
        let mut scene = vello::Scene::new();
        for (job, &(x, y)) in batch.iter().zip(placed) {
            let r = &job.recording;
            scene.append(&r.scene, Some(Affine::translate((f64::from(x) - r.bbox.x0, f64::from(y) - r.bbox.y0))));
        }
        let view = textures[0].create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams { base_color: vello::peniko::Color::TRANSPARENT, width: size.0, height: size.1, antialiasing_method: aa };
        if let Err(e) = renderer.render_to_texture(device, queue, &scene, &view, &params) {
            eprintln!("gpu ui filter: {e}");
            return;
        }
        // Each job's chain between the three textures; where its result ends up.
        let mut dispatches: Vec<(Params, usize, usize, usize)> = Vec::new(); // params, src, aux, dst
        let mut results = Vec::with_capacity(batch.len());
        for (job, &(x, y)) in batch.iter().zip(placed) {
            let r = &job.recording;
            let rect = [x as i32, y as i32, r.bbox.width() as i32, r.bbox.height() as i32];
            let mut cur = 0usize;
            // The texture holding the source while a shadow's alpha is blurred in the other two.
            let mut held: Option<usize> = None;
            for pass in passes(&r.filter, r.transform) {
                let mut params = Params { rect, mode: [0; 4], m: [[0.0; 4]; 4], offset: [0.0; 4], blur: [0.0; 4], color: [0.0; 4] };
                let free = |a: usize, b: Option<usize>| (0..3).find(|&t| t != a && Some(t) != b).unwrap();
                match pass {
                    Pass::Matrix(m) => {
                        params.mode[0] = 0;
                        for row in 0..4 {
                            params.m[row] = [m[row * 5], m[row * 5 + 1], m[row * 5 + 2], m[row * 5 + 3]];
                            params.offset[row] = m[row * 5 + 4];
                        }
                        let dst = free(cur, held);
                        dispatches.push((params, cur, cur, dst));
                        cur = dst;
                    }
                    Pass::Blur { sigma, horizontal, alpha_only } => {
                        params.mode = [1, i32::from(alpha_only), i32::from(horizontal), (sigma * 3.0).ceil().min(96.0) as i32];
                        params.blur[0] = sigma.max(0.01);
                        if alpha_only && horizontal {
                            // The shadow's first pass: the source stays where it is for the composite.
                            held = Some(cur);
                        }
                        let dst = free(cur, held);
                        dispatches.push((params, cur, cur, dst));
                        cur = dst;
                    }
                    Pass::Shadow { dx, dy, color } => {
                        params.mode[0] = 2;
                        params.blur = [0.0, dx, dy, 0.0];
                        params.color = color;
                        // Without a blur the shadow's alpha is the source's own.
                        let source = held.take().unwrap_or(cur);
                        let dst = free(source, Some(cur));
                        dispatches.push((params, source, cur, dst));
                        cur = dst;
                    }
                    Pass::Shift { dx, dy } => {
                        params.mode[0] = 3;
                        params.blur = [0.0, dx, dy, 0.0];
                        let dst = free(cur, held);
                        dispatches.push((params, cur, cur, dst));
                        cur = dst;
                    }
                }
            }
            results.push(cur);
        }
        if !dispatches.is_empty() {
            let need = STRIDE * dispatches.len() as u64;
            if self.params.as_ref().is_none_or(|b| b.size() < need) {
                self.params = Some(device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("ui filter params"),
                    size: need.next_power_of_two().max(STRIDE * 16),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let buffer = self.params.as_ref().unwrap();
            let mut bytes = vec![0u8; need as usize];
            for (i, (params, ..)) in dispatches.iter().enumerate() {
                // SAFETY: Params is plain old data (repr(C), i32 and f32 fields only).
                let raw = unsafe { std::slice::from_raw_parts((params as *const Params).cast::<u8>(), std::mem::size_of::<Params>()) };
                bytes[i * STRIDE as usize..][..raw.len()].copy_from_slice(raw);
            }
            queue.write_buffer(buffer, 0, &bytes);
            let views: Vec<wgpu::TextureView> = textures.iter().map(|t| t.create_view(&wgpu::TextureViewDescriptor::default())).collect();
            let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("ui filter") });
            for (i, (params, src, aux, dst)) in dispatches.iter().enumerate() {
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("ui filter"),
                    layout: &self.layout,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&views[*src]) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&views[*aux]) },
                        wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&views[*dst]) },
                        wgpu::BindGroupEntry {
                            binding: 3,
                            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer, offset: 0, size: wgpu::BufferSize::new(std::mem::size_of::<Params>() as u64) }),
                        },
                    ],
                });
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("ui filter"), timestamp_writes: None });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &group, &[(i as u64 * STRIDE) as u32]);
                pass.dispatch_workgroups((params.rect[2] as u32).div_ceil(8), (params.rect[3] as u32).div_ceil(8), 1);
            }
            queue.submit([encoder.finish()]);
        }
        // Each result is its job's image: copied into Vello's atlas when a scene drawing it renders.
        for ((job, &(x, y)), cur) in batch.into_iter().zip(placed).zip(results) {
            let source = wgpu::TexelCopyTextureInfoBase { texture: textures[cur].clone(), mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All };
            renderer.override_image(&job.image, Some(source));
            // A reused placeholder's atlas entry holds the last paint's result: copied again.
            renderer.mark_override_image_dirty(&job.image);
            self.registered.push(job.image);
        }
    }

}

fn new_texture(device: &wgpu::Device, size: (u32, u32)) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("ui filter"),
        size: wgpu::Extent3d { width: size.0.max(1), height: size.1.max(1), depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

/// As many of `jobs` as fit one `limit`-sided texture, on shelves (tallest first, 2 pixels apart: Vello's antialiasing
/// never reaches a neighbour); their places and the texture's size. Takes the jobs it placed out of `jobs`.
fn pack(jobs: &mut Vec<Job>, limit: u32) -> (Vec<Job>, Vec<(u32, u32)>, (u32, u32)) {
    const GAP: u32 = 2;
    jobs.sort_by(|a, b| b.recording.bbox.height().total_cmp(&a.recording.bbox.height()));
    let row_width = jobs.iter().map(|j| j.recording.bbox.width() as u32).max().unwrap_or(1).max(1024).min(limit);
    let (mut x, mut y, mut shelf, mut width) = (0u32, 0u32, 0u32, 0u32);
    let mut batch = Vec::new();
    let mut placed = Vec::new();
    while !jobs.is_empty() {
        let (w, h) = (jobs[0].recording.bbox.width() as u32, jobs[0].recording.bbox.height() as u32);
        if x > 0 && x + w > row_width {
            y += shelf + GAP;
            x = 0;
            shelf = 0;
        }
        if y + h > limit && !batch.is_empty() {
            break;
        }
        placed.push((x, y));
        batch.push(jobs.remove(0));
        x += w + GAP;
        shelf = shelf.max(h);
        width = width.max(x);
    }
    (batch, placed, (width.max(1), (y + shelf).max(1)))
}
