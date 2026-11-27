//! The window on Android: libmatoya's (its Activity, `native/android`, loads libmain.so and calls the program's
//! `main` on a thread of its own), the GPU device made for its `ANativeWindow`'s Vulkan surface, the document painted on
//! the CPU and composited over the program's scene as on macOS (window.rs `compose`), and touches dispatched into the
//! document as pointer input.
//!
//! The program's event loop stays the owner, as on macOS: libmatoya's `MTY_AppRun` is a loop that drains the event
//! queue Java fills and calls the app function, so an app function that answers false after one pass makes it one pump
//! ([`pump`]). The loop's sleep pumps until there is work: input to dispatch, or the next frame, paced at the display's
//! refresh rate (there is no display link; the surface presents with Mailbox).
//! The surface Java replaces on rotation, or destroys on pause, is not followed yet (a host
//! `follow_window` does it).

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::ffi::{CString, c_void};
use std::time::{Duration, Instant};

use gpu_stream_wgpu::wgpu;
use matoya_sys as mty;

use super::compose::{Compositor, compositor};
use crate::dom::{self, Input, Mods, PointerKind};
use crate::timers;

/// Window 0 is the only window.
const WINDOW: mty::MTY_Window = 0;

#[link(name = "android")]
unsafe extern "C" {
    fn ANativeWindow_acquire(window: *mut c_void);
    fn ANativeWindow_release(window: *mut c_void);
}

struct Win {
    app: *mut mty::MTY_App,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    scale: f64,
    refresh_ms: f64,
    next_frame: Instant,
    input: VecDeque<Input>,
    compositor: Compositor,
    overlay: Option<(wgpu::Texture, u32, u32)>,
    dirty: bool,
    scene_presented: u64,
    frames: u64,
    frame_due: Option<f64>,
    close_requested: bool,
    /// The size libmatoya last reported, to notice a resize.
    size: (u32, u32),
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    /// The ANativeWindow the surface draws into (one reference ours), to follow Java replacing it.
    native: *mut c_void,
    /// Java destroyed the window (the app went to the background): the surface is dead, so nothing configures or
    /// presents on it until a new window is followed.
    gone: bool,
    /// The document's painter on this window's device (blitz-ui gpu_paint, as the Mac and Windows windows paint), until
    /// it fails or <PREFIX>UI_CPU=1. The CPU raster at the phone's full resolution was most of a frame.
    ui_gpu: Option<blitz_ui::gpu_paint::GpuUiPainter>,
    /// The GPU painter is not used: <PREFIX>UI_CPU=1, or it could not be made.
    ui_cpu: bool,
    /// Whether the soft keyboard was last asked to show (it does while a text field or editing host has the focus).
    keyboard: bool,
    /// Typed text waiting for its key event (libmatoya sends the text first), and the DOM key each held key went down
    /// as (its release says the same).
    typed: Option<String>,
    held_keys: std::collections::HashMap<u32, (String, String)>,
}

thread_local! {
    static WIN: RefCell<Option<Win>> = const { RefCell::new(None) };
    static TRIED: Cell<bool> = const { Cell::new(false) };
    /// Events the pump took off libmatoya's queue, translated, for the turn to dispatch.
    static EVENTS: RefCell<Vec<Event>> = const { RefCell::new(Vec::new()) };
}

enum Event {
    Touch { id: i32, x: i32, y: i32, phase: i32 },
    Button { pressed: bool, x: i32, y: i32 },
    Motion { x: i32, y: i32 },
    Size,
    Close,
    /// A key pressed or released (libmatoya's MTY_Key, its MTY_Mod), the soft keyboard's included.
    Key { key: u32, mods: u32, pressed: bool },
    /// Text the keyboard typed (UTF-8): it comes just before the key event of the same press, if that key has one.
    Text(String),
}

/// Opens the window once (the GPU and the document call this first). On Android there is always a window, the
/// Activity's, unless SCRIPTC_HOST_WINDOW=0 runs the program headless (a fixture, with the screen off).
pub fn ensure() {
    // The window is the main thread's (render_thread.rs `is_main_thread`, as on macOS and Windows): a render thread (a
    // threaded program) never opens one. Its GPU stream draws on the window's device (relay.rs); opened there, the
    // window lived on the render thread and the main thread, which composites, never presented a frame.
    if !crate::render_thread::is_main_thread() {
        return;
    }
    if TRIED.with(|t| t.replace(true)) || std::env::var_os("SCRIPTC_HOST_WINDOW").is_some_and(|v| v == "0") {
        return;
    }
    // libmatoya enters the JVM here (the app, the window, its scale and rate), and ART faults when that happens on a
    // compiled async function's fiber stack (the first viewport or GPU read can come from one): on a fiber, the
    // window opens on a thread with a stack of its own.
    let opened = if crate::abi::on_fiber() {
        struct Opened(Result<Win, String>);
        // SAFETY: the window's handles are made there and used only here afterwards, one thread at a time.
        unsafe impl Send for Opened {}
        std::thread::scope(|s| s.spawn(|| Opened(unsafe { open() })).join().map(|o| o.0).unwrap_or_else(|_| Err("the window thread panicked".into())))
    } else {
        unsafe { open() }
    };
    match opened {
        Ok(win) => {
            if frame_trace() {
                eprintln!("scriptc-host window: opened on {:?} (main thread: {})", std::thread::current().id(), crate::render_thread::is_main_thread());
            }
            WIN.with(|s| *s.borrow_mut() = Some(win));
            *MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::modules::waker());
        }
        Err(e) => eprintln!("scriptc-host window: {e}"),
    }
}

