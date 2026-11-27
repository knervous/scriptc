//! A real window on macOS (opt-in: SCRIPTC_HOST_WINDOW=1, or =<w>x<h> in points): an NSWindow whose content view is
//! backed by a CAMetalLayer, the GPU device made for that layer's surface, the document laid out and painted on the
//! CPU (blitz-paint on anyrender_vello_cpu) and composited over the program's GPU
//! scene, input dispatched into the document, and requestAnimationFrame paced by the display (CVDisplayLink).
//!
//! The program's event loop stays the owner: NSApplication never runs. The loop's sleep (timers::sleep, from io_poll)
//! drains AppKit events here (nextEventMatchingMask with the loop's deadline) and returns as soon as there is work:
//! input to dispatch, or a display refresh (the display link's thread posts an application-defined event, so the sleep
//! wakes on the vsync itself). The loop turn (timers::run_due -> [`turn`]) then dispatches the input, runs the frame
//! callbacks with the vsync's time, and composites and presents when anything may have changed.
//!
//! The executor draws the program's surface into a scene texture (the layer's scene) on this window's
//! device; the frame is: the scene (or white when the program never acquired one; in the attached canvas's box when
//! a layer's scene attach gave one, its drawing buffer sizing the scene), the document over it
//! (premultiplied alpha), presented. Closing the window (or `window.close()`) ends the page: its timers and frames are
//! dropped, so the program's loop ends. SCRIPTC_HOST_CAPTURE=<path.png> writes the last frame before `window.close()`
//! closes it; SCRIPTC_HOST_INJECT=click:<x>,<y>@<frame> posts a left click (an NSEvent down + up) at CSS px (x, y)
//! when that many frames have been presented (a probe's synthetic click through the real input path); `key:<c>@<frame>`
//! and `resize:<w>x<h>@<frame>` likewise; `clicktext:<text>@<frame>` clicks the element showing that text (case-insensitive); `@<n>ms` instead of `@<frame>` fires after n milliseconds (a page that presents only when it changes never advances its frame count); `down:<c>@<frame>` and `up:<c>@<frame>` hold and release a key (a letter, a digit, or Escape/Tab/Space/Enter); `capture@<frame>` writes SCRIPTC_HOST_CAPTURE then, the window left open. SCRIPTC_HOST_TRACE=1 prints each frame's callback, paint and acquire times, and whether it presented.

/// The window's composite, on every platform with a window: the program's scene opaque, the document over it
/// (premultiplied alpha), each a full-target triangle sampling its texture; and the PNG a capture writes.
#[cfg(all(feature = "window", any(target_os = "macos", target_os = "android", windows)))]
mod compose {
    use gpu_stream_wgpu::wgpu;

    pub struct Compositor {
        pub layout: wgpu::BindGroupLayout,
        pub opaque: wgpu::RenderPipeline,
        pub over: wgpu::RenderPipeline,
        /// The document as Vello paints it on the GPU: straight (unpremultiplied) alpha.
        #[cfg_attr(target_os = "android", allow(dead_code))]
        pub over_straight: wgpu::RenderPipeline,
        /// The scene upscaled with contrast-adaptive sharpening (`fs_sharp`), where it is drawn larger than it was
        /// rendered (a phone's performance mode renders at a fraction of the screen). None: <PREFIX>SHARPEN=0.
        #[cfg_attr(target_os = "macos", allow(dead_code))]
        pub scene_sharp: Option<wgpu::RenderPipeline>,
        pub sampler: wgpu::Sampler,
    }

    /// How hard the upscaled scene is sharpened, 0 (off) to 1: <PREFIX>SHARPEN, else 0.6.
    fn sharpness() -> f32 {
        crate::config::var("SHARPEN").ok().and_then(|v| v.parse::<f32>().ok()).map_or(0.6, |v| v.clamp(0.0, 1.0))
    }

    /// A contrast-adaptive sharpen of the bilinear upscale (after AMD FidelityFX CAS's idea, written here): the cross of
    /// neighbours one source texel away bounds how much the centre may be pushed from them, so edges sharpen and flat
    /// or already-contrasty areas do not ring. Gamma-space, as the scene arrives.
    fn sharp_source(sharpness: f32) -> String {
        // CAS's lobe: from 1/8 (soft) to 1/5 (hard), as a typed literal (naga refuses mix() over abstract floats).
        let divisor = 8.0 - 3.0 * sharpness;
        format!(
            "@group(0) @binding(0) var t: texture_2d<f32>;\n\
             @group(0) @binding(1) var s: sampler;\n\
             struct V {{ @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> }};\n\
             @vertex fn vs(@builtin(vertex_index) i: u32) -> V {{\n\
               let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));\n\
               var o: V; o.p = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0); o.uv = uv; return o;\n\
             }}\n\
             @fragment fn fs(v: V) -> @location(0) vec4<f32> {{\n\
               let texel = 1.0 / vec2<f32>(textureDimensions(t));\n\
               let c = textureSample(t, s, v.uv).rgb;\n\
               let n = textureSample(t, s, v.uv + vec2<f32>(0.0, -texel.y)).rgb;\n\
               let so = textureSample(t, s, v.uv + vec2<f32>(0.0, texel.y)).rgb;\n\
               let e = textureSample(t, s, v.uv + vec2<f32>(texel.x, 0.0)).rgb;\n\
               let w = textureSample(t, s, v.uv + vec2<f32>(-texel.x, 0.0)).rgb;\n\
               let mn = min(c, min(min(n, so), min(e, w)));\n\
               let mx = max(c, max(max(n, so), max(e, w)));\n\
               let amp = sqrt(clamp(min(mn, vec3<f32>(1.0) - mx) / max(mx, vec3<f32>(1e-4)), vec3<f32>(0.0), vec3<f32>(1.0)));\n\
               let k = -amp / {divisor:.4}f;\n\
               let o = (c + k * (n + so + e + w)) / (vec3<f32>(1.0) + 4.0 * k);\n\
               return vec4<f32>(clamp(o, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);\n\
             }}\n"
        )
    }

    pub fn compositor(device: &wgpu::Device, format: wgpu::TextureFormat) -> Compositor {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scriptc-host composite"),
            source: wgpu::ShaderSource::Wgsl(
                "@group(0) @binding(0) var t: texture_2d<f32>;\n\
                 @group(0) @binding(1) var s: sampler;\n\
                 struct V { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> };\n\
                 @vertex fn vs(@builtin(vertex_index) i: u32) -> V {\n\
                   let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));\n\
                   var o: V; o.p = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0); o.uv = uv; return o;\n\
                 }\n\
                 @fragment fn fs(v: V) -> @location(0) vec4<f32> { return textureSample(t, s, v.uv); }\n"
                    .into(),
            ),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], ..Default::default() });
        let pipeline = |blend: Option<wgpu::BlendState>| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("scriptc-host composite"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let sharpness = sharpness();
        // Made under its own validation scope: a pipeline the driver or naga refuses is dropped (the plain composite
        // draws), not bound every frame (an invalid pipeline fails each submit: a black window).
        let scene_sharp = (sharpness > 0.0).then(|| device.push_error_scope(wgpu::ErrorFilter::Validation)).and_then(|scope| {
            let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("scriptc-host composite sharpen"),
                source: wgpu::ShaderSource::Wgsl(sharp_source(sharpness).into()),
            });
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("scriptc-host composite sharpen"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
            match pollster::block_on(scope.pop()) {
                None => Some(pipeline),
                Some(e) => {
                    eprintln!("scriptc-host window: no sharpened upscale ({e})");
                    None
                }
            }
        });
        Compositor {
            scene_sharp,
            opaque: pipeline(None),
            over: pipeline(Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
            over_straight: pipeline(Some(wgpu::BlendState::ALPHA_BLENDING)),
            layout,
            sampler: device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() }),
        }
    }

    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn write_png(path: &str, w: u32, h: u32, rgba: &[u8]) -> Result<(), String> {
        let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())
    }

    /// The document's pixels (style, layout and paint; premultiplied RGBA8 at the window's pixels) when they may have
    /// changed since the last paint: `changed` (a mutation or a load, input, a resize, a capture), or a CSS animation
    /// or transition running. None keeps the last paint on the GPU: the document is
    /// painted on the CPU, a frame's largest cost when the page stands still under a moving scene.
    pub fn document_pixels(changed: bool, scale: f64, pw: u32, ph: u32) -> Option<Vec<u8>> {
        use anyrender::render_to_buffer;
        use anyrender_vello_cpu::VelloCpuImageRenderer;
        let now = crate::timers::now_ms() / 1000.0;
        let rgba = crate::dom::with_document_quiet(|doc| {
            if !changed && !doc.is_animating() {
                return None;
            }
            doc.resolve(now);
            Some(render_to_buffer::<VelloCpuImageRenderer, _>(|scene| blitz_paint::paint_scene(scene, doc, scale, pw, ph, 0, 0), pw, ph))
        });
        // What painting itself marked (layout's own reads) is in this paint.
        crate::dom::take_dirty();
        rgba
    }
}

