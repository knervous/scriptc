//! What crosses between a threaded program's main thread (the window, the document) and its render
//! thread (its pieces that render, a layer's GPU stream), as a web page and its worker share them: the window's GPU device, which the render thread's stream draws on; the
//! scene the stream last presented, which the window composites; and the canvases the page hands over
//! (the layer's hand-over hook on the main thread, the layer's canvas hook on the render thread), each the page's element (its box
//! places the scene) and a drawing buffer the render thread sizes (its size sizes the scene).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
#[cfg(feature = "gpu")]
use std::{sync::Condvar, time::Duration};

#[cfg(feature = "gpu")]
use gpu_stream_wgpu::{SceneFrame, wgpu};

/// SCRIPTC_HOST_TRACE_RENDER=1: hand-overs, attaches and the window's view of the attached canvas on stderr.
pub fn trace() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE_RENDER").is_some())
}

/// A render thread entered the host: the page hands its canvases over (main defines the layer's hand-over hook).
static RENDER: AtomicBool = AtomicBool::new(false);

pub fn render_entered() {
    RENDER.store(true, Ordering::Release);
}

pub fn render_present() -> bool {
    RENDER.load(Ordering::Acquire)
}

/// The window's device and queue, and its size in pixels, once it opened.
#[cfg(feature = "gpu")]
static DEVICE: Mutex<Option<(wgpu::Device, wgpu::Queue, u32, u32)>> = Mutex::new(None);
#[cfg(feature = "gpu")]
static DEVICE_OPEN: Condvar = Condvar::new();

/// The window opened its device (the main thread): a render thread's stream draws on it.
#[cfg(feature = "gpu")]
pub fn publish_device(device: wgpu::Device, queue: wgpu::Queue, width: u32, height: u32) {
    *DEVICE.lock().unwrap_or_else(|e| e.into_inner()) = Some((device, queue, width, height));
    DEVICE_OPEN.notify_all();
}

/// The window's device for a render thread's stream, waiting up to `wait` for the window to open it (None: the stream
/// opens headless and nothing composites it).
#[cfg(feature = "gpu")]
pub fn device(wait: Duration) -> Option<(wgpu::Device, wgpu::Queue, u32, u32)> {
    let guard = DEVICE.lock().unwrap_or_else(|e| e.into_inner());
    let (guard, _) = DEVICE_OPEN.wait_timeout_while(guard, wait, |d| d.is_none()).unwrap_or_else(|e| e.into_inner());
    guard.clone()
}

/// The scene a render thread's stream last presented, for the window.
#[cfg(feature = "gpu")]
static SCENE: Mutex<Option<SceneFrame>> = Mutex::new(None);

/// How many scenes the render thread has published (the macOS window's trace prints it beside its own frames).
static SCENES: AtomicU64 = AtomicU64::new(0);

#[allow(dead_code)]
pub fn scenes() -> u64 {
    SCENES.load(Ordering::Relaxed)
}

#[cfg(feature = "gpu")]
pub fn publish_scene(scene: Option<SceneFrame>) {
    if let Some(scene) = scene {
        SCENES.fetch_add(1, Ordering::Relaxed);
        *SCENE.lock().unwrap_or_else(|e| e.into_inner()) = Some(scene);
    }
}

#[cfg(feature = "gpu")]
pub fn scene() -> Option<SceneFrame> {
    SCENE.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// A handed canvas: the page's element (a node of the main thread's document) and its drawing buffer.
#[derive(Clone, Copy)]
struct Handed {
    node: blitz_dom::NodeId,
    buffer: (u32, u32),
}

static CANVASES: Mutex<Option<HashMap<String, Handed>>> = Mutex::new(None);
/// Render threads waiting for a canvas to be handed.
static WAITING: Mutex<Vec<crate::modules::Waker>> = Mutex::new(Vec::new());

fn canvases<R>(f: impl FnOnce(&mut HashMap<String, Handed>) -> R) -> R {
    f(CANVASES.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new))
}

/// The page hands its canvas `id` (the main thread's element `node`, its buffer as it stands) to the render thread.
pub fn hand(id: &str, node: blitz_dom::NodeId, buffer: (u32, u32)) {
    if trace() {
        eprintln!("relay: canvas '{id}' handed (node {node}, buffer {}x{})", buffer.0, buffer.1);
    }
    canvases(|c| {
        c.insert(id.to_string(), Handed { node, buffer });
    });
    HANDS.fetch_add(1, Ordering::AcqRel);
    for waker in std::mem::take(&mut *WAITING.lock().unwrap_or_else(|e| e.into_inner())) {
        waker.wake();
    }
}

pub fn is_handed(id: &str) -> bool {
    canvases(|c| c.contains_key(id))
}

/// How many hand-overs there have been (a waiting thread's waker was spent on each).
static HANDS: AtomicU64 = AtomicU64::new(0);

pub fn hands() -> u64 {
    HANDS.load(Ordering::Acquire)
}

/// A render thread waits for a canvas: its waker is woken at the next hand-over.
pub fn wait_for_canvas() {
    WAITING.lock().unwrap_or_else(|e| e.into_inner()).push(crate::modules::waker());
}

/// A handed canvas's drawing buffer (the render thread sets it, as an OffscreenCanvas's width and height).
pub fn buffer(id: &str) -> Option<(u32, u32)> {
    canvases(|c| c.get(id).map(|h| h.buffer))
}

pub fn set_buffer(id: &str, width: Option<u32>, height: Option<u32>) {
    canvases(|c| {
        if let Some(h) = c.get_mut(id) {
            h.buffer = (width.unwrap_or(h.buffer.0).max(1), height.unwrap_or(h.buffer.1).max(1));
        }
    })
}

/// The canvas the render thread's stream draws for (the last one attached), its element and buffer, for the window.
static ATTACHED: Mutex<Option<String>> = Mutex::new(None);

pub fn attach(id: &str) {
    if trace() {
        eprintln!("relay: the render thread attached canvas '{id}'");
    }
    *ATTACHED.lock().unwrap_or_else(|e| e.into_inner()) = Some(id.to_string());
}

pub fn attached() -> Option<(blitz_dom::NodeId, (u32, u32))> {
    let id = ATTACHED.lock().unwrap_or_else(|e| e.into_inner()).clone()?;
    canvases(|c| c.get(&id).map(|h| (h.node, h.buffer)))
}

/// The views' scenes a render thread's stream last presented (a layer's scene surface: a view's canvas), by the
/// handed canvas's id, for the window.
#[cfg(feature = "gpu")]
static VIEWS: Mutex<Option<HashMap<String, SceneFrame>>> = Mutex::new(None);

#[cfg(feature = "gpu")]
pub fn publish_view(id: &str, scene: SceneFrame) {
    VIEWS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(id.to_string(), scene);
}

/// Each published view's element (a node of the main thread's document) and its scene.
#[cfg(feature = "gpu")]
pub fn view_scenes() -> Vec<(blitz_dom::NodeId, SceneFrame)> {
    let views: Vec<(String, SceneFrame)> =
        VIEWS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|v| v.iter().map(|(k, s)| (k.clone(), s.clone())).collect()).unwrap_or_default();
    views.into_iter().filter_map(|(id, scene)| canvases(|c| c.get(&id).map(|h| (h.node, scene)))).collect()
}