/// While the window is open, the longest the loop may wait on anything else: until its next frame.
pub fn frame_wait_ms() -> Option<f64> {
    WIN.with(|w| w.borrow().as_ref().map(|w| w.next_frame.saturating_duration_since(Instant::now()).as_secs_f64() * 1000.0))
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

/// Input to dispatch or a frame to run: the loop turns now.
pub fn work_ready() -> bool {
    let events = EVENTS.with(|e| !e.borrow().is_empty());
    events || WIN.with(|w| w.borrow().as_ref().is_some_and(|w| !w.input.is_empty() || w.frame_due.is_some() || w.close_requested))
}

/// navigator.wakeLock (page.rs): the screen stays on while the page holds the lock (FLAG_KEEP_SCREEN_ON through
/// libmatoya), and sleeps by the system's timeout again once it lets go. Before the window opens there is nothing to
/// hold; the page asks again.
pub fn stay_awake(on: bool) {
    WIN.with(|w| {
        if let Some(w) = w.borrow().as_ref() {
            // SAFETY: the app libmatoya made for this window, on its own thread.
            unsafe { mty::MTY_AppStayAwake(w.app, on) };
        }
    })
}

/// `window.close()`: the next turn closes the page.
pub fn request_close() {
    WIN.with(|w| {
        if let Some(w) = w.borrow_mut().as_mut() {
            w.close_requested = true;
        }
    })
}

/// A reload (page.rs `location`): nothing here yet (Windows starts the program again: window_windows.rs).
pub fn reload() {}

unsafe extern "C" fn app_once(_opaque: *mut c_void) -> bool {
    false
}

unsafe extern "C" fn on_event(evt: *const mty::MTY_Event, _opaque: *mut c_void) {
    let e = unsafe { &*evt };
    let u = &e.__bindgen_anon_1;
    let event = unsafe {
        match e.type_ {
            mty::MTY_EVENT_TOUCH => Some(Event::Touch { id: u.touch.id, x: u.touch.x, y: u.touch.y, phase: u.touch.phase }),
            mty::MTY_EVENT_BUTTON if u.button.button as u32 == mty::MTY_BUTTON_LEFT as u32 => Some(Event::Button { pressed: u.button.pressed, x: u.button.x, y: u.button.y }),
            mty::MTY_EVENT_MOTION => Some(Event::Motion { x: u.motion.x, y: u.motion.y }),
            mty::MTY_EVENT_SIZE => Some(Event::Size),
            mty::MTY_EVENT_CLOSE | mty::MTY_EVENT_QUIT => Some(Event::Close),
            mty::MTY_EVENT_KEY => Some(Event::Key { key: u.key.key as u32, mods: u.key.mod_ as u32, pressed: u.key.pressed }),
            mty::MTY_EVENT_TEXT => {
                let text = std::ffi::CStr::from_ptr(u.text.as_ptr()).to_string_lossy().into_owned();
                (!text.is_empty()).then_some(Event::Text(text))
            }
            _ => None,
        }
    };
    if let Some(event) = event {
        EVENTS.with(|q| q.borrow_mut().push(event));
    }
}

/// One pass of libmatoya's loop: Java's queued events delivered (to [`on_event`]).
fn pump(app: *mut mty::MTY_App) {
    unsafe { mty::MTY_AppRun(app) }
}

/// A surface on libmatoya's window as it is now, configured-ready: its capabilities answered (a window Java is
/// replacing offers no formats). The surface holds a reference of its own on the ANativeWindow (libmatoya releases its
/// when Java destroys the surface).
unsafe fn surface_for(app: *mut mty::MTY_App, instance: &wgpu::Instance, adapter: &wgpu::Adapter) -> Option<(wgpu::Surface<'static>, *mut c_void, wgpu::SurfaceCapabilities)> {
    unsafe {
        let native = std::ptr::NonNull::new(mty::MTY_WindowGetNative(app, WINDOW))?;
        ANativeWindow_acquire(native.as_ptr());
        let target = wgpu::SurfaceTargetUnsafe::RawHandle {
            raw_display_handle: Some(wgpu::rwh::RawDisplayHandle::Android(wgpu::rwh::AndroidDisplayHandle::new())),
            raw_window_handle: wgpu::rwh::RawWindowHandle::AndroidNdk(wgpu::rwh::AndroidNdkWindowHandle::new(native)),
        };
        match instance.create_surface_unsafe(target) {
            Ok(surface) => {
                let caps = surface.get_capabilities(adapter);
                if !caps.formats.is_empty() && !caps.alpha_modes.is_empty() {
                    return Some((surface, native.as_ptr(), caps));
                }
            }
            Err(e) => eprintln!("scriptc-host window: create surface: {e}"),
        }
        ANativeWindow_release(native.as_ptr());
        None
    }
}

/// The surface configuration for libmatoya's window at its current size.
fn surface_config(app: *mut mty::MTY_App, caps: &wgpu::SurfaceCapabilities) -> wgpu::SurfaceConfiguration {
    let format = [wgpu::TextureFormat::Rgba8Unorm, wgpu::TextureFormat::Bgra8Unorm].into_iter().find(|f| caps.formats.contains(f)).unwrap_or(caps.formats[0]);
    let size = unsafe { mty::MTY_WindowGetSize(app, WINDOW) };
    // Mailbox where offered (Android's Vulkan has no Immediate), else Fifo.
    let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) { wgpu::PresentMode::Mailbox } else { wgpu::PresentMode::Fifo };
    wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width: size.w.max(1),
        height: size.h.max(1),
        present_mode,
        desired_maximum_frame_latency: 2,
        // Android's Vulkan surface offers Inherit only.
        alpha_mode: caps.alpha_modes[0],
        view_formats: vec![],
        color_space: Default::default(),
    }
}