#[cfg(all(feature = "window", target_os = "macos"))]
pub use mac::*;

// Android: libmatoya's window (window_android.rs).
#[cfg(all(feature = "window", target_os = "android"))]
#[path = "window_android.rs"]
mod android;
#[cfg(all(feature = "window", target_os = "android"))]
pub use android::*;

// Windows: a Win32 window (window_windows.rs).
#[cfg(all(feature = "window", windows))]
#[path = "window_windows.rs"]
mod win32;
#[cfg(all(feature = "window", windows))]
pub use win32::*;

/// navigator.wakeLock (page.rs): macOS keeps its own power policy for now (Android and Windows hold the display, in
/// their own modules), and a host built without the window has no display to hold.
#[cfg(not(all(feature = "window", any(target_os = "android", windows))))]
pub fn stay_awake(_on: bool) {}

#[cfg(not(all(feature = "window", any(target_os = "macos", target_os = "android", windows))))]
mod none {
    pub fn ensure() {}
    /// No window: nothing to keep paced.
    pub fn frame_wait_ms() -> Option<f64> {
        None
    }
    pub fn is_open() -> bool {
        false
    }
    pub fn viewport() -> Option<(u32, u32, f32)> {
        None
    }
    #[cfg(feature = "gpu")]
    pub fn shared_device() -> Option<(gpu_stream_wgpu::wgpu::Device, gpu_stream_wgpu::wgpu::Queue, u32, u32)> {
        None
    }
    pub fn work_ready() -> bool {
        false
    }
    pub fn sleep(_ms: f64) {}
    #[allow(dead_code)]
    pub fn wake() {}
    pub fn init_main_waker() {}
    pub fn turn() -> bool {
        false
    }
    pub fn request_close() {}
    pub fn reload() {}
}
#[cfg(not(all(feature = "window", any(target_os = "macos", target_os = "android", windows))))]
pub use none::*;

#[cfg(all(feature = "window", target_os = "macos"))]
mod mac {
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::ffi::{CStr, c_char, c_void};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::time::Instant;

    use gpu_stream_wgpu::wgpu;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

    use crate::dom::{self, Input, Mods, PointerKind};
    use crate::timers;
    use super::compose::{Compositor, compositor, write_png};

    #[link(name = "AppKit", kind = "framework")]
    unsafe extern "C" {}

    #[link(name = "CoreVideo", kind = "framework")]
    unsafe extern "C" {
        fn CVDisplayLinkCreateWithActiveCGDisplays(out: *mut *mut c_void) -> i32;
        fn CVDisplayLinkSetOutputCallback(link: *mut c_void, callback: Option<DisplayLinkCallback>, context: *mut c_void) -> i32;
        fn CVDisplayLinkStart(link: *mut c_void) -> i32;
        fn CVDisplayLinkStop(link: *mut c_void) -> i32;
        fn CVDisplayLinkRelease(link: *mut c_void);
        fn CVDisplayLinkGetActualOutputVideoRefreshPeriod(link: *mut c_void) -> f64;
    }

    type DisplayLinkCallback = unsafe extern "C" fn(*mut c_void, *const c_void, *const c_void, u64, *mut u64, *mut c_void) -> i32;

    type Id = *mut AnyObject;

    // NSEvent types and masks.
    const LEFT_DOWN: usize = 1;
    const LEFT_UP: usize = 2;
    const RIGHT_DOWN: usize = 3;
    const RIGHT_UP: usize = 4;
    const MOVED: usize = 5;
    const LEFT_DRAGGED: usize = 6;
    const RIGHT_DRAGGED: usize = 7;
    const KEY_DOWN: usize = 10;
    const KEY_UP: usize = 11;
    const APP_DEFINED: usize = 15;
    const SCROLL: usize = 22;
    const OTHER_DOWN: usize = 25;
    const OTHER_UP: usize = 26;
    const OTHER_DRAGGED: usize = 27;
    /// The application-defined event's subtype the display link posts.
    const VSYNC_SUBTYPE: i16 = 0x5c5c;

    /// The application-defined event's subtype a wake() posts (another thread asks the main loop to turn).
    const WAKE_SUBTYPE: i16 = 0x5c5d;

    /// The display link's last refresh, and whether its wake-up event is still in the queue.
    static VSYNC: Mutex<Option<Instant>> = Mutex::new(None);
    static VSYNC_POSTED: AtomicBool = AtomicBool::new(false);
    /// The main thread's instance's waker (set when the window opens there), and a wake() not yet seen by its sleep.
    static MAIN_WAKER: Mutex<Option<crate::modules::Waker>> = Mutex::new(None);
    static WOKEN: AtomicBool = AtomicBool::new(false);