unsafe fn open() -> Result<Win, String> {
    unsafe {
        let app = mty::MTY_AppCreate(0, Some(app_once), Some(on_event), std::ptr::null_mut());
        if app.is_null() {
            return Err("MTY_AppCreate failed".into());
        }
        let title = CString::new(crate::config::get().app_name).unwrap();
        let mut frame = mty::MTY_Frame::default();
        frame.type_ = mty::MTY_WINDOW_NORMAL;
        if mty::MTY_WindowCreate(app, title.as_ptr(), &frame, WINDOW) < 0 {
            return Err("MTY_WindowCreate failed".into());
        }
        mty::MTY_AppSetTimeout(app, 0);
        // the window first, a surface on it, an adapter compatible with that surface and
        // its device; then the surface's capabilities. The first window can be replaced before it is usable (the
        // Activity turning to landscape as it starts: its surface then offers no formats), so a new surface is tried
        // until one is, on the same device.
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let mut gpu: Option<(wgpu::Adapter, wgpu::Device, wgpu::Queue)> = None;
        let mut started = Instant::now();
        let (mut nulls, mut tries) = (0u32, 0u32);
        let (surface, native, caps) = loop {
            pump(app);
            let raw = mty::MTY_WindowGetNative(app, WINDOW);
            if let Some(window) = std::ptr::NonNull::new(raw) {
                tries += 1;
                ANativeWindow_acquire(window.as_ptr());
                let target = wgpu::SurfaceTargetUnsafe::RawHandle {
                    raw_display_handle: Some(wgpu::rwh::RawDisplayHandle::Android(wgpu::rwh::AndroidDisplayHandle::new())),
                    raw_window_handle: wgpu::rwh::RawWindowHandle::AndroidNdk(wgpu::rwh::AndroidNdkWindowHandle::new(window)),
                };
                match instance.create_surface_unsafe(target) {
                    Ok(surface) => {
                        if gpu.is_none() {
                            let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                                compatible_surface: Some(&surface),
                                power_preference: wgpu::PowerPreference::HighPerformance,
                                ..Default::default()
                            }))
                            .map_err(|e| format!("no adapter: {e}"))?;
                            let (mut features, limits) = gpu_stream_wgpu::web_device_asks(&adapter);
                            // The driver's pipeline cache, kept across runs (the layer's scene).
                            features |= crate::layer::get().pipeline_cache_features(&adapter, &std::path::PathBuf::from(files_dir()).join("pipeline-cache"));
                            let info = adapter.get_info();
                            let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                                label: Some("scriptc-host window"),
                                required_features: features,
                                required_limits: limits,
                                ..Default::default()
                            }))
                            .map_err(|e| format!("no device: {e}"))?;
                            device.on_uncaptured_error(std::sync::Arc::new(|e: wgpu::Error| eprintln!("scriptc-host gpu: uncaptured WebGPU error: {e}")));
                            eprintln!("scriptc-host window: {} ({:?} {})", info.name, info.backend, info.driver_info);
                            // <PREFIX>GPU_TIMING=1: each pass's GPU time from timestamp queries (gpu-stream-wgpu timing.rs),
                            // summarized every two seconds by `gpu_timing_report`.
                            if crate::config::var("GPU_TIMING").as_deref() == Ok("1") {
                                let on = gpu_stream_wgpu::timing::install(&device, &queue, false);
                                eprintln!("scriptc-host window: GPU timing {}", if on { "on" } else { "unavailable (no TIMESTAMP_QUERY)" });
                            }
                            gpu = Some((adapter, device, queue));
                        }
                        let caps = surface.get_capabilities(&gpu.as_ref().unwrap().0);
                        if !caps.formats.is_empty() && !caps.alpha_modes.is_empty() {
                            break (surface, window.as_ptr(), caps);
                        }
                    }
                    Err(e) => eprintln!("scriptc-host window: create surface: {e}"),
                }
                ANativeWindow_release(window.as_ptr());
            } else {
                nulls += 1;
            }
            // The app can start with no visible window (the screen off, the keyguard in front): Android gives it a
            // surface once it is shown, so the wait has no limit; it says so every 10 s.
            if started.elapsed() > Duration::from_secs(10) {
                eprintln!("scriptc-host window: waiting for a usable surface ({nulls} polls without a window, {tries} surfaces without formats); is the app in front?");
                started = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let (adapter, device, queue) = gpu.unwrap();
        let config = surface_config(app, &caps);
        let format = config.format;
        let size = (config.width, config.height);
        let present_mode = config.present_mode;
        let scale = f64::from(mty::MTY_WindowGetScreenScale(app, WINDOW)).max(1.0);
        surface.configure(&device, &config);
        // A render thread's GPU stream (a threaded program) draws on this device; the window composites its scene.
        crate::relay::publish_device(device.clone(), queue.clone(), config.width, config.height);
        let compositor = compositor(&device, format);
        let hz = match mty::MTY_WindowGetRefreshRate(app, WINDOW) {
            0 => 60,
            hz => hz,
        };
        eprintln!("scriptc-host window: android {}x{} px at scale {scale}, {format:?}, {present_mode:?}, {hz} Hz", config.width, config.height);
        // The display's period until the Choreographer has measured it, for the render threads' pacing (timers).
        timers::REFRESH_US.store((1_000_000 / hz.max(1)) as u64, std::sync::atomic::Ordering::Relaxed);
        start_vsync();
        Ok(Win {
            app,
            surface,
            device,
            queue,
            config,
            scale,
            refresh_ms: 1000.0 / f64::from(hz),
            next_frame: Instant::now(),
            input: VecDeque::new(),
            compositor,
            overlay: None,
            dirty: true,
            scene_presented: 0,
            frames: 0,
            frame_due: None,
            close_requested: false,
            size,
            instance,
            adapter,
            native,
            gone: false,
            ui_gpu: None,
            ui_cpu: crate::config::var("UI_CPU").as_deref() == Ok("1"),
            keyboard: false,
            typed: None,
            held_keys: std::collections::HashMap::new(),
        })
    }
}

/// Pumps libmatoya until `ms` from now (infinite: until there is work) or until there is work: input, or the next
/// frame at the display's rate.
/// A wake() not yet seen by the main loop's sleep.
static WOKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The main thread's instance's waker (set when the window opens there).
static MAIN_WAKER: std::sync::Mutex<Option<crate::modules::Waker>> = std::sync::Mutex::new(None);

/// The main thread's waker, from the main thread (its first host call, before any window).
pub fn init_main_waker() {
    *MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::modules::waker());
}

/// Turns the main thread's loop from any thread (window.rs mac `wake`): its sleep polls the flag, and its wait on the
/// pool ends through its waker.
#[allow(dead_code)]
pub fn wake() {
    WOKEN.store(true, std::sync::atomic::Ordering::Release);
    if let Some(waker) = MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        waker.wake();
    }
}

pub fn sleep(ms: f64) {
    let Some(app) = WIN.with(|w| w.borrow().as_ref().map(|w| w.app)) else { return };
    let deadline = if ms.is_finite() { Some(Instant::now() + Duration::from_secs_f64(ms.max(0.0) / 1000.0)) } else { None };
    loop {
        pump(app);
        frame_tick();
        if work_ready() || !is_open() || WOKEN.swap(false, std::sync::atomic::Ordering::AcqRel) {
            return;
        }
        let now = Instant::now();
        if deadline.is_some_and(|d| now >= d) {
            return;
        }
        let next = WIN.with(|w| w.borrow().as_ref().map(|w| w.next_frame)).unwrap_or(now);
        let until = deadline.map_or(next, |d| d.min(next));
        // libmatoya's queue has no wake-up to wait on: the sleep polls it every 2 ms.
        std::thread::sleep(until.saturating_duration_since(now).min(Duration::from_millis(2)));
    }
}

// ---- The display's refreshes (AChoreographer) -----------------------------------------------------------------------
//
// The Android twin of window_windows.rs's vsync thread: a thread of its own with a looper, on which the Choreographer
// calls back at each refresh with its vblank (frameTimeNanos, CLOCK_MONOTONIC, the clock Rust's Instant reads here).
// Each refresh is stamped for the render threads (timers::vblank: a threaded program's render-thread frames run at the
// display's refreshes with the vblank as their timestamp, SCRIPTC_HOST_RENDER_VSYNC) and makes the window's own frame
// due with the same timestamp (SCRIPTC_HOST_VBLANK=0: the window keeps its own timer grid at MTY's refresh rate), so
// frame deltas step by whole refreshes, as a browser's do. The refresh period is measured from the callbacks (the
// Pixel's display moves between 60 and 120 Hz).

#[link(name = "android")]
unsafe extern "C" {
    fn ALooper_prepare(opts: i32) -> *mut c_void;
    fn ALooper_pollOnce(timeout_ms: i32, out_fd: *mut i32, out_events: *mut i32, out_data: *mut *mut c_void) -> i32;
    fn AChoreographer_getInstance() -> *mut c_void;
    // API 24 (deprecated from 29 for the 64-bit form, which minSdk 28 cannot name); `long` is 64-bit on arm64.
    fn AChoreographer_postFrameCallback(choreographer: *mut c_void, callback: unsafe extern "C" fn(i64, *mut c_void), data: *mut c_void);
}

#[repr(C)]
struct Timespec {
    sec: i64,
    nsec: i64,
}

unsafe extern "C" {
    fn clock_gettime(clock: i32, ts: *mut Timespec) -> i32;
}

/// The Choreographer's refreshes: how many so far, and the last one's vblank.
static VSYNC: std::sync::Mutex<(u64, Option<Instant>)> = std::sync::Mutex::new((0, None));
static VSYNC_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The last refresh's frameTimeNanos, and the refresh period measured from them (µs, smoothed).
static VSYNC_LAST_NS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static VSYNC_PERIOD_US: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// SCRIPTC_HOST_VBLANK: the window's frames at the Choreographer's refreshes (on by default; `0` keeps its timer grid).
fn window_vblank_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("SCRIPTC_HOST_VBLANK").as_deref() != Ok("0"))
}

/// Starts the Choreographer's thread once (the window's open), when anything paces on it.
fn start_vsync() {
    if !(timers::render_vsync_on() || window_vblank_on()) || VSYNC_STARTED.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return;
    }
    let spawned = std::thread::Builder::new().name(crate::config::thread_name("vsync")).spawn(|| {
        // SAFETY: this thread's own looper, then the Choreographer bound to it; the callback re-posts itself on it.
        unsafe {
            ALooper_prepare(0);
            let choreographer = AChoreographer_getInstance();
            if choreographer.is_null() {
                eprintln!("scriptc-host window: no Choreographer; frames keep the timer grid");
                return;
            }
            AChoreographer_postFrameCallback(choreographer, on_refresh, choreographer);
            loop {
                ALooper_pollOnce(-1, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
            }
        }
    });
    if let Err(e) = spawned {
        eprintln!("scriptc-host window: the vsync thread did not start: {e}");
    }
}

/// The Choreographer's callback at a refresh: its vblank stamped for the render threads and the window, the period
/// measured, and the next refresh asked for.
unsafe extern "C" fn on_refresh(frame_time_nanos: i64, choreographer: *mut c_void) {
    let mut ts = Timespec { sec: 0, nsec: 0 };
    // SAFETY: CLOCK_MONOTONIC (1) into a timespec of ours.
    let now_ns = if unsafe { clock_gettime(1, &mut ts) } == 0 { ts.sec * 1_000_000_000 + ts.nsec } else { frame_time_nanos };
    let age = Duration::from_nanos(now_ns.saturating_sub(frame_time_nanos).clamp(0, 100_000_000) as u64);
    let at = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);
    use std::sync::atomic::Ordering::Relaxed;
    let last = VSYNC_LAST_NS.swap(frame_time_nanos, Relaxed);
    let interval_us = (frame_time_nanos - last) / 1000;
    // One refresh apart (a skipped one or a pause says nothing about the period): 4 to 34 ms (240 to 30 Hz).
    if last > 0 && (4_000..34_000).contains(&interval_us) {
        let old = VSYNC_PERIOD_US.load(Relaxed);
        let period = if old == 0 { interval_us as u64 } else { (old * 7 + interval_us as u64) / 8 };
        VSYNC_PERIOD_US.store(period, Relaxed);
        timers::REFRESH_US.store(period, Relaxed);
    }
    {
        let mut v = VSYNC.lock().unwrap_or_else(|e| e.into_inner());
        v.0 += 1;
        v.1 = Some(at);
    }
    if timers::render_vsync_on() {
        timers::vblank(at);
    }
    if window_vblank_on() {
        wake();
    }
    // SAFETY: the Choreographer this thread's looper runs, as given to the first post.
    unsafe { AChoreographer_postFrameCallback(choreographer, on_refresh, choreographer) };
}

/// The Choreographer's last refresh while it is fresh (at most two refreshes old), for the window's frames.
fn window_vsync() -> Option<(u64, Instant)> {
    if !window_vblank_on() {
        return None;
    }
    let (seq, at) = *VSYNC.lock().unwrap_or_else(|e| e.into_inner());
    let at = at?;
    let period = Duration::from_micros(timers::REFRESH_US.load(std::sync::atomic::Ordering::Relaxed).max(1000));
    (at.elapsed() < period * 2).then_some((seq, at))
}

thread_local! {
    /// The Choreographer refresh the window last ran its frame for.
    static VSYNC_SEEN: Cell<u64> = const { Cell::new(0) };
}