    /// Turns the main thread's loop from any thread: its sleep in AppKit's queue (an application event) and its wait
    /// on the pool (its waker) both end, and its next turn runs what was posted to it (the runtime's remote inbox, a
    /// seam call).
    /// The main thread's waker, from the main thread (its first host call, before any window).
    pub fn init_main_waker() {
        *MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::modules::waker());
    }

    #[allow(dead_code)]
    pub fn wake() {
        WOKEN.store(true, Ordering::Release);
        if let Some(waker) = MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            waker.wake();
        }
        let app = APP.load(Ordering::Acquire);
        if !app.is_null() {
            objc2::rc::autoreleasepool(|_| unsafe {
                let event: Id = msg_send![class!(NSEvent), otherEventWithType: APP_DEFINED, location: NSPoint::new(0.0, 0.0), modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: 0isize, context: std::ptr::null_mut::<AnyObject>(), subtype: WAKE_SUBTYPE, data1: 0isize, data2: 0isize];
                if !event.is_null() {
                    let _: () = msg_send![app, postEvent: event, atStart: false];
                }
            });
        }
    }
    /// The display link's callback intervals (ms), for the close report.
    static VSYNC_INTERVALS: Mutex<(Option<Instant>, Vec<f64>)> = Mutex::new((None, Vec::new()));
    static APP: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

    #[derive(Clone)]
    enum Injected {
        Click(f64, f64),
        /// A click at the centre of the smallest element whose text contains this (case-insensitive), when it shows.
        ClickText(String),
        /// A key press (down and up): its characters and macOS virtual key code.
        Key(String, u16),
        /// A key held (`down:<c>`) or released (`up:<c>`): its characters, key code and whether it goes down.
        KeyHeld(String, u16, bool),
        /// The content resized to (w, h) points (as a user's drag would).
        Resize(f64, f64),
        /// The next frame written to SCRIPTC_HOST_CAPTURE (a timed run's screenshot, without closing the window).
        Capture,
        /// The document's markup written beside SCRIPTC_HOST_CAPTURE (`<capture>.html`): which layers are up.
        Dump,
    }

    struct Win {
        window: Id,
        view: Id,
        layer: Id,
        surface: wgpu::Surface<'static>,
        device: wgpu::Device,
        queue: wgpu::Queue,
        config: wgpu::SurfaceConfiguration,
        /// The content size in points (CSS px) and the backing scale.
        points: (f64, f64),
        scale: f64,
        display_link: *mut c_void,
        /// The process's activity while the window is open (`beginActivityWithOptions:`), ended on close.
        activity: Id,
        /// When the surface was last configured.
        configured: Instant,
        refresh_ms: f64,
        input: VecDeque<Input>,
        compositor: Compositor,
        overlay: Option<(wgpu::Texture, u32, u32)>,
        /// The document's painter on this window's device (blitz-ui gpu_paint), until it fails or <PREFIX>UI_CPU=1;
        /// taken out while it paints.
        ui_gpu: Option<blitz_ui::gpu_paint::GpuUiPainter>,
        /// The GPU painter is not used: <PREFIX>UI_CPU=1, or it could not be made.
        ui_cpu: bool,
        /// Where a frame composites while the layer has no drawable (the display asleep or off): captures and the
        /// injected input's frame count go on, nothing is shown.
        offscreen: Option<wgpu::Texture>,
        /// Something may have changed since the last composite.
        dirty: bool,
        scene_presented: u64,
        frames: u64,
        /// The frame callbacks' time for a refresh that arrived (performance.now() ms), until the turn runs them.
        frame_due: Option<f64>,
        /// When the last frame was made due, and whether by the window's own tick: with no refresh for a refresh and a
        /// half (the display asleep or off stops CVDisplayLink; an occluded window's is throttled to a few hertz), the
        /// window paces itself at the display's rate, as Android's window does.
        last_due: Instant,
        ticking: bool,
        close_requested: bool,
        /// Synthetic input to post at a frame count (SCRIPTC_HOST_INJECT).
        inject: Vec<(Injected, u64)>,
        /// Synthetic input at a time (`@<n>ms`: milliseconds after the window opened), for a page that presents only
        /// when it changes (a threaded program's front page), whose frame count would not advance.
        timed: Vec<(Injected, u64)>,
        opened: Instant,
        /// The pressed mouse button's target (a click is a down and an up on the same element).
        paint_ms: Vec<f64>,
    }

    thread_local! {
        static WIN: RefCell<Option<Win>> = const { RefCell::new(None) };
        /// Opened (or tried) once per process; closed once closed.
        static TRIED: Cell<bool> = const { Cell::new(false) };
        static CLOSED: Cell<bool> = const { Cell::new(false) };
    }

    fn requested_size() -> Option<(f64, f64)> {
        let v = std::env::var("SCRIPTC_HOST_WINDOW").ok()?;
        let v = v.trim();
        if v.is_empty() || v == "0" {
            return None;
        }
        if let Some((w, h)) = v.split_once('x') {
            if let (Ok(w), Ok(h)) = (w.trim().parse::<f64>(), h.trim().parse::<f64>()) {
                if w >= 1.0 && h >= 1.0 {
                    return Some((w, h));
                }
            }
        }
        Some((960.0, 600.0))
    }

    /// Opens the window if SCRIPTC_HOST_WINDOW asks for one (once; before the GPU and the document are made, they
    /// call this first).
    pub fn ensure() {
        // AppKit's windows are the main thread's: a render thread (a threaded program) never opens one.
        if !crate::render_thread::is_main_thread() {
            return;
        }
        if TRIED.with(|t| t.replace(true)) {
            return;
        }
        let Some((w, h)) = requested_size() else { return };
        match unsafe { open(w, h) } {
            Ok(win) => WIN.with(|s| *s.borrow_mut() = Some(win)),
            Err(e) => eprintln!("scriptc-host window: {e}"),
        }
    }

    /// While the window is open, the longest the loop may wait on anything else: until its next self-paced frame, and
    /// a refresh at most (the display link's refresh is an AppKit event, which only the window's own sleep wakes for).
    pub fn frame_wait_ms() -> Option<f64> {
        let refresh = WIN.with(|w| w.borrow().as_ref().map(|w| w.refresh_ms))?;
        let tick = silent_tick().map_or(refresh, |t| t.saturating_duration_since(Instant::now()).as_secs_f64() * 1000.0);
        Some(tick.min(refresh))
    }

    pub fn is_open() -> bool {
        WIN.with(|w| w.borrow().is_some())
    }

    /// The document's viewport: physical size and scale.
    pub fn viewport() -> Option<(u32, u32, f32)> {
        ensure();
        WIN.with(|w| w.borrow().as_ref().map(|w| (w.config.width, w.config.height, w.scale as f32)))
    }

    /// The window's device and the scene size (physical pixels), for the GPU (a layer opens its GPU stream on it).
    pub fn shared_device() -> Option<(wgpu::Device, wgpu::Queue, u32, u32)> {
        ensure();
        WIN.with(|w| w.borrow().as_ref().map(|w| (w.device.clone(), w.queue.clone(), w.config.width, w.config.height)))
    }

    /// Input to dispatch or a refresh to run: the loop turns now.
    pub fn work_ready() -> bool {
        WIN.with(|w| w.borrow().as_ref().is_some_and(|w| !w.input.is_empty() || w.frame_due.is_some() || w.close_requested))
    }

    /// `window.close()`: the next turn writes the capture (when asked) and closes.
    pub fn request_close() {
        WIN.with(|w| {
            if let Some(w) = w.borrow_mut().as_mut() {
                w.close_requested = true;
            }
        })
    }

    /// A reload (page.rs `location`): nothing here yet (Windows starts the program again: window_windows.rs).
    pub fn reload() {}

    unsafe fn ns_string(s: &str) -> objc2::rc::Retained<NSString> {
        NSString::from_str(s)
    }

    unsafe fn open(w: f64, h: f64) -> Result<Win, String> {
        unsafe {
            let app: Id = msg_send![class!(NSApplication), sharedApplication];
            // Regular: a Dock icon and a key window (keyboard input), as an app.
            let _: bool = msg_send![app, setActivationPolicy: 0isize];
            let _: () = msg_send![app, finishLaunching];
            APP.store(app, Ordering::Release);
            *MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::modules::waker());
            let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w, h));
            let window: Id = msg_send![class!(NSWindow), alloc];
            // Titled | closable | miniaturizable | resizable; buffered.
            let window: Id = msg_send![window, initWithContentRect: rect, styleMask: 15usize, backing: 2usize, defer: false];
            if window.is_null() {
                return Err("NSWindow did not open".into());
            }
            let _: () = msg_send![window, setReleasedWhenClosed: false];
            let _: () = msg_send![window, setAcceptsMouseMovedEvents: true];
            let title = ns_string(crate::config::get().window_title);
            let _: () = msg_send![window, setTitle: &*title];
            let _: () = msg_send![window, center];
            let view: Id = msg_send![window, contentView];
            let layer: Id = msg_send![class!(CAMetalLayer), new];
            let _: () = msg_send![view, setLayer: layer];
            let _: () = msg_send![view, setWantsLayer: true];
            let _: () = msg_send![window, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
            let _: () = msg_send![window, orderFrontRegardless];
            // The scale of the screen the window is on, now that it is on one.
            let scale: f64 = msg_send![window, backingScaleFactor];
            let _: () = msg_send![layer, setContentsScale: scale];

            let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
            let surface = instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(layer as *mut c_void)).map_err(|e| format!("create surface: {e}"))?;
            let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), ..Default::default() }))
                .map_err(|e| format!("no adapter for the window: {e}"))?;
            let (mut features, limits) = gpu_stream_wgpu::web_device_asks(&adapter);
            // The driver's pipeline cache, kept across runs where wgpu has one (the layer's; Metal).
            if let Some(caches) = crate::config::caches_dir() {
                features |= crate::layer::get().pipeline_cache_features(&adapter, &caches.join("pipeline-cache"));
            }
            let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("scriptc-host window"),
                required_features: features,
                required_limits: limits,
                ..Default::default()
            }))
            .map_err(|e| format!("no device: {e}"))?;
            // Its errors are the page's console's, never the process's end (the layer's scene).
            crate::layer::get().watch_window_device(&device);
            let caps = surface.get_capabilities(&adapter);
            let format = [wgpu::TextureFormat::Bgra8Unorm, wgpu::TextureFormat::Rgba8Unorm]
                .into_iter()
                .find(|f| caps.formats.contains(f))
                .unwrap_or(caps.formats[0]);
            let mut usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
            if caps.usages.contains(wgpu::TextureUsages::COPY_SRC) {
                usage |= wgpu::TextureUsages::COPY_SRC;
            }
            let (pw, ph) = ((w * scale).round() as u32, (h * scale).round() as u32);
            let config = wgpu::SurfaceConfiguration {
                usage,
                format,
                width: pw.max(1),
                height: ph.max(1),
                present_mode: if std::env::var("SCRIPTC_HOST_PRESENT").as_deref() == Ok("immediate") { wgpu::PresentMode::Immediate } else { wgpu::PresentMode::Fifo },
                desired_maximum_frame_latency: 2,
                alpha_mode: caps.alpha_modes[0],
                view_formats: vec![],
                color_space: Default::default(),
            };
            surface.configure(&device, &config);
            let compositor = compositor(&device, format);
            // A render thread's GPU stream (a threaded program) draws on this device; the window composites its scene.
            crate::relay::publish_device(device.clone(), queue.clone(), config.width, config.height);

            let mut display_link: *mut c_void = std::ptr::null_mut();
            let mut refresh_ms = 1000.0 / 60.0;
            if CVDisplayLinkCreateWithActiveCGDisplays(&mut display_link) == 0 && !display_link.is_null() {
                CVDisplayLinkSetOutputCallback(display_link, Some(on_vsync), std::ptr::null_mut());
                CVDisplayLinkStart(display_link);
                let period = CVDisplayLinkGetActualOutputVideoRefreshPeriod(display_link);
                if period > 0.0 {
                    refresh_ms = period * 1000.0;
                    crate::timers::REFRESH_US.store((refresh_ms * 1000.0) as u64, std::sync::atomic::Ordering::Relaxed);
                }
            } else {
                display_link = std::ptr::null_mut();
            }
            // Out of App Nap, and timers uncoalesced, while the window is open: otherwise (the window occluded or not
            // frontmost, the display asleep) the loop's timed waits for a refresh came back after a fifth of a second
            // and more, so the self-paced frames and the program's timers stalled to a few hertz. The system may still
            // sleep when idle.
            let activity: Id = {
                const USER_INITIATED_ALLOWING_IDLE_SYSTEM_SLEEP: u64 = 0x00FF_FFFF & !(1 << 20);
                const LATENCY_CRITICAL: u64 = 0xFF_0000_0000;
                let info: Id = msg_send![class!(NSProcessInfo), processInfo];
                let reason = ns_string(&format!("{} window", crate::config::get().app_name));
                let options = USER_INITIATED_ALLOWING_IDLE_SYSTEM_SLEEP | LATENCY_CRITICAL;
                let token: Id = msg_send![info, beginActivityWithOptions: options, reason: &*reason];
                let _: Id = msg_send![token, retain];
                token
            };
            // `click:<x>,<y>@<frame>`, `key:<char>@<frame>` (a letter or digit), `resize:<w>x<h>@<frame>`,
            // `capture@<frame>` and `dump@<frame>`, separated by ';'.
            let parsed: Vec<(Injected, u64)> = std::env::var("SCRIPTC_HOST_INJECT")
                .unwrap_or_default()
                .split(';')
                .filter_map(|item| {
                    let (what, frame) = item.trim().rsplit_once('@')?;
                    let (frame, timed) = match frame.trim().strip_suffix("ms") {
                        Some(ms) => (ms, true),
                        None => (frame.trim(), false),
                    };
                    let frame: u64 = frame.parse::<u64>().ok()? | if timed { 1 << 63 } else { 0 };
                    if what.trim() == "capture" {
                        return Some((Injected::Capture, frame));
                    }
                    if what.trim() == "dump" {
                        return Some((Injected::Dump, frame));
                    }
                    if let Some(text) = what.strip_prefix("clicktext:") {
                        return Some((Injected::ClickText(text.trim().to_string()), frame));
                    }
                    if let Some(xy) = what.strip_prefix("click:") {
                        let (x, y) = xy.split_once(',')?;
                        return Some((Injected::Click(x.trim().parse().ok()?, y.trim().parse().ok()?), frame));
                    }
                    if let Some(size) = what.strip_prefix("resize:") {
                        let (w, h) = size.split_once('x')?;
                        return Some((Injected::Resize(w.trim().parse().ok()?, h.trim().parse().ok()?), frame));
                    }
                    for (prefix, down) in [("down:", true), ("up:", false)] {
                        if let Some(key) = what.strip_prefix(prefix) {
                            let (chars, code) = named_key(key.trim()).or_else(|| {
                                let c = key.trim().chars().next()?;
                                Some((c.to_string(), key_code_of(c)?))
                            })?;
                            return Some((Injected::KeyHeld(chars, code, down), frame));
                        }
                    }
                    let key = what.strip_prefix("key:")?;
                    if let Some((chars, code)) = named_key(key.trim()) {
                        return Some((Injected::Key(chars, code), frame));
                    }
                    let c = key.chars().next()?;
                    let code = key_code_of(c)?;
                    Some((Injected::Key(c.to_string(), code), frame))
                })
                .collect();
            let inject: Vec<(Injected, u64)> = parsed.iter().filter(|(_, f)| f >> 63 == 0).cloned().collect();
            let timed: Vec<(Injected, u64)> = parsed.iter().filter(|(_, f)| f >> 63 == 1).map(|(i, f)| (i.clone(), f & !(1 << 63))).collect();
            let number: isize = msg_send![window, windowNumber];
            let screen: Id = msg_send![window, screen];
            let main: Id = msg_send![class!(NSScreen), mainScreen];
            let screen_scale: f64 = if screen.is_null() { 0.0 } else { msg_send![screen, backingScaleFactor] };
            let main_scale: f64 = if main.is_null() { 0.0 } else { msg_send![main, backingScaleFactor] };
            eprintln!("scriptc-host window: screen scale {screen_scale}, main screen scale {main_scale}");
            eprintln!("scriptc-host window: {w}x{h} pt at scale {scale}, {}x{} px {format:?}, refresh {refresh_ms:.2} ms, window number {number}", config.width, config.height);
            Ok(Win {
                window,
                view,
                layer,
                surface,
                device,
                queue,
                config,
                points: (w, h),
                scale,
                display_link,
                activity,
                configured: Instant::now(),
                refresh_ms,
                input: VecDeque::new(),
                compositor,
                overlay: None,
                ui_gpu: None,
                ui_cpu: crate::config::var("UI_CPU").as_deref() == Ok("1"),
                offscreen: None,
                dirty: true,
                scene_presented: 0,
                frames: 0,
                frame_due: None,
                last_due: Instant::now(),
                ticking: false,
                close_requested: false,
                inject,
                timed,
                opened: Instant::now(),
                paint_ms: Vec::new(),
            })
        }
    }

    /// The display link's thread: note the refresh and wake the loop's sleep with an application-defined event (one
    /// in the queue at a time).
    unsafe extern "C" fn on_vsync(_link: *mut c_void, _now: *const c_void, _out: *const c_void, _flags: u64, _flags_out: *mut u64, _ctx: *mut c_void) -> i32 {
        let now = Instant::now();
        *VSYNC.lock().unwrap() = Some(now);
        {
            let mut iv = VSYNC_INTERVALS.lock().unwrap();
            if let Some(last) = iv.0.replace(now) {
                if iv.1.len() < 100_000 {
                    iv.1.push(now.duration_since(last).as_secs_f64() * 1000.0);
                }
            }
        }
        if !VSYNC_POSTED.swap(true, Ordering::AcqRel) {
            let app = APP.load(Ordering::Acquire);
            if !app.is_null() {
                objc2::rc::autoreleasepool(|_| unsafe {
                    let event: Id = msg_send![class!(NSEvent), otherEventWithType: APP_DEFINED, location: NSPoint::new(0.0, 0.0), modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: 0isize, context: std::ptr::null_mut::<AnyObject>(), subtype: VSYNC_SUBTYPE, data1: 0isize, data2: 0isize];
                    if !event.is_null() {
                        // NSApplication's postEvent may be called from other threads.
                        let _: () = msg_send![app, postEvent: event, atStart: false];
                    }
                });
                // The loop may be waiting on the workers rather than on AppKit's events.
                if let Some(waker) = MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                    waker.wake();
                }
            }
        }
        0
    }

    /// Drains AppKit events until `ms` from now (infinite: until one arrives) or until there is work.
    pub fn sleep(ms: f64) {
        if !is_open() {
            return;
        }
        let deadline = if ms.is_finite() { Some(Instant::now() + std::time::Duration::from_secs_f64(ms.max(0.0) / 1000.0)) } else { None };
        loop {
            if work_ready() || !is_open() || WOKEN.swap(false, Ordering::AcqRel) {
                return;
            }
            // The window's own tick (the display link silent) is a deadline too.
            let tick = silent_tick();
            let until = match (deadline, tick) {
                (Some(d), Some(t)) => Some(d.min(t)),
                (d, t) => d.or(t),
            };
            let wait = until.map(|d| d.saturating_duration_since(Instant::now()).as_secs_f64());
            if !pump_one(wait) {
                if tick_if_silent() || deadline.is_some_and(|d| Instant::now() >= d) {
                    return;
                }
            }
        }
    }

    /// The self-paced frame when it is due (no refresh for a refresh and a half): true when one was made due.
    fn tick_if_silent() -> bool {
        if !silent_tick().is_some_and(|t| Instant::now() >= t) {
            return false;
        }
        WIN.with(|w| {
            if let Some(w) = w.borrow_mut().as_mut() {
                w.frame_due = Some(timers::now_ms());
                w.last_due = Instant::now();
                w.ticking = true;
            }
        });
        true
    }

    /// The window's next self-paced frame: a refresh and a half after the display link's last, a refresh after its own.
    fn silent_tick() -> Option<Instant> {
        WIN.with(|w| {
            let w = w.borrow();
            let w = w.as_ref()?;
            let periods = if w.ticking { 1.0 } else { 1.5 };
            Some(w.last_due + std::time::Duration::from_secs_f64(w.refresh_ms * periods / 1000.0))
        })
    }

    /// One event (waiting up to `wait` seconds; None: until one arrives): handled; false when none came.
    fn pump_one(wait: Option<f64>) -> bool {
        let app = APP.load(Ordering::Acquire);
        objc2::rc::autoreleasepool(|_| unsafe {
            let until: Id = match wait {
                Some(s) => msg_send![class!(NSDate), dateWithTimeIntervalSinceNow: s],
                None => msg_send![class!(NSDate), distantFuture],
            };
            let mode = ns_string("kCFRunLoopDefaultMode");
            let event: Id = msg_send![app, nextEventMatchingMask: usize::MAX, untilDate: until, inMode: &*mode, dequeue: true];
            if event.is_null() {
                return false;
            }
            handle(app, event);
            true
        })
    }

    fn mods(flags: usize) -> Mods {
        Mods { shift: flags & (1 << 17) != 0, ctrl: flags & (1 << 18) != 0, alt: flags & (1 << 19) != 0, meta: flags & (1 << 20) != 0 }
    }

    unsafe fn rust_string(s: Id) -> String {
        if s.is_null() {
            return String::new();
        }
        let p: *const c_char = unsafe { msg_send![s, UTF8String] };
        if p.is_null() { String::new() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned() }
    }

    unsafe fn handle(app: Id, event: Id) {
        unsafe {
            let kind: usize = msg_send![event, type];
            if kind == APP_DEFINED {
                let subtype: i16 = msg_send![event, subtype];
                if subtype == WAKE_SUBTYPE {
                    return;
                }
                if subtype == VSYNC_SUBTYPE {
                    VSYNC_POSTED.store(false, Ordering::Release);
                    let at = VSYNC.lock().unwrap().take();
                    if let Some(at) = at {
                        let ts = timers::now_ms() - at.elapsed().as_secs_f64() * 1000.0;
                        WIN.with(|w| {
                            if let Some(w) = w.borrow_mut().as_mut() {
                                w.frame_due = Some(ts);
                                w.last_due = Instant::now();
                                w.ticking = false;
                            }
                        });
                    }
                    return;
                }
            }
            let ours = WIN.with(|w| w.borrow().as_ref().map(|w| (w.window, w.view, w.points.1)));
            let Some((window, view, height)) = ours else {
                let _: () = msg_send![app, sendEvent: event];
                return;
            };
            let event_window: Id = msg_send![event, window];
            let flags: usize = msg_send![event, modifierFlags];
            match kind {
                KEY_DOWN | KEY_UP if event_window == window => {
                    let key_code: u16 = msg_send![event, keyCode];
                    let m = mods(flags);
                    let chars: Id = if m.ctrl || m.meta { msg_send![event, charactersIgnoringModifiers] } else { msg_send![event, characters] };
                    let chars = rust_string(chars);
                    let repeat: bool = if kind == KEY_DOWN { msg_send![event, isARepeat] } else { false };
                    let (key, code) = key_names(key_code, &chars);
                    push(Input::Key { down: kind == KEY_DOWN, key, code, mods: m, repeat });
                    // Not sent on: no responder takes it (AppKit would beep).
                    return;
                }
                LEFT_DOWN | LEFT_UP | RIGHT_DOWN | RIGHT_UP | MOVED | LEFT_DRAGGED | RIGHT_DRAGGED | OTHER_DOWN | OTHER_UP | OTHER_DRAGGED | SCROLL if event_window == window => {
                    let at: NSPoint = msg_send![event, locationInWindow];
                    let p: NSPoint = msg_send![view, convertPoint: at, fromView: std::ptr::null_mut::<AnyObject>()];
                    let (x, y) = (p.x, height - p.y);
                    let inside = x >= 0.0 && y >= 0.0 && y <= height;
                    let number: isize = msg_send![event, buttonNumber];
                    // AppKit's 0 left, 1 right, 2 middle; the DOM's 0 main, 1 auxiliary, 2 secondary.
                    let button = match number {
                        1 => 2,
                        2 => 1,
                        n => n as i16,
                    };
                    let pressed: usize = msg_send![class!(NSEvent), pressedMouseButtons];
                    let buttons = ((pressed & 1) | ((pressed & 2) << 0) | (pressed & 4)) as u16;
                    let m = mods(flags);
                    let kind = match kind {
                        LEFT_DOWN | RIGHT_DOWN | OTHER_DOWN => Some(PointerKind::Down),
                        LEFT_UP | RIGHT_UP | OTHER_UP => Some(PointerKind::Up),
                        SCROLL => {
                            let dx: f64 = msg_send![event, scrollingDeltaX];
                            let dy: f64 = msg_send![event, scrollingDeltaY];
                            let precise: bool = msg_send![event, hasPreciseScrollingDeltas];
                            let k = if precise { 1.0 } else { 16.0 };
                            Some(PointerKind::Wheel { dx: -dx * k, dy: -dy * k })
                        }
                        _ => Some(PointerKind::Move),
                    };
                    if let Some(kind) = kind.filter(|k| inside || matches!(k, PointerKind::Up)) {
                        push(Input::Pointer { kind, x, y, button, buttons, mods: m, touch: None });
                    }
                }
                _ => {}
            }
            let _: () = msg_send![app, sendEvent: event];
        }
    }

    fn push(input: Input) {
        WIN.with(|w| {
            if let Some(w) = w.borrow_mut().as_mut() {
                w.input.push_back(input);
            }
        })
    }

    /// The DOM's `key` and `code` for a macOS virtual key code (a US layout's physical keys) and its characters.
    fn key_names(code: u16, chars: &str) -> (String, String) {
        let named = |k: &str| Some(k.to_string());
        let key = match code {
            36 | 76 => named("Enter"),
            48 => named("Tab"),
            49 => named(" "),
            51 => named("Backspace"),
            53 => named("Escape"),
            117 => named("Delete"),
            123 => named("ArrowLeft"),
            124 => named("ArrowRight"),
            125 => named("ArrowDown"),
            126 => named("ArrowUp"),
            115 => named("Home"),
            119 => named("End"),
            116 => named("PageUp"),
            121 => named("PageDown"),
            56 | 60 => named("Shift"),
            59 | 62 => named("Control"),
            58 | 61 => named("Alt"),
            55 | 54 => named("Meta"),
            57 => named("CapsLock"),
            122 => named("F1"),
            120 => named("F2"),
            99 => named("F3"),
            118 => named("F4"),
            _ => None,
        }
        .unwrap_or_else(|| if chars.is_empty() { "Unidentified".into() } else { chars.to_string() });
        const LETTERS: &[(u16, &str)] = &[
            (0, "KeyA"), (11, "KeyB"), (8, "KeyC"), (2, "KeyD"), (14, "KeyE"), (3, "KeyF"), (5, "KeyG"), (4, "KeyH"), (34, "KeyI"),
            (38, "KeyJ"), (40, "KeyK"), (37, "KeyL"), (46, "KeyM"), (45, "KeyN"), (31, "KeyO"), (35, "KeyP"), (12, "KeyQ"), (15, "KeyR"),
            (1, "KeyS"), (17, "KeyT"), (32, "KeyU"), (9, "KeyV"), (13, "KeyW"), (7, "KeyX"), (16, "KeyY"), (6, "KeyZ"),
            (29, "Digit0"), (18, "Digit1"), (19, "Digit2"), (20, "Digit3"), (21, "Digit4"), (23, "Digit5"), (22, "Digit6"), (26, "Digit7"),
            (28, "Digit8"), (25, "Digit9"), (36, "Enter"), (76, "NumpadEnter"), (48, "Tab"), (49, "Space"), (51, "Backspace"), (53, "Escape"),
            (117, "Delete"), (123, "ArrowLeft"), (124, "ArrowRight"), (125, "ArrowDown"), (126, "ArrowUp"), (115, "Home"), (119, "End"),
            (116, "PageUp"), (121, "PageDown"), (56, "ShiftLeft"), (60, "ShiftRight"), (59, "ControlLeft"), (62, "ControlRight"),
            (58, "AltLeft"), (61, "AltRight"), (55, "MetaLeft"), (54, "MetaRight"), (57, "CapsLock"), (27, "Minus"), (24, "Equal"),
            (33, "BracketLeft"), (30, "BracketRight"), (42, "Backslash"), (41, "Semicolon"), (39, "Quote"), (50, "Backquote"),
            (43, "Comma"), (47, "Period"), (44, "Slash"), (122, "F1"), (120, "F2"), (99, "F3"), (118, "F4"),
        ];
        let code = LETTERS.iter().find(|(c, _)| *c == code).map_or("Unidentified", |(_, n)| n).to_string();
        (key, code)
    }

    /// The loop turn's share (timers::run_due): pending events drained, input dispatched, the refresh's frame
    /// callbacks run and the frame composited. Callbacks that throw are reported there and the page goes on, so this
    /// answers false (the signature keeps run_due's "threw" contract).
    /// SCRIPTC_HOST_TRACE=1, read once (each frame asks).
    fn frame_trace() -> bool {
        static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE").is_some())
    }

    pub fn turn() -> bool {
        if !is_open() {
            return false;
        }
        while pump_one(Some(0.0)) {}
        // A busy loop never sleeps: a silent display link's frames are made due here too.
        tick_if_silent();
        // The window closed (its close button) or was resized.
        if !watch() {
            return false;
        }
        loop {
            let next = WIN.with(|w| w.borrow_mut().as_mut().and_then(|w| w.input.pop_front()));
            let Some(input) = next else { break };
            WIN.with(|w| {
                if let Some(w) = w.borrow_mut().as_mut() {
                    w.dirty = true;
                }
            });
            // Listeners that throw are reported by the dispatch; an Err here is the host's own.
            if let Err(e) = dom::input(&input) {
                eprintln!("scriptc-host window: input dispatch: {e}");
            }
        }
        if WIN.with(|w| w.borrow().as_ref().is_some_and(|w| w.close_requested)) {
            close(true);
            return false;
        }
        let due = WIN.with(|w| w.borrow_mut().as_mut().and_then(|w| w.frame_due.take()));
        if let Some(ts) = due {
            let ran = timers::frames_waiting();
            let t0 = Instant::now();
            timers::run_frames(ts);
            // Resize and mutation observers, after the frame's callbacks and a layout pass.
            crate::observers::deliver();
            let t1 = Instant::now();
            render(ran);
            // Injections timed in milliseconds (`@<n>ms`), for a page that presents only when it changes.
            let timed = WIN.with(|w| {
                let mut w = w.borrow_mut();
                let w = w.as_mut()?;
                let elapsed = w.opened.elapsed().as_millis() as u64;
                let (due, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut w.timed).into_iter().partition(|(_, at)| *at <= elapsed);
                w.timed = rest;
                (!due.is_empty()).then(|| (w.window, w.view, w.points.1, due.into_iter().map(|(i, _)| i).collect::<Vec<_>>()))
            });
            if let Some((window, view, height, due)) = timed {
                run_due(window, view, height, due);
            }
            if frame_trace() {
                let frames = WIN.with(|w| w.borrow().as_ref().map_or(0, |w| w.frames));
                if frames % 600 == 0 && let Some(report) = crate::layer::get().trace_report() {
                    eprintln!("gpu at frame {frames}: {report}");
                    if frames % 3000 == 0 {
                        eprintln!("gpu formats: {}", gpu_stream_wgpu::census::by_format());
                        for kind in [gpu_stream_wgpu::census::Kind::TexCompressed, gpu_stream_wgpu::census::Kind::TexTarget, gpu_stream_wgpu::census::Kind::TexDepth] {
                            for e in gpu_stream_wgpu::census::largest_of(kind, 8) {
                                eprintln!("  {:?} {:.1} MB {}", e.kind, e.bytes as f64 / 1048576.0, e.what);
                            }
                        }
                    }
                }
                eprintln!("frame at {ts:.2}: callbacks {:.2} ms, composite {:.2} ms, late {:.2} ms, scene {}", (t1 - t0).as_secs_f64() * 1e3, t1.elapsed().as_secs_f64() * 1e3, timers::now_ms() - ts, crate::relay::scenes());
            }
        }
        false
    }

    /// Notices a close (the window is no longer visible) and a resize. False once closed.
    fn watch() -> bool {
        let state = WIN.with(|w| w.borrow().as_ref().map(|w| (w.window, w.view, w.points)));
        let Some((window, view, points)) = state else { return false };
        unsafe {
            let visible: bool = msg_send![window, isVisible];
            if !visible {
                close(false);
                return false;
            }
            let frame: NSRect = msg_send![view, frame];
            let scale: f64 = msg_send![window, backingScaleFactor];
            let size = (frame.size.width, frame.size.height);
            let current = WIN.with(|w| w.borrow().as_ref().map_or(scale, |w| w.scale));
            if size != points || scale != current {
                let (pw, ph) = (((size.0 * scale).round() as u32).max(1), ((size.1 * scale).round() as u32).max(1));
                WIN.with(|w| {
                    if let Some(w) = w.borrow_mut().as_mut() {
                        w.points = size;
                        w.scale = scale;
                        w.config.width = pw;
                        w.config.height = ph;
                        let _: () = msg_send![w.layer, setContentsScale: scale];
                        w.surface.configure(&w.device, &w.config);
                        w.dirty = true;
                    }
                });
                crate::layer::get().resize(pw, ph);
                dom::set_viewport(pw, ph, scale as f32);
                // The window's resize event (it does not bubble; listeners on the window hear it).
                dom::fire_window_event("resize");
            }
        }
        true
    }

    /// The page ends: the capture (for `window.close()`), the window and the display link gone, the timers dropped.
    fn close(capture: bool) {
        if capture {
            if let Ok(path) = std::env::var("SCRIPTC_HOST_CAPTURE") {
                render_into(true, Some(path));
            }
        }
        let Some(win) = WIN.with(|w| w.borrow_mut().take()) else { return };
        CLOSED.with(|c| c.set(true));
        unsafe {
            if !win.display_link.is_null() {
                CVDisplayLinkStop(win.display_link);
                CVDisplayLinkRelease(win.display_link);
            }
            if !win.activity.is_null() {
                let info: Id = msg_send![class!(NSProcessInfo), processInfo];
                let _: () = msg_send![info, endActivity: win.activity];
                let _: () = msg_send![win.activity, release];
            }
            let _: () = msg_send![win.window, orderOut: std::ptr::null_mut::<AnyObject>()];
            let _: () = msg_send![win.window, close];
        }
        let n = win.paint_ms.len();
        if n > 0 {
            let mut p = win.paint_ms.clone();
            p.sort_by(|a, b| a.total_cmp(b));
            let mut v = VSYNC_INTERVALS.lock().unwrap().1.clone();
            v.sort_by(|a, b| a.total_cmp(b));
            let q = |v: &[f64], f: f64| if v.is_empty() { 0.0 } else { v[((v.len() as f64 * f) as usize).min(v.len() - 1)] };
            eprintln!(
                "scriptc-host window: closed after {} frames; document paint p50 {:.2} ms p95 {:.2} ms ({} paints); display link {} callbacks, interval p50 {:.2} p95 {:.2} ms (refresh {:.2} ms)",
                win.frames, p[n / 2], p[(n * 95 / 100).min(n - 1)], n, v.len() + 1, q(&v, 0.5), q(&v, 0.95), win.refresh_ms
            );
        }
        timers::clear_all();
    }

    fn render(callbacks_ran: bool) {
        render_into(callbacks_ran, None);
    }

    /// Composites and presents when anything may have changed: the document repainted, the scene over it.
    /// The document's GPU painter and the overlay it paints (Vello's storage format, sized to the window), taken out of
    /// the window for the paint, and whether the overlay is new (painted whole). None paints on the CPU: <PREFIX>UI_CPU=1,
    /// or a painter that could not be made (reported once).
    fn gpu_ui(pw: u32, ph: u32) -> Option<(blitz_ui::gpu_paint::GpuUiPainter, wgpu::Texture, bool)> {
        WIN.with(|w| {
            let mut w = w.borrow_mut();
            let w = w.as_mut()?;
            if w.ui_cpu {
                return None;
            }
            let painter = match w.ui_gpu.take() {
                Some(p) => p,
                None => match blitz_ui::gpu_paint::GpuUiPainter::new(&w.device, &w.queue) {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("scriptc-host window: the document paints on the CPU ({e})");
                        w.ui_cpu = true;
                        return None;
                    }
                },
            };
            let fits = w.overlay.as_ref().is_some_and(|(t, ow, oh)| *ow == pw && *oh == ph && t.usage().contains(blitz_ui::gpu_paint::TARGET_USAGE));
            if !fits {
                let t = w.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("scriptc-host document"),
                    size: wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: blitz_ui::gpu_paint::TARGET_FORMAT,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | blitz_ui::gpu_paint::TARGET_USAGE,
                    view_formats: &[],
                });
                w.overlay = Some((t, pw, ph));
            }
            let overlay = w.overlay.as_ref().map(|(t, _, _)| t.clone())?;
            Some((painter, overlay, !fits))
        })
    }

    fn render_into(callbacks_ran: bool, capture: Option<String>) {
        // The attached canvas sizes the layer's scene (its drawing buffer) and places it (its box),
        // composites it.
        let canvas = crate::layer::get().canvas_frame();
        let scene = crate::layer::get().scene();
        if crate::relay::trace() {
            thread_local! { static TURNS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; }
            let n = TURNS.with(|t| { t.set(t.get() + 1); t.get() });
            if n % 600 == 1 {
                eprintln!("relay: composite {n}: canvas {:?}, scene {:?}", canvas, scene.as_ref().map(|s| (s.presented, s.width, s.height)));
            }
        }
        crate::modules::deliver_loads();
        let document_changed = dom::take_dirty();
        let go = WIN.with(|w| {
            let mut w = w.borrow_mut();
            let Some(w) = w.as_mut() else { return false };
            let scene_new = scene.as_ref().is_some_and(|s| s.presented != w.scene_presented);
            w.dirty || document_changed || scene_new || callbacks_ran || capture.is_some()
        });
        if !go {
            return;
        }
        let (pw, ph, scale, changed) = WIN.with(|w| {
            let w = w.borrow();
            let Some(w) = w.as_ref() else { return (1, 1, 1.0, true) };
            let (pw, ph) = (w.config.width, w.config.height);
            let fits = w.overlay.as_ref().is_some_and(|(_, ow, oh)| *ow == pw && *oh == ph);
            (pw, ph, w.scale, w.dirty || document_changed || capture.is_some() || !fits)
        });
        let t = Instant::now();
        // On the GPU the document paints straight into the overlay (only what changed); on the CPU it comes back as
        // pixels to upload.
        let (rgba, gpu_painted) = match gpu_ui(pw, ph) {
            Some((mut painter, overlay, fresh)) => {
                let now = crate::timers::now_ms() / 1000.0;
                let painted = crate::dom::with_document_quiet(|doc| {
                    if fresh {
                        doc.track_paint_damage(true);
                    }
                    if !(changed || fresh || doc.is_animating()) {
                        return false;
                    }
                    let (damage, _) = painter.paint_damage(doc, &overlay, scale as f32, now, fresh);
                    !matches!(damage, blitz_ui::PaintDamage::None)
                });
                // What painting itself marked (layout's own reads) is in this paint.
                dom::take_dirty();
                WIN.with(|w| {
                    if let Some(w) = w.borrow_mut().as_mut() {
                        w.ui_gpu = Some(painter);
                    }
                });
                (None, Some(painted))
            }
            None => (super::compose::document_pixels(changed, scale, pw, ph), None),
        };
        let paint_ms = t.elapsed().as_secs_f64() * 1000.0;
        let inject = WIN.with(|w| {
            let mut w = w.borrow_mut();
            let w = w.as_mut()?;
            if rgba.is_some() || gpu_painted == Some(true) {
                w.paint_ms.push(paint_ms);
            }
            w.dirty = false;
            if let Some(s) = &scene {
                w.scene_presented = s.presented;
            }
            let t_acquire = Instant::now();
            let frame = match w.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => Some(f),
                other => {
                    if w.offscreen.is_none() {
                        eprintln!("scriptc-host window: no surface texture (the display asleep?): composing offscreen until there is");
                    }
                    // A stale surface is configured again at once; an occluded one (the display asleep, the window
                    // covered) comes back as it was, so it is configured once a second at most: each frame cost 14 ms.
                    let stale = matches!(other, wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost);
                    if stale || w.configured.elapsed().as_secs_f64() >= 1.0 {
                        w.surface.configure(&w.device, &w.config);
                        w.configured = Instant::now();
                    }
                    None
                }
            };
            let texture = match &frame {
                Some(f) => f.texture.clone(),
                None => {
                    let fits = w.offscreen.as_ref().is_some_and(|t| t.width() == pw && t.height() == ph);
                    if !fits {
                        w.offscreen = Some(w.device.create_texture(&wgpu::TextureDescriptor {
                            label: Some("scriptc-host offscreen frame"),
                            size: wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                            mip_level_count: 1,
                            sample_count: 1,
                            dimension: wgpu::TextureDimension::D2,
                            format: w.config.format,
                            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                            view_formats: &[],
                        }));
                    }
                    w.offscreen.clone().unwrap()
                }
            };
            if frame_trace() {
                let painted = if rgba.is_some() || gpu_painted == Some(true) { format!("paint {paint_ms:.2} ms") } else { "paint kept".to_string() };
                let to = if frame.is_some() { "presented" } else { "offscreen" };
                eprintln!("  {painted}, acquire {:.2} ms, {to}", t_acquire.elapsed().as_secs_f64() * 1e3);
            }
            let overlay = match &w.overlay {
                Some((t, ow, oh)) if *ow == pw && *oh == ph => t.clone(),
                _ => {
                    let t = w.device.create_texture(&wgpu::TextureDescriptor {
                        label: Some("scriptc-host document"),
                        size: wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                        view_formats: &[],
                    });
                    w.overlay = Some((t.clone(), pw, ph));
                    t
                }
            };
            if let Some(rgba) = &rgba {
                w.queue.write_texture(
                    wgpu::TexelCopyTextureInfo { texture: &overlay, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                    rgba,
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(pw * 4), rows_per_image: Some(ph) },
                    wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                );
            }
            let target = texture.create_view(&Default::default());
            let bind = |view: &wgpu::TextureView| {
                w.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &w.compositor.layout,
                    entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&w.compositor.sampler) }],
                })
            };
            let scene_group = scene.as_ref().map(|s| bind(&s.texture.create_view(&wgpu::TextureViewDescriptor { format: Some(s.format.remove_srgb_suffix()), ..Default::default() })));
            let overlay_group = bind(&overlay.create_view(&Default::default()));
            let mut encoder = w.device.create_command_encoder(&Default::default());
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scriptc-host composite"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::WHITE), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                if let Some(g) = &scene_group {
                    // In the canvas's box (clipped to the frame), else the whole frame.
                    let placed = canvas.map(|(_, [x, y, cw, ch])| {
                        let (x0, y0) = (x.clamp(0.0, pw as f32), y.clamp(0.0, ph as f32));
                        (x0, y0, (x + cw).min(pw as f32) - x0, (y + ch).min(ph as f32) - y0)
                    });
                    if let Some((x, y, vw, vh)) = placed.filter(|&(_, _, vw, vh)| vw > 0.0 && vh > 0.0) {
                        pass.set_viewport(x, y, vw, vh, 0.0, 1.0);
                    }
                    pass.set_pipeline(&w.compositor.opaque);
                    pass.set_bind_group(0, g, &[]);
                    pass.draw(0..3, 0..1);
                    pass.set_viewport(0.0, 0.0, pw as f32, ph as f32, 0.0, 1.0);
                }
                pass.set_pipeline(if gpu_painted.is_some() { &w.compositor.over_straight } else { &w.compositor.over });
                pass.set_bind_group(0, &overlay_group, &[]);
                pass.draw(0..3, 0..1);
            }
            let readback = capture.as_ref().filter(|_| texture.usage().contains(wgpu::TextureUsages::COPY_SRC)).map(|_| {
                let row = (pw * 4).div_ceil(256) * 256;
                let buffer = w.device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (row * ph) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
                encoder.copy_texture_to_buffer(
                    texture.as_image_copy(),
                    wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(ph) } },
                    wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                );
                (buffer, row)
            });
            w.queue.submit([encoder.finish()]);
            if let (Some((buffer, row)), Some(path)) = (readback, capture.as_ref()) {
                let slice = buffer.slice(..);
                slice.map_async(wgpu::MapMode::Read, |_| {});
                let _ = w.device.poll(wgpu::PollType::wait_indefinitely());
                let bgra = w.config.format == wgpu::TextureFormat::Bgra8Unorm;
                if let Ok(data) = slice.get_mapped_range() {
                    let mut out = Vec::with_capacity((pw * ph * 4) as usize);
                    for y in 0..ph as usize {
                        let r = &data[y * row as usize..y * row as usize + pw as usize * 4];
                        for px in r.chunks_exact(4) {
                            if bgra { out.extend_from_slice(&[px[2], px[1], px[0], 255]) } else { out.extend_from_slice(&[px[0], px[1], px[2], 255]) }
                        }
                    }
                    match write_png(path, pw, ph, &out) {
                        Ok(()) => eprintln!("scriptc-host window: captured {pw}x{ph} to {path}"),
                        Err(e) => eprintln!("scriptc-host window: capture failed: {e}"),
                    }
                }
            }
            if let Some(frame) = frame {
                w.queue.present(frame);
            }
            w.frames += 1;
            let frames = w.frames;
            let due: Vec<Injected> = w.inject.iter().filter(|(_, at)| frames == *at).map(|(i, _)| i.clone()).collect();
            Some((w.window, w.view, w.points.1, due))
        });
        if let Some((window, view, height, due)) = inject {
            run_due(window, view, height, due);
        }
    }

    /// Posts what an injection is due to do (`SCRIPTC_HOST_INJECT`): input through the real event queue, captures, dumps.
    fn run_due(window: Id, view: Id, height: f64, due: Vec<Injected>) {
        for i in due {
            match i {
                Injected::Click(x, y) => unsafe { post_click(window, view, height, x, y) },
                Injected::ClickText(text) => match dom::text_center(&text) {
                    Some((x, y)) => unsafe { post_click(window, view, height, x, y) },
                    None => eprintln!("scriptc-host window: no element with the text {text:?} to click"),
                },
                Injected::Key(chars, code) => unsafe { post_key(window, &chars, code) },
                Injected::KeyHeld(chars, code, down) => unsafe { post_key_edge(window, &chars, code, down) },
                Injected::Resize(w, h) => unsafe {
                    let _: () = msg_send![window, setContentSize: NSSize::new(w, h)];
                    eprintln!("scriptc-host window: resized the content to {w}x{h}");
                },
                Injected::Capture => {
                    if let Ok(path) = std::env::var("SCRIPTC_HOST_CAPTURE") {
                        render_into(true, Some(path));
                    }
                }
                Injected::Dump => {
                    if let Ok(path) = std::env::var("SCRIPTC_HOST_CAPTURE") {
                        let path = format!("{path}.html");
                        match std::fs::write(&path, dom::document_html()) {
                            Ok(()) => eprintln!("scriptc-host window: dumped the document to {path}"),
                            Err(e) => eprintln!("scriptc-host window: dump {path}: {e}"),
                        }
                    }
                }
            }
        }
    }

    /// The virtual key code of a letter or digit (a US layout), the reverse of [`key_names`]' table.
    fn key_code_of(c: char) -> Option<u16> {
        const KEYS: &str = "asdfhgzxcv bqweryt123465=97-80]ou[ip lj'k;\\,/nm.";
        let c = c.to_ascii_lowercase();
        KEYS.chars().position(|k| k == c && k != ' ').map(|i| i as u16)
    }

    /// The named keys the injector knows (`key:Escape`, `down:Space`): characters and macOS virtual key code.
    fn named_key(name: &str) -> Option<(String, u16)> {
        let (chars, code) = match name {
            "Escape" => ("\u{1b}", 53),
            "Tab" => ("\t", 48),
            "Space" => (" ", 49),
            "Enter" => ("\r", 36),
            _ => return None,
        };
        Some((chars.to_string(), code))
    }

    /// One edge of a held key (`down:` or `up:`), posted to the window's event queue.
    unsafe fn post_key_edge(window: Id, chars: &str, code: u16, down: bool) {
        unsafe {
            let app = APP.load(Ordering::Acquire);
            let number: isize = msg_send![window, windowNumber];
            let s = ns_string(chars);
            let kind = if down { KEY_DOWN } else { KEY_UP };
            let event: Id = msg_send![class!(NSEvent), keyEventWithType: kind, location: NSPoint::new(0.0, 0.0), modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: number, context: std::ptr::null_mut::<AnyObject>(), characters: &*s, charactersIgnoringModifiers: &*s, isARepeat: false, keyCode: code];
            if !event.is_null() {
                let _: () = msg_send![app, postEvent: event, atStart: false];
            }
            eprintln!("scriptc-host window: key {chars:?} (key code {code}) {}", if down { "down" } else { "up" });
        }
    }

    /// A key press posted to the window's event queue (down, then up).
    unsafe fn post_key(window: Id, chars: &str, code: u16) {
        unsafe {
            let app = APP.load(Ordering::Acquire);
            let number: isize = msg_send![window, windowNumber];
            let s = ns_string(chars);
            for kind in [KEY_DOWN, KEY_UP] {
                let event: Id = msg_send![class!(NSEvent), keyEventWithType: kind, location: NSPoint::new(0.0, 0.0), modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: number, context: std::ptr::null_mut::<AnyObject>(), characters: &*s, charactersIgnoringModifiers: &*s, isARepeat: false, keyCode: code];
                if !event.is_null() {
                    let _: () = msg_send![app, postEvent: event, atStart: false];
                }
            }
            eprintln!("scriptc-host window: posted key {chars:?} (key code {code})");
        }
    }

    /// A left click at CSS px (x, y): a mouse down and up posted to the window's event queue (the real input path).
    unsafe fn post_click(window: Id, view: Id, height: f64, x: f64, y: f64) {
        unsafe {
            let app = APP.load(Ordering::Acquire);
            let in_view = NSPoint::new(x, height - y);
            let at: NSPoint = msg_send![view, convertPoint: in_view, toView: std::ptr::null_mut::<AnyObject>()];
            let number: isize = msg_send![window, windowNumber];
            for kind in [LEFT_DOWN, LEFT_UP] {
                let event: Id = msg_send![class!(NSEvent), mouseEventWithType: kind, location: at, modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: number, context: std::ptr::null_mut::<AnyObject>(), eventNumber: 0isize, clickCount: 1isize, pressure: 1.0f32];
                if !event.is_null() {
                    let _: () = msg_send![app, postEvent: event, atStart: false];
                }
            }
            eprintln!("scriptc-host window: posted a click at ({x}, {y})");
        }
    }

    #[allow(dead_code)]
    pub fn closed() -> bool {
        CLOSED.with(|c| c.get())
    }
}