/// A frame is due at each new refresh the Choreographer reports, with its vblank as the timestamp; without fresh
/// refreshes, once the display's period has passed since the last.
fn frame_tick() {
    WIN.with(|w| {
        if let Some(w) = w.borrow_mut().as_mut() {
            let now = Instant::now();
            if w.frame_due.is_none()
                && let Some((seq, at)) = window_vsync()
            {
                if seq != VSYNC_SEEN.with(|s| s.get()) {
                    VSYNC_SEEN.with(|s| s.set(seq));
                    w.frame_due = Some(timers::now_ms() - at.elapsed().as_secs_f64() * 1000.0);
                    // The timer grid's bound, should the refreshes stop (the next refresh wakes the loop first).
                    w.next_frame = now + Duration::from_secs_f64(w.refresh_ms * 1.5 / 1000.0);
                }
                return;
            }
            if w.frame_due.is_none() && now >= w.next_frame {
                let period = Duration::from_secs_f64(w.refresh_ms / 1000.0);
                w.next_frame = (w.next_frame + period).max(now);
                w.frame_due = Some(timers::now_ms());
            }
        }
    })
}

/// libmatoya's events as the document's input: each finger a touch pointer, the first down the primary one (a touch is a press, its
/// moves drags, its lift the release, as a browser's compatibility mouse events give a page).
fn translate() {
    let events = EVENTS.with(|e| std::mem::take(&mut *e.borrow_mut()));
    for event in events {
        WIN.with(|w| {
            let mut w = w.borrow_mut();
            let Some(w) = w.as_mut() else { return };
            let css = |v: i32| f64::from(v) / w.scale;
            let mods = Mods::default();
            match event {
                // Every finger is a pointer of its own (a pinch is two); the document picks the primary (dom.rs).
                Event::Touch { id, x, y, phase } => {
                    let kind = match phase {
                        0 => PointerKind::Down,
                        1 => PointerKind::Move,
                        _ => PointerKind::Up,
                    };
                    let buttons = if matches!(kind, PointerKind::Up) { 0 } else { 1 };
                    // A tap asks again: a keyboard the user put away shows once more when a field keeps the focus.
                    if matches!(kind, PointerKind::Down) {
                        w.keyboard = false;
                    }
                    w.input.push_back(Input::Pointer { kind, x: css(x), y: css(y), button: 0, buttons, mods, touch: Some(id) });
                }
                Event::Button { pressed, x, y } => {
                    let kind = if pressed { PointerKind::Down } else { PointerKind::Up };
                    w.input.push_back(Input::Pointer { kind, x: css(x), y: css(y), button: 0, buttons: u16::from(pressed), mods, touch: None });
                }
                Event::Motion { x, y } => w.input.push_back(Input::Pointer { kind: PointerKind::Move, x: css(x), y: css(y), button: 0, buttons: 0, mods, touch: None }),
                Event::Size => w.dirty = true,
                Event::Close => w.close_requested = true,
                // Text first: the key event of the same press (if its key has one) goes down as this text, as a
                // browser's keydown carries the typed character in `key`; a text with no key event goes down and up alone.
                Event::Text(text) => {
                    if let Some(prev) = w.typed.replace(text) {
                        type_alone(w, prev);
                    }
                }
                Event::Key { key, mods: m, pressed } => {
                    let mods = key_mods(m);
                    if pressed {
                        let typed = w.typed.take();
                        let (name, code) = dom_key(key);
                        let down_as = match typed {
                            Some(t) if !matches!(name, Some("Enter" | "Backspace" | "Tab" | "Escape")) => t,
                            // Enter's and Tab's text (\n, \t) is the key's own: dropped (type_alone drops control text).
                            Some(t) => {
                                type_alone(w, t);
                                name.unwrap_or("Unidentified").to_string()
                            }
                            None => name.unwrap_or("Unidentified").to_string(),
                        };
                        let repeat = w.held_keys.contains_key(&key);
                        w.held_keys.insert(key, (down_as.clone(), code.to_string()));
                        w.input.push_back(Input::Key { down: true, key: down_as, code: code.to_string(), mods, repeat });
                    } else if let Some((name, code)) = w.held_keys.remove(&key) {
                        w.input.push_back(Input::Key { down: false, key: name, code, mods, repeat: false });
                    }
                }
            }
        });
    }
    // Text whose key event never came (a character libmatoya maps to no key): typed alone.
    WIN.with(|w| {
        if let Some(w) = w.borrow_mut().as_mut()
            && let Some(t) = w.typed.take()
        {
            type_alone(w, t);
        }
    });
}

/// Text typed with no key of its own: a key down and up carrying it (text_field.rs types a key's `key`).
fn type_alone(w: &mut Win, text: String) {
    if text.chars().all(char::is_control) {
        return;
    }
    let mods = Mods::default();
    w.input.push_back(Input::Key { down: true, key: text.clone(), code: String::new(), mods, repeat: false });
    w.input.push_back(Input::Key { down: false, key: text, code: String::new(), mods, repeat: false });
}

/// libmatoya's modifiers as the document's.
fn key_mods(m: u32) -> Mods {
    let has = |bits: u32| m & bits != 0;
    Mods { shift: has(mty::MTY_MOD_SHIFT as u32), ctrl: has(mty::MTY_MOD_CTRL as u32), alt: has(mty::MTY_MOD_ALT as u32), meta: has(mty::MTY_MOD_WIN as u32) }
}

/// A libmatoya key's DOM `key` (the named keys; a printable key's comes from its text) and `code`.
fn dom_key(k: u32) -> (Option<&'static str>, &'static str) {
    macro_rules! keys {
        ($($mty:ident => $key:expr, $code:expr;)*) => {
            $(if k == mty::$mty as u32 { return ($key, $code); })*
        };
    }
    keys! {
        MTY_KEY_BACKSPACE => Some("Backspace"), "Backspace";
        MTY_KEY_ENTER => Some("Enter"), "Enter";
        MTY_KEY_NP_ENTER => Some("Enter"), "NumpadEnter";
        MTY_KEY_TAB => Some("Tab"), "Tab";
        MTY_KEY_ESCAPE => Some("Escape"), "Escape";
        MTY_KEY_SPACE => Some(" "), "Space";
        MTY_KEY_DELETE => Some("Delete"), "Delete";
        MTY_KEY_LEFT => Some("ArrowLeft"), "ArrowLeft";
        MTY_KEY_RIGHT => Some("ArrowRight"), "ArrowRight";
        MTY_KEY_UP => Some("ArrowUp"), "ArrowUp";
        MTY_KEY_DOWN => Some("ArrowDown"), "ArrowDown";
        MTY_KEY_HOME => Some("Home"), "Home";
        MTY_KEY_END => Some("End"), "End";
        MTY_KEY_PAGE_UP => Some("PageUp"), "PageUp";
        MTY_KEY_PAGE_DOWN => Some("PageDown"), "PageDown";
        MTY_KEY_LSHIFT => Some("Shift"), "ShiftLeft";
        MTY_KEY_RSHIFT => Some("Shift"), "ShiftRight";
        MTY_KEY_LCTRL => Some("Control"), "ControlLeft";
        MTY_KEY_RCTRL => Some("Control"), "ControlRight";
        MTY_KEY_LALT => Some("Alt"), "AltLeft";
        MTY_KEY_RALT => Some("Alt"), "AltRight";
        MTY_KEY_A => None, "KeyA"; MTY_KEY_B => None, "KeyB"; MTY_KEY_C => None, "KeyC"; MTY_KEY_D => None, "KeyD";
        MTY_KEY_E => None, "KeyE"; MTY_KEY_F => None, "KeyF"; MTY_KEY_G => None, "KeyG"; MTY_KEY_H => None, "KeyH";
        MTY_KEY_I => None, "KeyI"; MTY_KEY_J => None, "KeyJ"; MTY_KEY_K => None, "KeyK"; MTY_KEY_L => None, "KeyL";
        MTY_KEY_M => None, "KeyM"; MTY_KEY_N => None, "KeyN"; MTY_KEY_O => None, "KeyO"; MTY_KEY_P => None, "KeyP";
        MTY_KEY_Q => None, "KeyQ"; MTY_KEY_R => None, "KeyR"; MTY_KEY_S => None, "KeyS"; MTY_KEY_T => None, "KeyT";
        MTY_KEY_U => None, "KeyU"; MTY_KEY_V => None, "KeyV"; MTY_KEY_W => None, "KeyW"; MTY_KEY_X => None, "KeyX";
        MTY_KEY_Y => None, "KeyY"; MTY_KEY_Z => None, "KeyZ";
        MTY_KEY_0 => None, "Digit0"; MTY_KEY_1 => None, "Digit1"; MTY_KEY_2 => None, "Digit2"; MTY_KEY_3 => None, "Digit3";
        MTY_KEY_4 => None, "Digit4"; MTY_KEY_5 => None, "Digit5"; MTY_KEY_6 => None, "Digit6"; MTY_KEY_7 => None, "Digit7";
        MTY_KEY_8 => None, "Digit8"; MTY_KEY_9 => None, "Digit9";
    }
    (None, "")
}

/// The loop turn's share (timers::run_due): libmatoya pumped, input dispatched, a due frame's callbacks run and the
/// frame composited.
pub fn turn() -> bool {
    let Some(app) = WIN.with(|w| w.borrow().as_ref().map(|w| w.app)) else { return false };
    pump(app);
    translate();
    follow();
    resized();
    loop {
        let next = WIN.with(|w| w.borrow_mut().as_mut().and_then(|w| w.input.pop_front()));
        let Some(input) = next else { break };
        WIN.with(|w| {
            if let Some(w) = w.borrow_mut().as_mut() {
                w.dirty = true;
            }
        });
        if let Err(e) = dom::input(&input) {
            eprintln!("scriptc-host window: input dispatch: {e}");
        }
    }
    // The soft keyboard shows while a text field or editing host has the focus, and hides when it leaves.
    let want = dom::text_entry_focused();
    WIN.with(|w| {
        if let Some(w) = w.borrow_mut().as_mut()
            && w.keyboard != want
        {
            w.keyboard = want;
            // SAFETY: the app is this window's, on its own thread (not a fiber: the loop's turn).
            unsafe { mty::MTY_AppShowSoftKeyboard(w.app, want) };
        }
    });
    if WIN.with(|w| w.borrow().as_ref().is_some_and(|w| w.close_requested)) {
        WIN.with(|w| w.borrow_mut().take());
        timers::clear_all();
        return false;
    }
    dump_on_request();
    frame_tick();
    let due = WIN.with(|w| w.borrow_mut().as_mut().and_then(|w| w.frame_due.take()));
    if let Some(ts) = due {
        let ran = timers::frames_waiting();
        timers::run_frames(ts);
        crate::observers::deliver();
        render(ran);
    }
    false
}

/// `adb shell run-as <package> touch files/dump-request`: the document's markup to `files/document.html`
/// (the Mac window's `dump` injection; which layers are up), looked for about once a second.
fn dump_on_request() {
    thread_local! { static TURNS: Cell<u32> = const { Cell::new(0) }; }
    if TURNS.with(|t| { t.set(t.get().wrapping_add(1)); t.get() % 60 != 0 }) {
        return;
    }
    let files = std::path::PathBuf::from(crate::window::files_dir());
    if std::fs::remove_file(files.join("dump-request")).is_ok() {
        let path = files.join("document.html");
        match std::fs::write(&path, dom::document_html()) {
            Ok(()) => eprintln!("scriptc-host window: dumped the document to {}", path.display()),
            Err(e) => eprintln!("scriptc-host window: dump {}: {e}", path.display()),
        }
    }
}

/// Java replaced libmatoya's window (rotation, a pause and resume): a new surface on the same device, configured for
/// the new window. While there is none, frames keep their old surface.
fn follow() {
    WIN.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else { return };
        let now = unsafe { mty::MTY_WindowGetNative(w.app, WINDOW) };
        if now.is_null() {
            if !w.gone {
                w.gone = true;
                eprintln!("scriptc-host window: the window is gone (in the background): not presenting until a new one");
                // The app may not come back: what compiled so far is kept now.
                crate::layer::get().save_pipeline_cache(true);
            }
            return;
        }
        // A new window may reuse the old one's address: after a loss it is followed all the same.
        if now == w.native && !w.gone {
            return;
        }
        let Some((surface, native, caps)) = (unsafe { surface_for(w.app, &w.instance, &w.adapter) }) else { return };
        let mut config = surface_config(w.app, &caps);
        // The compositor's pipelines keep the first format.
        if caps.formats.contains(&w.config.format) {
            config.format = w.config.format;
        }
        surface.configure(&w.device, &config);
        let old = std::mem::replace(&mut w.native, native);
        w.surface = surface;
        w.config = config;
        w.size = (w.config.width, w.config.height);
        w.dirty = true;
        w.gone = false;
        unsafe { ANativeWindow_release(old) };
        eprintln!("scriptc-host window: followed a new window, {}x{} px", w.config.width, w.config.height);
    })
}

/// The window's size changed (rotation, a split screen): the surface, the scene and the document follow.
fn resized() {
    let changed = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        let s = unsafe { mty::MTY_WindowGetSize(w.app, WINDOW) };
        if w.gone || (s.w, s.h) == w.size || s.w == 0 || s.h == 0 {
            return None;
        }
        w.size = (s.w, s.h);
        w.config.width = s.w;
        w.config.height = s.h;
        w.surface.configure(&w.device, &w.config);
        w.dirty = true;
        Some((s.w, s.h, w.scale))
    });
    if let Some((pw, ph, scale)) = changed {
        crate::layer::get().resize(pw, ph);
        dom::set_viewport(pw, ph, scale as f32);
        dom::fire_window_event("resize");
    }
}

/// The document's GPU painter and the overlay it paints (Vello's storage format, sized to the window), taken out of the
/// window for the paint, and whether the overlay is new (painted whole). None paints on the CPU: <PREFIX>UI_CPU=1, or a
/// painter that could not be made (reported once). window.rs mac `gpu_ui`.
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
                Ok(p) => {
                    eprintln!("scriptc-host window: the document paints on the GPU");
                    p
                }
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

/// SCRIPTC_HOST_TRACE=1: the window's thread when it opens, and each due frame's reasons to composite (or not).
fn frame_trace() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE").is_some())
}

/// Composites and presents when anything may have changed (window.rs mac `render_into`, without the capture).
fn render(callbacks_ran: bool) {
    let canvas = crate::layer::get().canvas_frame();
    let scene = crate::layer::get().scene();
    // The secondary views (the map's relief, the loading showcase, the paperdoll): each scene in its canvas's box, under
    // the page's hole there (window_windows.rs `render_into`). Without them the hole showed the render thread through it.
    let views = crate::layer::get().view_frames();
    // A view repaints the window only when it presented since the last composite (or the views changed).
    let views_new = {
        thread_local! {
            static SEEN: std::cell::RefCell<Vec<u64>> = const { std::cell::RefCell::new(Vec::new()) };
        }
        let now: Vec<u64> = views.iter().map(|(_, v)| v.presented).collect();
        SEEN.with(|s| {
            let mut s = s.borrow_mut();
            let changed = *s != now;
            *s = now;
            changed
        })
    };
    crate::modules::deliver_loads();
    let document_changed = dom::take_dirty();
    // A running CSS transition or animation (a splash fading out) moves only as frames composite: with no frame
    // callbacks on this thread (a threaded program's main loop is the render thread's), nothing else would composite them.
    let animating = dom::with_document_quiet(|doc| doc.is_animating());
    let go = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else { return false };
        // No window to present to: the next one is composited whole when it comes (follow marks it dirty).
        if w.gone {
            return false;
        }
        let scene_new = scene.as_ref().is_some_and(|s| s.presented != w.scene_presented);
        let go = w.dirty || document_changed || scene_new || callbacks_ran || animating || views_new;
        if frame_trace() {
            eprintln!("  frame {}: dirty {}, document {document_changed}, scene {scene_new}, callbacks {callbacks_ran}, animating {animating}, views {views_new}: {}", w.frames, w.dirty, if go { "composite" } else { "kept" });
        }
        go
    });
    if !go {
        return;
    }
    let (pw, ph, scale, changed) = WIN.with(|w| {
        let w = w.borrow();
        let Some(w) = w.as_ref() else { return (1, 1, 1.0, true) };
        let (pw, ph) = (w.config.width, w.config.height);
        let fits = w.overlay.as_ref().is_some_and(|(_, ow, oh)| *ow == pw && *oh == ph);
        (pw, ph, w.scale, w.dirty || document_changed || animating || !fits)
    });
    // On the GPU the document paints straight into the overlay (only what changed); on the CPU it comes back as pixels to
    // upload (window.rs mac `render_into`).
    let (rgba, gpu_painted) = match gpu_ui(pw, ph) {
        Some((mut painter, overlay, fresh)) => {
            let now = crate::timers::now_ms() / 1000.0;
            let painted = dom::with_document_quiet(|doc| {
                if fresh {
                    doc.track_paint_damage(true);
                }
                if !(changed || fresh || doc.is_animating()) {
                    return (false, false);
                }
                let (damage, _) = painter.paint_damage(doc, &overlay, scale as f32, now, fresh);
                let painted = !matches!(damage, blitz_ui::PaintDamage::None);
                // Work the paint's own resolve left for a next one (Blitz restyles a checkbox built checked on the
                // resolve after it is built): the next frame is due, or it waited for some other change (the
                // landing page's saved "Enter directly" box showed empty, now and then for good).
                (painted, doc.needs_resolve(now))
            });
            let (painted, pending) = painted;
            // What painting itself marked (layout's own reads) is in this paint.
            dom::take_dirty();
            if pending {
                dom::repaint_later();
            }
            WIN.with(|w| {
                if let Some(w) = w.borrow_mut().as_mut() {
                    w.ui_gpu = Some(painter);
                }
            });
            (None, Some(painted))
        }
        None => (super::compose::document_pixels(changed, scale, pw, ph), None),
    };
    WIN.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else { return };
        w.dirty = false;
        if let Some(s) = &scene {
            w.scene_presented = s.presented;
        }
        let frame = match w.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            other => {
                // Only a stale surface wants configuring again (window.rs mac): an occluded one comes back as it was.
                if matches!(other, wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost) {
                    w.surface.configure(&w.device, &w.config);
                }
                return;
            }
        };
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
        let target = frame.texture.create_view(&Default::default());
        let bind = |view: &wgpu::TextureView| {
            w.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &w.compositor.layout,
                entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&w.compositor.sampler) }],
            })
        };
        let scene_group = scene.as_ref().map(|s| bind(&s.texture.create_view(&wgpu::TextureViewDescriptor { format: Some(s.format.remove_srgb_suffix()), ..Default::default() })));
        let overlay_group = bind(&overlay.create_view(&Default::default()));
        let view_groups: Vec<([f32; 4], wgpu::BindGroup)> = views
            .iter()
            .map(|(place, v)| (*place, bind(&v.texture.create_view(&wgpu::TextureViewDescriptor { format: Some(v.format.remove_srgb_suffix()), ..Default::default() }))))
            .collect();
        let mut encoder = w.device.create_command_encoder(&Default::default());
        let timed = gpu_stream_wgpu::timing::pass();
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scriptc-host composite"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: timed.as_ref().map(|(set, b, e)| wgpu::RenderPassTimestampWrites { query_set: set, beginning_of_pass_write_index: Some(*b), end_of_pass_write_index: Some(*e) }),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if let Some(g) = &scene_group {
                let placed = canvas.map(|(_, [x, y, cw, ch])| {
                    let (x0, y0) = (x.clamp(0.0, pw as f32), y.clamp(0.0, ph as f32));
                    (x0, y0, (x + cw).min(pw as f32) - x0, (y + ch).min(ph as f32) - y0)
                });
                let mut drawn = (pw as f32, ph as f32);
                if let Some((x, y, vw, vh)) = placed.filter(|&(_, _, vw, vh)| vw > 0.0 && vh > 0.0) {
                    pass.set_viewport(x, y, vw, vh, 0.0, 1.0);
                    drawn = (vw, vh);
                }
                // Drawn a quarter larger or more than it was rendered (performance mode's render scale), the scene is
                // sharpened as it is upscaled (window.rs `fs_sharp`; <PREFIX>SHARPEN).
                let upscaled = scene.as_ref().is_some_and(|s| drawn.0 >= s.texture.width() as f32 * 1.25);
                match (&w.compositor.scene_sharp, upscaled) {
                    (Some(sharp), true) => pass.set_pipeline(sharp),
                    _ => pass.set_pipeline(&w.compositor.opaque),
                }
                pass.set_bind_group(0, g, &[]);
                pass.draw(0..3, 0..1);
                pass.set_viewport(0.0, 0.0, pw as f32, ph as f32, 0.0, 1.0);
            }
            for ([x, y, cw, ch], g) in &view_groups {
                let (x0, y0) = (x.clamp(0.0, pw as f32), y.clamp(0.0, ph as f32));
                let (vw, vh) = ((x + cw).min(pw as f32) - x0, (y + ch).min(ph as f32) - y0);
                if vw <= 0.0 || vh <= 0.0 {
                    continue;
                }
                pass.set_viewport(x0, y0, vw, vh, 0.0, 1.0);
                pass.set_pipeline(&w.compositor.opaque);
                pass.set_bind_group(0, g, &[]);
                pass.draw(0..3, 0..1);
                pass.set_viewport(0.0, 0.0, pw as f32, ph as f32, 0.0, 1.0);
            }
            pass.set_pipeline(if gpu_painted.is_some() { &w.compositor.over_straight } else { &w.compositor.over });
            pass.set_bind_group(0, &overlay_group, &[]);
            pass.draw(0..3, 0..1);
        }
        w.queue.submit([encoder.finish()]);
        w.queue.present(frame);
        gpu_stream_wgpu::timing::end_frame(&w.device, &w.queue);
        gpu_timing_report();
        w.frames += 1;
    });
}

/// <PREFIX>GPU_TIMING=1's summary, every two seconds: the frames' GPU busy time (the timed passes: the page's
/// WebGPU passes and the composite; Vello's own are not timed) and span (first timed pass to last, so the untimed
/// passes between them and the GPU's gaps too), and each pass position's median, the composite last.
fn gpu_timing_report() {
    thread_local! { static LAST: Cell<Option<Instant>> = const { Cell::new(None) }; }
    if !gpu_stream_wgpu::timing::installed() {
        return;
    }
    let now = Instant::now();
    if LAST.with(|l| l.get().is_some_and(|t| now.duration_since(t) < Duration::from_secs(2))) {
        return;
    }
    LAST.with(|l| l.set(Some(now)));
    gpu_stream_wgpu::timing::collect();
    let (frames, untimed) = gpu_stream_wgpu::timing::take();
    if frames.is_empty() {
        eprintln!("gpu timing: no frames read back ({untimed} untimed)");
        return;
    }
    let median = |mut v: Vec<f64>| {
        v.sort_by(f64::total_cmp);
        v[v.len() / 2]
    };
    let busy = median(frames.iter().map(|f| f.busy_ms).collect());
    let span = median(frames.iter().map(|f| f.span_ms).collect());
    let passes = median(frames.iter().map(|f| f64::from(f.passes)).collect());
    let mut per = String::new();
    for i in 0..16 {
        let m = median(frames.iter().map(|f| f.pass_ms[i]).collect());
        if m >= 0.05 {
            per.push_str(&format!(" #{i} {m:.2}"));
        }
    }
    let mut longest: Vec<u32> = frames.iter().map(|f| f.longest).collect();
    longest.sort_unstable();
    eprintln!(
        "gpu timing: {} frames ({untimed} untimed): busy {busy:.2} ms, span {span:.2} ms, {passes:.0} passes; longest pass mostly #{}; per pass (ms):{per}",
        frames.len(),
        longest[longest.len() / 2]
    );
}

/// The app's files directory (libmatoya's home: `getFilesDir()`).
/// The app's files directory, `/data/data/<package>/files`, the package named by /proc/self/cmdline. No JNI: the first
/// host call can come from a compiled async function, on a fiber's stack, where the JVM must not be entered
/// (libmatoya's MTY_GetDir asks the Activity, and faulted there).
pub fn files_dir() -> String {
    let cmdline = std::fs::read("/proc/self/cmdline").unwrap_or_default();
    let process = String::from_utf8_lossy(cmdline.split(|b| *b == 0).next().unwrap_or_default()).into_owned();
    let package = process.split(':').next().unwrap_or_default();
    if package.is_empty() {
        return String::new();
    }
    format!("/data/data/{package}/files")
}
