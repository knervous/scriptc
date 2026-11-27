//! The window on Windows: a Win32 window (per-monitor DPI aware) whose HWND backs the GPU device's surface (DX12 or
//! Vulkan, as wgpu picks), the document painted by Vello on that device (or on the CPU with <PREFIX>UI_CPU=1) and
//! composited over the program's scene as on macOS (window.rs `compose`), and the window's input dispatched into the
//! document.
//!
//! The program's event loop stays the owner, as on macOS: no message loop of its own runs. The loop's sleep (timers::
//! sleep, from io_poll) waits in the thread's message queue (MsgWaitForMultipleObjectsEx, with the loop's deadline)
//! and returns as soon as there is work: input to dispatch, or a display refresh. Windows has no display link: a
//! thread of the window's waits on the compositor's frame (DwmFlush) and posts the window a message per refresh, so the
//! sleep wakes on the refresh itself; with the compositor silent (the window minimized, a locked session) the window
//! paces itself at the display's rate.
//!
//! The window procedure only queues what it hears ([`EVENTS`]); the loop's turn takes the queue. Nothing here runs
//! while the window's state is borrowed except what cannot send the window a message.
//!
//! Dragging the window's border or title bar (or opening its window menu) runs a modal loop of Windows' own, inside the
//! dispatch of the message that began it; the page would stop until the drag ended, its last frame stretched over the
//! window. So the window's messages are pumped on a fiber of their own (once the program's runtime has made the thread
//! a fiber: it converts the thread itself, and a second conversion would fail): while a modal loop runs on that fiber,
//! each refresh (and each timer tick or wake) switches back to the program's loop, which runs its turn, resizes the
//! surface and the document, and draws at the size the drag reached, as a browser window does; its next pump (every turn
//! pumps) switches the fiber back into the modal loop. Nothing but the window procedure runs on the pump fiber, and the window
//! procedure only queues.
//!
//! The installed program's window (no SCRIPTC_HOST_WINDOW, no SCRIPTC_HOST_INJECT) keeps its place: its position, size,
//! maximized state and fullscreen are written to %LOCALAPPDATA%\<app>\window.txt when it closes and restored at the
//! next start when they still fit a monitor; the first start opens centred on the primary monitor at about 85% of its
//! work area (16:10). The window opens cloaked (DWM) until its first frame presents, over a dark class background, so
//! it never shows a white client area; its title bar is dark and takes the application's colours (Windows 11's caption,
//! text and border colours; the dark mode alone on Windows 10). It keeps a minimum size (800x500 CSS px), takes
//! Alt+Enter and F11 as fullscreen (the page's Fullscreen API, so its controls agree), and minimized it hides the page
//! (`document.visibilityState`, `visibilitychange`) and draws at most 10 frames a second. `navigator.wakeLock` keeps the
//! display on (SetThreadExecutionState) while the page is visible.
//!
//! Limits: keys carry their characters through ToUnicode (no IME composition yet).
//!
//! The same knobs as macOS: SCRIPTC_HOST_WINDOW=<w>x<h> (CSS px), SCRIPTC_HOST_CAPTURE, SCRIPTC_HOST_INJECT
//! (`click:<x>,<y>@<frame>`, `key:<c>@<frame>` (a letter or digit, or a named key: `key:Escape`), `down:<c>@<frame>` and
//! `up:<c>@<frame>` (a held key, a named one too), `ldown:<x>,<y>`, `lup:<x>,<y>`, `rdown:<x>,<y>` and `rup:<x>,<y>` (a left or right
//! button going down or up there), `move:<x>,<y>` (the mouse moved there, with the buttons held; while the pointer is
//! locked, its motion is from the window's centre), `wheel:<x>,<y>,<notches>` (positive: toward the user),
//! `resize:<w>x<h>@<frame>`, `capture@<frame>` (or `capture:<file>@<frame>`), `dump@<frame>`, `chord:<mods>+<key>@<frame>`
//! (a key pressed with modifiers held: `chord:Ctrl+c`, `chord:Shift+Tab`, `chord:Ctrl+Shift+z`, `chord:Shift+Insert`;
//! `Semicolon` names the `;` key, which separates the steps: `chord:Ctrl+Shift+Alt+Semicolon`),
//! `clip:<text>@<frame>` (the system clipboard's text set, `\n` a line break), `clicktext:<text>@<frame>` (a click on the
//! middle of the element showing that text); any step's `@<frame>` may be `@<n>ms` instead, n milliseconds after the
//! window opened, for a page that presents only when it changes), SCRIPTC_HOST_PRESENT=immediate, SCRIPTC_HOST_TRACE=1,
//! SCRIPTC_HOST_TRACE_INPUT=1 (dom.rs: every input event and pointer lock change on stderr), SCRIPTC_HOST_VBLANK=0
//! (refreshes stamped when DwmFlush returned, not with DWM's vblank: `vblank_instant`), SCRIPTC_HOST_PROFILE=<file> (the sampling profiler:
//! profile.rs). SCRIPTC_HOST_TRACE also times each frame's acquire, composite and present, and a key's way from its
//! message to the present that first showed it.
//!
//! The pointer lock (element.requestPointerLock, dom.rs): the window must have the focus, as a browser's must; the
//! cursor is hidden and held in the client area, put back at its centre after every move so each move's offset is
//! the motion (pointer acceleration included, as Chromium's lock on Windows reports it), and put back where it was
//! when the lock ends. Losing the focus ends the lock. A run with SCRIPTC_HOST_INJECT takes the lock without the
//! focus and without touching the system cursor (its moves are posted, and the desktop's mouse is someone else's).
//!
//! Fullscreen (element.requestFullscreen, dom.rs): the window borderless over its whole monitor, its style and
//! placement put back when it ends; the client area's change reaches the document and the GPU as any resize does.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::num::NonZeroIsize;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use gpu_stream_wgpu::wgpu;
use gpu_stream_wgpu::wgpu::rwh;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{DWM_TIMING_INFO, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_CLOAK, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DwmFlush, DwmGetCompositionTimingInfo, DwmSetWindowAttribute};
use windows_sys::Win32::Graphics::Gdi::{ClientToScreen, CreateSolidBrush, DEVMODEW, ENUM_CURRENT_SETTINGS, EnumDisplaySettingsW, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY, MONITORINFOEXW, MonitorFromRect, MonitorFromWindow, ScreenToClient};
use windows_sys::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{CreateFiberEx, IsThreadAFiber, SwitchToFiber};
use windows_sys::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForSystem, GetDpiForWindow, GetSystemMetricsForDpi, SetProcessDpiAwarenessContext};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, MAPVK_VK_TO_VSC, MapVirtualKeyW, ReleaseCapture, SetCapture, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent, VkKeyScanW};
use windows_sys::Win32::UI::WindowsAndMessaging as wm;

use super::compose::{Compositor, compositor, write_png};
use crate::dom::{self, Input, Mods, PointerKind};
use crate::profile::Phase;
use crate::timers;

/// The refresh the vsync thread posts, and a wake() from another thread.
const WM_VSYNC: u32 = wm::WM_APP;
const WM_WAKE: u32 = wm::WM_APP + 1;
/// The timer that keeps the program's loop turning while a modal loop of Windows' own runs (a drag, the window menu).
const LIVE_TIMER: usize = 1;
/// The client area's least size, in CSS px (the page's layouts below it are not made for).
const MIN_CSS: (f64, f64) = (800.0, 500.0);
/// The application's colours (config.rs `window_colours`, COLORREF 0x00bbggrr): the client area before the first frame,
/// and the title bar's caption, text and border on Windows 11. None: a black client area and the system's title bar.
fn colours() -> Option<crate::config::WindowColours> {
    crate::config::get().window_colours
}
/// Minimized, the page draws at most this often (ms): its frames are not seen.
const HIDDEN_FRAME_MS: f64 = 100.0;
/// A mouse message's key state (WinUser.h's MK_*), and an unbounded wait.
const MK_LBUTTON: u32 = 0x01;
const MK_RBUTTON: u32 = 0x02;
const MK_MBUTTON: u32 = 0x10;
const MK_XBUTTON1: u32 = 0x20;
const MK_XBUTTON2: u32 = 0x40;
const INFINITE: u32 = u32::MAX;
/// WinUser.h's WM_MOUSELEAVE (TrackMouseEvent's).
const WM_MOUSELEAVE: u32 = 0x02a3;

/// The window (its HWND as an integer: the vsync thread and wake() post to it), 0 while none is open.
static HWND_POSTED: AtomicIsize = AtomicIsize::new(0);
/// The vsync thread's last refresh, and whether its message is still in the queue.
static VSYNC: Mutex<Option<Instant>> = Mutex::new(None);
static VSYNC_POSTED: AtomicBool = AtomicBool::new(false);
/// The window is minimized (the vsync thread slows to HIDDEN_FRAME_MS).
static MINIMIZED: AtomicBool = AtomicBool::new(false);
/// The vsync thread's refresh intervals (ms), for the close report.
static VSYNC_INTERVALS: Mutex<(Option<Instant>, Vec<f64>)> = Mutex::new((None, Vec::new()));
/// The main thread's instance's waker, and a wake() not yet seen by its sleep.
static MAIN_WAKER: Mutex<Option<crate::modules::Waker>> = Mutex::new(None);
static WOKEN: AtomicBool = AtomicBool::new(false);
/// A run driven by SCRIPTC_HOST_INJECT: its pointer lock leaves the system cursor alone (the module's doc).
static INJECTING: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
enum Injected {
    Click(f64, f64),
    /// A click on the middle of the element showing that text (case-insensitive: dom.rs `text_center`).
    ClickText(String),
    /// A key press (down and up) of a letter or digit.
    Key(char),
    /// A letter or digit held down until its `up` (a walk), or let go.
    KeyHeld(char, bool),
    /// A named key's press (down and up): its virtual key.
    NamedKey(u16, String),
    /// A named key held down until its `up`, or let go.
    NamedKeyHeld(u16, String, bool),
    /// A mouse button (the DOM's 0 left, 2 right) going down (true) or up at (x, y) CSS px.
    Button(i16, bool, f64, f64),
    /// The mouse moved to (x, y) CSS px.
    Move(f64, f64),
    /// The wheel turned by notches (positive: toward the user) at (x, y) CSS px.
    Wheel(f64, f64, f64),
    /// The client area resized to (w, h) CSS px (as a user's drag would).
    Resize(f64, f64),
    /// The next frame written to SCRIPTC_HOST_CAPTURE (a timed run's screenshot, without closing the window).
    Capture(Option<String>),
    /// A key (its virtual key and name) pressed with modifiers (virtual keys) held.
    Chord(Vec<u16>, u16, String),
    /// The system clipboard's text set (as another application would).
    Clip(String),
    /// The document's markup written beside SCRIPTC_HOST_CAPTURE (`<capture>.html`): which layers are up.
    Dump,
}

/// What the window procedure heard, for the turn.
enum Event {
    Input(Input),
    /// A refresh at that instant.
    Vsync(Instant),
    /// The client area or the DPI changed.
    Size,
    /// The close button (or Alt+F4).
    Close,
    /// Minimized (true) or shown again.
    Hidden(bool),
    /// Alt+Enter or F11: fullscreen toggled.
    ToggleFullscreen,
}

struct Win {
    hwnd: HWND,
    /// The surface is the presenter's ([`PRESENTER`]), shared with the GPU thread that may present.
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    /// The DPI scale (physical px per CSS px).
    scale: f64,
    configured: Instant,
    refresh_ms: f64,
    input: VecDeque<Input>,
    compositor: Arc<Compositor>,
    overlay: Option<(wgpu::Texture, u32, u32)>,
    /// With the GPU thread presenting ([`render_for_executor`]): the document's second texture, painted while the
    /// GPU thread composites `overlay` (published), then swapped with it; and the scene's box and the views' frames as
    /// last published.
    overlay_back: Option<(wgpu::Texture, u32, u32)>,
    published_place: (Option<[f32; 4]>, Vec<u64>),
    /// The document's painter on this window's device (blitz-ui gpu_paint), until it fails or <PREFIX>UI_CPU=1;
    /// taken out while it paints.
    ui_gpu: Option<blitz_ui::gpu_paint::GpuUiPainter>,
    ui_cpu: bool,
    /// Where a frame composites while the surface has no texture (the window minimized).
    offscreen: Option<wgpu::Texture>,
    dirty: bool,
    resized: bool,
    scene_presented: u64,
    frames: u64,
    frame_due: Option<f64>,
    /// When the last frame was made due, and whether by the window's own tick (the compositor silent).
    last_due: Instant,
    ticking: bool,
    close_requested: bool,
    closed_by_user: bool,
    inject: Vec<(Injected, u64)>,
    /// Injections timed in milliseconds after the window opened (`@<n>ms`), not yet due, and when it opened.
    timed: Vec<(Injected, u64)>,
    opened: Instant,
    paint_ms: Vec<f64>,
    vsync_thread: Option<std::thread::JoinHandle<()>>,
    /// Minimized: the page hidden, its frames slowed (HIDDEN_FRAME_MS).
    minimized: bool,
    /// A visibility change or a fullscreen toggle for the turn to take to the document.
    hidden_change: Option<bool>,
    toggle_fullscreen: bool,
    /// Still cloaked: no frame has presented yet.
    cloaked: bool,
    /// Whether the window keeps its place (window.txt), and the fullscreen to restore once the document has its root.
    remember: bool,
    restore_fullscreen: bool,
}

thread_local! {
    static WIN: RefCell<Option<Win>> = const { RefCell::new(None) };
    static TRIED: Cell<bool> = const { Cell::new(false) };
    static CLOSED: Cell<bool> = const { Cell::new(false) };
    /// The window procedure's queue (never borrowed across a call that may send the window a message).
    static EVENTS: RefCell<VecDeque<Event>> = const { RefCell::new(VecDeque::new()) };
    /// The DPI scale the window procedure converts pointer positions by (physical px / CSS px).
    static SCALE: Cell<f64> = const { Cell::new(1.0) };
    /// The pressed buttons (DOM `buttons`), to release the mouse capture when the last goes up.
    static BUTTONS: Cell<u16> = const { Cell::new(0) };
    /// The pointer lock, while the page holds it: where the cursor was when it was taken (it goes back there), and
    /// whether it leaves the system cursor alone (an injected run).
    static LOCKED: Cell<Option<(POINT, bool)>> = const { Cell::new(None) };
    /// The fiber the window's messages are pumped on (the module's doc), made once the thread is a fiber (null until).
    static PUMP_FIBER: Cell<*mut std::ffi::c_void> = const { Cell::new(std::ptr::null_mut()) };
    /// The fiber that asked for the pump (the program's loop), the wait it asked for, and the pump's answer.
    static PUMP_CALLER: Cell<*mut std::ffi::c_void> = const { Cell::new(std::ptr::null_mut()) };
    static PUMP_WAIT: Cell<Option<f64>> = const { Cell::new(None) };
    static PUMP_ANSWER: Cell<bool> = const { Cell::new(false) };
    /// A modal loop of Windows' own is running on the pump fiber (between WM_ENTERSIZEMOVE or WM_ENTERMENULOOP and
    /// their exits).
    static MODAL: Cell<bool> = const { Cell::new(false) };
    /// The pump fiber is parked inside that modal loop while the program's loop runs: its messages are the modal
    /// loop's to take, so every pump goes back into it.
    static PARKED: Cell<bool> = const { Cell::new(false) };
    /// navigator.wakeLock is held (the display stays on while the page is visible).
    static AWAKE: Cell<bool> = const { Cell::new(false) };
    /// Whether the window asked to hear the mouse leave (TrackMouseEvent), since it last left.
    static TRACKING: Cell<bool> = const { Cell::new(false) };
    /// The document's cursor over the client area: a system cursor or one made from a CSS cursor image (null: `none`;
    /// None: the arrow, before the document has named one).
    static CURSOR: Cell<Option<wm::HCURSOR>> = const { Cell::new(None) };
    /// The cursors made from CSS cursor images, by image, hotspot and scale (null: the image makes none). Kept for the
    /// run: a page has a handful.
    static CUSTOM_CURSORS: RefCell<HashMap<String, wm::HCURSOR>> = RefCell::new(HashMap::new());
    /// SCRIPTC_HOST_TRACE: when the window procedure heard the last key go down (not a repeat), and that key once
    /// dispatched, for the trace's input-to-present latency.
    static KEY_AT: Cell<Option<Instant>> = const { Cell::new(None) };
    static KEY_SEEN: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// The window's size in CSS px: SCRIPTC_HOST_WINDOW (`<w>x<h>`; `0` or empty for none), else, for an installed build
/// (its page beside the executable), 1280x800 scaled down to fit the primary monitor's work area.
fn requested_size() -> Option<(f64, f64)> {
    let Ok(v) = std::env::var("SCRIPTC_HOST_WINDOW") else {
        return crate::installed(crate::config::get().installed_page).map(|_| default_size());
    };
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

/// `w`x`h` CSS px, both scaled by one factor (at most 1) so the window, frame included, fits the primary monitor's
/// work area at the system's DPI.
fn fitted_size(w: f64, h: f64) -> (f64, f64) {
    let mut area = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    // SAFETY: SPI_GETWORKAREA writes one RECT into the one given; GetDpiForSystem has no preconditions.
    let (ok, dpi) = unsafe { (wm::SystemParametersInfoW(wm::SPI_GETWORKAREA, 0, (&raw mut area).cast(), 0) != 0, GetDpiForSystem().max(96)) };
    if !ok {
        return (w, h);
    }
    let scale = dpi as f64 / 96.0;
    // Room for the title bar and borders (about 40 CSS px tall, 16 wide).
    let (aw, ah) = ((area.right - area.left) as f64 / scale - 16.0, (area.bottom - area.top) as f64 / scale - 40.0);
    let f = (aw / w).min(ah / h).clamp(0.25, 1.0);
    ((w * f).floor(), (h * f).floor())
}

/// The installed program's first size, in CSS px: about 85% of the primary monitor's work area at 16:10, never less than
/// 1280x800 where that fits.
fn default_size() -> (f64, f64) {
    let mut area = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    // SAFETY: SPI_GETWORKAREA writes one RECT into the one given; GetDpiForSystem has no preconditions.
    let (ok, dpi) = unsafe { (wm::SystemParametersInfoW(wm::SPI_GETWORKAREA, 0, (&raw mut area).cast(), 0) != 0, GetDpiForSystem().max(96)) };
    if !ok {
        return fitted_size(1280.0, 800.0);
    }
    let scale = dpi as f64 / 96.0;
    let (aw, ah) = ((area.right - area.left) as f64 / scale - 16.0, (area.bottom - area.top) as f64 / scale - 40.0);
    let w = (aw * 0.85).min(ah * 0.85 * 1.6).floor();
    if w < 1280.0 {
        return fitted_size(1280.0, 800.0);
    }
    (w, (w / 1.6).floor())
}

/// Where the window's place is kept (the module's doc).
fn placement_file() -> Option<std::path::PathBuf> {
    Some(crate::config::local_dir()?.join("window.txt"))
}

/// The kept place: the normal (restored) rectangle in workspace coordinates, maximized, fullscreen. None when there
/// is none, or it no longer lies on a monitor (one unplugged, a resolution lowered).
fn remembered_place() -> Option<(RECT, bool, bool)> {
    let text = std::fs::read_to_string(placement_file()?).ok()?;
    let v: Vec<i64> = text.split_whitespace().skip(1).filter_map(|t| t.parse().ok()).collect();
    if !text.starts_with("v1 ") || v.len() != 6 {
        return None;
    }
    let r = RECT { left: v[0] as i32, top: v[1] as i32, right: v[2] as i32, bottom: v[3] as i32 };
    if r.right - r.left < 200 || r.bottom - r.top < 150 {
        return None;
    }
    // Its middle on a monitor, and no larger than that monitor's work area (the rectangle in screen coordinates).
    let on_screen = to_screen(r);
    let (mx, my) = ((on_screen.left + on_screen.right) / 2, (on_screen.top + on_screen.bottom) / 2);
    let mid = RECT { left: mx, top: my, right: mx + 1, bottom: my + 1 };
    // SAFETY: plain queries of the desktop's monitors.
    unsafe {
        let monitor = MonitorFromRect(&mid, MONITOR_DEFAULTTONULL);
        if monitor.is_null() {
            return None;
        }
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, (&raw mut info).cast()) == 0 {
            return None;
        }
        let work = info.monitorInfo.rcWork;
        if r.right - r.left > work.right - work.left + 16 || r.bottom - r.top > work.bottom - work.top + 16 {
            return None;
        }
    }
    Some((r, v[4] != 0, v[5] != 0))
}

/// A workspace rectangle (GetWindowPlacement's, relative to the primary monitor's work area) in screen coordinates:
/// they differ by the work area's offset when the taskbar is at the top or the left.
fn to_screen(r: RECT) -> RECT {
    // SAFETY: plain queries of the primary monitor.
    let (dx, dy) = unsafe {
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        let primary = MonitorFromWindow(std::ptr::null_mut(), MONITOR_DEFAULTTOPRIMARY);
        if GetMonitorInfoW(primary, (&raw mut info).cast()) == 0 {
            (0, 0)
        } else {
            (info.monitorInfo.rcWork.left - info.monitorInfo.rcMonitor.left, info.monitorInfo.rcWork.top - info.monitorInfo.rcMonitor.top)
        }
    };
    RECT { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy }
}

/// Keeps the window's place for the next start: its normal rectangle (the one it had before fullscreen, when full
/// screen), whether it was maximized, and whether full screen.
fn remember_place(hwnd: HWND) {
    let Some(path) = placement_file() else { return };
    let (placement, full) = match FULL.with(|f| f.get()) {
        Some((_, placement)) => (placement, true),
        None => {
            // SAFETY: a query of this thread's own window.
            let mut placement: wm::WINDOWPLACEMENT = unsafe { std::mem::zeroed() };
            placement.length = size_of::<wm::WINDOWPLACEMENT>() as u32;
            if unsafe { wm::GetWindowPlacement(hwnd, &mut placement) } == 0 {
                return;
            }
            (placement, false)
        }
    };
    let r = placement.rcNormalPosition;
    // Minimized, it was maximized if it restores to maximized (the flag stays set after it is restored, so only then).
    let maximized = placement.showCmd == wm::SW_SHOWMAXIMIZED as u32
        || (placement.showCmd == wm::SW_SHOWMINIMIZED as u32 && placement.flags & wm::WPF_RESTORETOMAXIMIZED != 0);
    let text = format!("v1 {} {} {} {} {} {}
", r.left, r.top, r.right, r.bottom, maximized as u8, full as u8);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(&path, text) {
        eprintln!("scriptc-host window: keeping its place: {e}");
    }
}

/// The title bar dark and in the application's colours (the module's doc). Windows 10 knows only the dark mode (attribute 20
/// from 20H1); the colours are Windows 11's, and an older system refuses them harmlessly.
unsafe fn dress(hwnd: HWND) {
    let set = |attr: i32, value: u32| {
        // SAFETY: one u32 attribute of this thread's own window.
        unsafe { DwmSetWindowAttribute(hwnd, attr as u32, (&raw const value).cast(), 4) };
    };
    set(DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
    if let Some(c) = colours() {
        set(DWMWA_CAPTION_COLOR, c.caption);
        set(DWMWA_TEXT_COLOR, c.caption_text);
        set(DWMWA_BORDER_COLOR, c.border);
    }
}

/// The window hidden from the desktop (DWM's cloak) or shown: it opens cloaked until its first frame presents.
unsafe fn cloak(hwnd: HWND, on: bool) {
    let value: u32 = on as u32;
    // SAFETY: one BOOL attribute of this thread's own window.
    unsafe { DwmSetWindowAttribute(hwnd, DWMWA_CLOAK as u32, (&raw const value).cast(), 4) };
}

/// The executable's icon (resource 1) at the system's sizes for this DPI, as the title bar and the taskbar ask.
unsafe fn set_icons(hwnd: HWND, dpi: u32) {
    // SAFETY: loads from this executable's own resources, given to this thread's own window.
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        for (which, cx, cy) in [(wm::ICON_BIG, wm::SM_CXICON, wm::SM_CYICON), (wm::ICON_SMALL, wm::SM_CXSMICON, wm::SM_CYSMICON)] {
            let icon = wm::LoadImageW(instance, 1usize as *const u16, wm::IMAGE_ICON, GetSystemMetricsForDpi(cx, dpi), GetSystemMetricsForDpi(cy, dpi), wm::LR_DEFAULTCOLOR);
            if !icon.is_null() {
                wm::SendMessageW(hwnd, wm::WM_SETICON, which as WPARAM, icon as LPARAM);
            }
        }
    }
}

/// Opens the window if SCRIPTC_HOST_WINDOW asks for one (once; before the GPU and the document are made, they call
/// this first).
pub fn ensure() {
    // The window is the main thread's: a render thread (a threaded program) never opens one.
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

/// While the window is open, the longest the loop may wait on anything else: until its next self-paced frame, and a
/// refresh at most.
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
    absorb();
    WIN.with(|w| w.borrow().as_ref().is_some_and(|w| !w.input.is_empty() || w.frame_due.is_some() || w.close_requested || w.closed_by_user || w.resized || w.hidden_change.is_some() || w.toggle_fullscreen))
}

/// `window.close()`: the next turn writes the capture (when asked) and closes.
pub fn request_close() {
    WIN.with(|w| {
        if let Some(w) = w.borrow_mut().as_mut() {
            w.close_requested = true;
        }
    })
}

/// A reload asked for (page.rs `location`): the process ends after its window, even in a run driven by
/// SCRIPTC_HOST_INJECT (`close`).
static RELOAD: AtomicBool = AtomicBool::new(false);

/// `location.reload()`, or a navigation to the page's own address : the page ends as
/// a closed window's does (its place remembered, `pagehide`, the grace for what that began), and as the process exits
/// it starts the program again: no arguments (a launch's link is not taken twice), the same environment, and this
/// page's sessionStorage, which a browser's reload keeps. The new process starts as this one ends, so it never shares
/// a file this one still holds.
pub fn reload() {
    if RELOAD.swap(true, Ordering::AcqRel) {
        return;
    }
    unsafe extern "C" {
        fn atexit(f: extern "C" fn()) -> i32;
    }
    // A process whose loop ends by itself exits through the C runtime, which calls this. The grace's exit (`close`)
    // calls it itself: the standard library's exit is ExitProcess, which skips the C runtime's handlers.
    // SAFETY: a handler of no arguments for the C runtime to call as the process exits.
    unsafe { atexit(start_again) };
    request_close();
}

/// The reload's new process (once, and only after a reload).
extern "C" fn start_again() {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if !RELOAD.load(Ordering::Acquire) || STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let mut command = std::process::Command::new(exe);
    let session = crate::page::session_storage_text();
    // An environment variable holds at most 32767 characters: a larger store stays behind.
    if session.len() <= 16 * 1024 {
        command.env(crate::config::var_name(crate::page::SESSION_CARRIED), session);
    } else {
        command.env_remove(crate::config::var_name(crate::page::SESSION_CARRIED));
    }
    match crate::layer::get().spawn(&mut command) {
        Ok(child) => eprintln!("scriptc-host window: reloaded as process {}", child.id()),
        Err(e) => eprintln!("scriptc-host window: the reload could not start the program again: {e}"),
    }
}

/// The main thread's waker, from the main thread (its first host call, before any window).
pub fn init_main_waker() {
    *MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::modules::waker());
    // SCRIPTC_HOST_PROFILE: the sampler, which takes this thread as the page's.
    crate::profile::start();
}

/// Turns the main thread's loop from any thread: its sleep in the message queue (a posted message) and its wait on
/// the pool (its waker) both end.
pub fn wake() {
    WOKEN.store(true, Ordering::Release);
    if let Some(waker) = MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        waker.wake();
    }
    let hwnd = HWND_POSTED.load(Ordering::Acquire);
    if hwnd != 0 {
        // SAFETY: PostMessageW may be called from any thread; a window destroyed meanwhile only fails the post.
        unsafe { wm::PostMessageW(hwnd as HWND, WM_WAKE, 0, 0) };
    }
}

/// The window's class: another launch finds an open window by it (launch.rs `forward_if_running`).
pub fn window_class() -> &'static str {
    crate::config::get().window_class
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

const STYLE: wm::WINDOW_STYLE = wm::WS_OVERLAPPEDWINDOW;
const EX_STYLE: wm::WINDOW_EX_STYLE = 0;

/// The window's outer size for a client area of `cw` x `ch` physical px at `dpi`.
unsafe fn outer_size(cw: i32, ch: i32, dpi: u32) -> (i32, i32) {
    let mut r = RECT { left: 0, top: 0, right: cw, bottom: ch };
    // SAFETY: a plain computation on a local rectangle.
    unsafe { AdjustWindowRectExForDpi(&mut r, STYLE, 0, EX_STYLE, dpi) };
    (r.right - r.left, r.bottom - r.top)
}

/// The refresh of the monitor the window is on (ms), from its current display mode.
unsafe fn refresh_of(hwnd: HWND) -> Option<f64> {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, (&raw mut info).cast()) == 0 {
            return None;
        }
        let mut mode: DEVMODEW = std::mem::zeroed();
        mode.dmSize = size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) == 0 {
            return None;
        }
        // 0 and 1 are the hardware's default rate, not a rate.
        (mode.dmDisplayFrequency > 1).then(|| 1000.0 / mode.dmDisplayFrequency as f64)
    }
}

unsafe fn open(w: f64, h: f64) -> Result<Win, String> {
    unsafe {
        // Per-monitor DPI (v2): the client area in physical pixels, scaled by the monitor's DPI. A manifest that set
        // the awareness already makes this fail, harmlessly.
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let instance = GetModuleHandleW(std::ptr::null());
        let class = wide(window_class());
        let wc = wm::WNDCLASSW {
            style: wm::CS_HREDRAW | wm::CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            // The executable's own icon (resource 1, as the release build's .rc names it), when it has one.
            hIcon: wm::LoadIconW(instance, 1usize as *const u16),
            hCursor: wm::LoadCursorW(std::ptr::null_mut(), wm::IDC_ARROW),
            // Dark until the first frame presents (WM_ERASEBKGND), never the default white.
            hbrBackground: CreateSolidBrush(colours().map_or(0, |c| c.background)),
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        wm::RegisterClassW(&wc);
        // The page's <title>, as a browser titles its window.
        let title = wide(&dom::page_title().unwrap_or_else(|| crate::config::get().window_title.into()));
        // An installed program keeps its place (a test's window, sized by SCRIPTC_HOST_WINDOW or driven by
        // SCRIPTC_HOST_INJECT, neither reads nor writes it).
        let remember = std::env::var_os("SCRIPTC_HOST_WINDOW").is_none() && std::env::var_os("SCRIPTC_HOST_INJECT").is_none();
        let place = if remember { remembered_place() } else { None };
        // Made where it was kept (on that monitor, so at its DPI), else at 96 DPI and then sized for the DPI of the
        // monitor it opened on and centred there.
        let (x, y, ow, oh) = match &place {
            Some((r, _, _)) => {
                let s = to_screen(*r);
                (s.left, s.top, s.right - s.left, s.bottom - s.top)
            }
            None => {
                let (ow, oh) = outer_size(w.round() as i32, h.round() as i32, 96);
                (wm::CW_USEDEFAULT, wm::CW_USEDEFAULT, ow, oh)
            }
        };
        let hwnd = wm::CreateWindowExW(EX_STYLE, class.as_ptr(), title.as_ptr(), STYLE, x, y, ow, oh, std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null());
        if hwnd.is_null() {
            return Err(format!("CreateWindowExW failed: {}", std::io::Error::last_os_error()));
        }
        dress(hwnd);
        // Cloaked until the first frame presents (render_into), so the desktop never sees an empty window.
        cloak(hwnd, true);
        let mut restore_fullscreen = false;
        match place {
            Some((r, maximized, full)) => {
                let mut placement: wm::WINDOWPLACEMENT = std::mem::zeroed();
                placement.length = size_of::<wm::WINDOWPLACEMENT>() as u32;
                placement.showCmd = if maximized { wm::SW_SHOWMAXIMIZED } else { wm::SW_SHOWNORMAL } as u32;
                placement.rcNormalPosition = r;
                wm::SetWindowPlacement(hwnd, &placement);
                restore_fullscreen = full;
            }
            None => {
                let dpi = GetDpiForWindow(hwnd).max(96);
                let scale = dpi as f64 / 96.0;
                let (pw, ph) = (((w * scale).round() as i32).max(1), ((h * scale).round() as i32).max(1));
                let (ow, oh) = outer_size(pw, ph, dpi);
                // Centred on its monitor's work area (an installed program's first start); a test's window stays where
                // Windows put it.
                let mut at = None;
                if remember {
                    let mut info: MONITORINFOEXW = std::mem::zeroed();
                    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
                    if GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), (&raw mut info).cast()) != 0 {
                        let a = info.monitorInfo.rcWork;
                        at = Some((a.left + ((a.right - a.left) - ow).max(0) / 2, a.top + ((a.bottom - a.top) - oh).max(0) / 2));
                    }
                }
                match at {
                    Some((x, y)) => wm::SetWindowPos(hwnd, std::ptr::null_mut(), x, y, ow, oh, wm::SWP_NOZORDER | wm::SWP_NOACTIVATE),
                    None => wm::SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, ow, oh, wm::SWP_NOMOVE | wm::SWP_NOZORDER | wm::SWP_NOACTIVATE),
                };
                wm::ShowWindow(hwnd, wm::SW_SHOW);
            }
        }
        let dpi = GetDpiForWindow(hwnd).max(96);
        let scale = dpi as f64 / 96.0;
        SCALE.with(|s| s.set(scale));
        set_icons(hwnd, dpi);
        let mut client = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        wm::GetClientRect(hwnd, &mut client);
        let (pw, ph) = (((client.right - client.left) as u32).max(1), ((client.bottom - client.top) as u32).max(1));

        let gpu = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        // No hinstance in the handle: a Vulkan surface needs one, and given one wgpu prefers the Vulkan adapter, where
        // NVIDIA's shader compiler (nvgpucomp64.dll) crashes on one of a page's pipelines (2026-11-20). DX12 only.
        let handle = rwh::Win32WindowHandle::new(NonZeroIsize::new(hwnd as isize).ok_or("a null HWND")?);
        let surface = gpu
            .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                raw_display_handle: Some(rwh::RawDisplayHandle::Windows(rwh::WindowsDisplayHandle::new())),
                raw_window_handle: rwh::RawWindowHandle::Win32(handle),
            })
            .map_err(|e| format!("create surface: {e}"))?;
        let adapter = pollster::block_on(gpu.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() }))
            .map_err(|e| format!("no adapter for the window: {e}"))?;
        let (mut features, limits) = gpu_stream_wgpu::web_device_asks(&adapter);
        // DRAW_LIST's native backend draws a bucket as one count-limited multi-draw where the adapter has it
        // (gpu-stream-wgpu draw_list.rs); a native-only feature, never reported to the page.
        features |= adapter.features() & wgpu::Features::MULTI_DRAW_INDIRECT_COUNT;
        // <PREFIX>GPU_TIMING=2 times the draws inside each pass (gpu-stream-wgpu timing.rs marks); profiling only.
        if crate::config::var("GPU_TIMING").as_deref() == Ok("2") {
            // And counts each draw group's shaded fragments where the adapter offers it (DX12: the vendored wgpu-hal with
            // WGPU_DX12_PIPELINE_STATISTICS=1).
            features |= adapter.features() & (wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES | wgpu::Features::PIPELINE_STATISTICS_QUERY);
        }
        // The driver's pipeline cache, kept across runs where wgpu has one (the layer's; Vulkan).
        if let Some(local) = crate::config::local_dir() {
            features |= crate::layer::get().pipeline_cache_features(&adapter, &local.join("pipeline-cache"));
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
        let format = [wgpu::TextureFormat::Bgra8Unorm, wgpu::TextureFormat::Rgba8Unorm].into_iter().find(|f| caps.formats.contains(f)).unwrap_or(caps.formats[0]);
        let mut usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
        if caps.usages.contains(wgpu::TextureUsages::COPY_SRC) {
            usage |= wgpu::TextureUsages::COPY_SRC;
        }
        let config = wgpu::SurfaceConfiguration {
            usage,
            format,
            width: pw,
            height: ph,
            present_mode: if std::env::var("SCRIPTC_HOST_PRESENT").as_deref() == Ok("immediate") { wgpu::PresentMode::Immediate } else { wgpu::PresentMode::Fifo },
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            color_space: Default::default(),
        };
        surface.configure(&device, &config);
        let compositor = Arc::new(compositor(&device, format));
        // The surface is shared with whichever thread presents (this one, or the render thread's GPU thread:
        // [`executor_frame`]), each acquire-to-present under the presenter's lock.
        *PRESENTER.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(Presenter { surface, device: device.clone(), queue: queue.clone(), config: config.clone(), configured: Instant::now(), compositor: compositor.clone() });
        let _ = pacing_ms(Instant::now());
        // A render thread's GPU stream (a threaded program) draws on this device; the window composites its scene.
        crate::relay::publish_device(device.clone(), queue.clone(), config.width, config.height);

        let refresh_ms = refresh_of(hwnd).unwrap_or(1000.0 / 60.0);
        crate::timers::REFRESH_US.store((refresh_ms * 1000.0) as u64, Ordering::Relaxed);
        // The loop's timed waits (the self-paced frames, the program's timers) at a millisecond, not the system's
        // default 15.6 ms tick, while the window is open.
        timeBeginPeriod(1);
        *MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::modules::waker());
        HWND_POSTED.store(hwnd as isize, Ordering::Release);
        let vsync_thread = std::thread::Builder::new().name("scriptc-host vsync".into()).spawn(move || vsync_loop(refresh_ms)).ok();

        // `@<frame>`, or `@<n>ms` (milliseconds after the window opened: a page that presents only when it changes
        // never advances its frame count), marked by the top bit until they are parted below.
        let parsed: Vec<(Injected, u64)> = std::env::var("SCRIPTC_HOST_INJECT")
            .unwrap_or_default()
            .split(';')
            .filter_map(|item| {
                let (what, frame) = item.trim().rsplit_once('@')?;
                let (frame, timed) = match frame.trim().strip_suffix("ms") {
                    Some(ms) => (ms, true),
                    None => (frame.trim(), false),
                };
                let frame = frame.parse::<u64>().ok()? | if timed { 1 << 63 } else { 0 };
                if let Some(text) = what.trim().strip_prefix("clicktext:") {
                    return Some((Injected::ClickText(text.trim().to_string()), frame));
                }
                match what.trim() {
                    "capture" => return Some((Injected::Capture(None), frame)),
                    "dump" => return Some((Injected::Dump, frame)),
                    _ => {}
                }
                let xy = |rest: &str| -> Option<(f64, f64)> {
                    let (x, y) = rest.split_once(',')?;
                    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
                };
                if let Some(name) = what.strip_prefix("capture:") {
                    return Some((Injected::Capture(Some(name.trim().to_string())), frame));
                }
                if let Some(rest) = what.strip_prefix("click:") {
                    let (x, y) = xy(rest)?;
                    return Some((Injected::Click(x, y), frame));
                }
                for (prefix, button, down) in [("ldown:", 0, true), ("lup:", 0, false), ("rdown:", 2, true), ("rup:", 2, false)] {
                    if let Some(rest) = what.strip_prefix(prefix) {
                        let (x, y) = xy(rest)?;
                        return Some((Injected::Button(button, down, x, y), frame));
                    }
                }
                if let Some(rest) = what.strip_prefix("move:") {
                    let (x, y) = xy(rest)?;
                    return Some((Injected::Move(x, y), frame));
                }
                if let Some(rest) = what.strip_prefix("wheel:") {
                    let (at, n) = rest.rsplit_once(',')?;
                    let (x, y) = xy(at)?;
                    return Some((Injected::Wheel(x, y, n.trim().parse().ok()?), frame));
                }
                if let Some(chord) = what.strip_prefix("chord:") {
                    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_MENU, VK_SHIFT};
                    let parts: Vec<&str> = chord.trim().split('+').collect();
                    let (key, held) = parts.split_last()?;
                    let mods = held
                        .iter()
                        .map(|m| match m.to_ascii_lowercase().as_str() {
                            "ctrl" | "control" => Some(VK_CONTROL),
                            "shift" => Some(VK_SHIFT),
                            "alt" => Some(VK_MENU),
                            _ => None,
                        })
                        .collect::<Option<Vec<u16>>>()?;
                    let vk = match key.chars().count() {
                        // SAFETY: a plain query of the keyboard layout.
                        1 => (VkKeyScanW(key.chars().next()? as u16) & 0xff) as u16,
                        _ => named_vk(key)?,
                    };
                    return Some((Injected::Chord(mods, vk, chord.trim().to_string()), frame));
                }
                if let Some(text) = what.strip_prefix("clip:") {
                    return Some((Injected::Clip(text.replace("\\n", "\n")), frame));
                }
                if let Some(size) = what.strip_prefix("resize:") {
                    let (w, h) = size.split_once('x')?;
                    return Some((Injected::Resize(w.trim().parse().ok()?, h.trim().parse().ok()?), frame));
                }
                let alnum = |rest: &str| rest.chars().next().filter(char::is_ascii_alphanumeric);
                for (prefix, down) in [("down:", true), ("up:", false)] {
                    if let Some(rest) = what.strip_prefix(prefix).map(str::trim) {
                        // A named key held (`down:Escape`) goes down once, without the keyboard's repeats.
                        if rest.chars().count() > 1 {
                            return Some((Injected::NamedKeyHeld(named_vk(rest)?, rest.to_string(), down), frame));
                        }
                        return Some((Injected::KeyHeld(alnum(rest)?, down), frame));
                    }
                }
                let key = what.strip_prefix("key:")?.trim();
                if key.chars().count() > 1 {
                    return Some((Injected::NamedKey(named_vk(key)?, key.to_string()), frame));
                }
                Some((Injected::Key(alnum(key)?), frame))
            })
            .collect();
        let inject: Vec<(Injected, u64)> = parsed.iter().filter(|(_, f)| f >> 63 == 0).cloned().collect();
        let timed: Vec<(Injected, u64)> = parsed.iter().filter(|(_, f)| f >> 63 == 1).map(|(i, f)| (i.clone(), f & !(1 << 63))).collect();
        INJECTING.store(!parsed.is_empty(), Ordering::Relaxed);
        let info = adapter.get_info();
        eprintln!(
            "scriptc-host window: {w}x{h} CSS px at scale {scale} ({dpi} DPI), {}x{} px {format:?}, refresh {refresh_ms:.2} ms, {:?} on {}",
            config.width, config.height, info.backend, info.name
        );
        Ok(Win {
            hwnd,
            device,
            queue,
            config,
            scale,
            configured: Instant::now(),
            refresh_ms,
            input: VecDeque::new(),
            compositor,
            overlay: None,
            overlay_back: None,
            published_place: (None, Vec::new()),
            ui_gpu: None,
            ui_cpu: crate::config::var("UI_CPU").as_deref() == Ok("1"),
            offscreen: None,
            dirty: true,
            resized: false,
            scene_presented: 0,
            frames: 0,
            frame_due: None,
            last_due: Instant::now(),
            ticking: false,
            close_requested: false,
            closed_by_user: false,
            inject,
            timed,
            opened: Instant::now(),
            paint_ms: Vec::new(),
            vsync_thread,
            minimized: false,
            hidden_change: None,
            toggle_fullscreen: false,
            cloaked: true,
            remember,
            restore_fullscreen,
        })
    }
}

/// The vsync thread: one wait per compositor frame (DwmFlush), the refresh noted and the window posted (one message
/// in the queue at a time). DwmFlush fails while the compositor is not presenting (a remote session's start, a locked
/// session): the thread then sleeps a refresh, and the window paces itself.
fn vsync_loop(refresh_ms: f64) {
    while HWND_POSTED.load(Ordering::Acquire) != 0 {
        // Minimized, a refresh only every HIDDEN_FRAME_MS (the window would drop the rest), not a wake per refresh.
        if MINIMIZED.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_secs_f64(HIDDEN_FRAME_MS / 1000.0));
        // SAFETY: a plain wait on the desktop compositor.
        } else if unsafe { DwmFlush() } < 0 {
            std::thread::sleep(Duration::from_secs_f64(refresh_ms / 1000.0));
            continue;
        }
        let now = vblank_instant().unwrap_or_else(Instant::now);
        *VSYNC.lock().unwrap_or_else(|e| e.into_inner()) = Some(now);
        // A render thread's frames run on this refresh (timers::render_vsync_on).
        crate::timers::vblank(now);
        if frame_trace() {
            eprintln!("vblank at {:.2}", pacing_ms(now));
        }
        {
            let mut iv = VSYNC_INTERVALS.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(last) = iv.0.replace(now) {
                if iv.1.len() < 100_000 {
                    iv.1.push(now.duration_since(last).as_secs_f64() * 1000.0);
                }
            }
        }
        if !VSYNC_POSTED.swap(true, Ordering::AcqRel) {
            let hwnd = HWND_POSTED.load(Ordering::Acquire);
            if hwnd != 0 {
                // SAFETY: PostMessageW from another thread.
                unsafe { wm::PostMessageW(hwnd as HWND, WM_VSYNC, 0, 0) };
            }
            // The loop may be waiting on the workers rather than on the message queue.
            if let Some(waker) = MAIN_WAKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                waker.wake();
            }
        }
    }
}

// kernel32's performance counter (windows-sys has it under a feature this crate does not enable).
#[link(name = "kernel32")]
unsafe extern "system" {
    fn QueryPerformanceCounter(count: *mut i64) -> i32;
    fn QueryPerformanceFrequency(frequency: *mut i64) -> i32;
}

/// A refresh is stamped with the display's last vertical blank (DwmGetCompositionTimingInfo's qpcVBlank) instead of
/// the moment DwmFlush returned, which wanders by a few milliseconds from refresh to refresh (the compositor's own
/// work, the thread's wake). The frame callbacks' timestamps, and so the program's frame deltas, then step by whole
/// refreshes, as a browser's do. None (the DwmFlush instant stands) when DWM has no answer, or with
/// SCRIPTC_HOST_VBLANK=0 (the DwmFlush instant always).
fn vblank_instant() -> Option<Instant> {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if !*ON.get_or_init(|| std::env::var("SCRIPTC_HOST_VBLANK").as_deref() != Ok("0")) {
        return None;
    }
    // SAFETY: plain queries; DWM_TIMING_INFO is written whole (cbSize set).
    unsafe {
        let mut info: DWM_TIMING_INFO = std::mem::zeroed();
        info.cbSize = size_of::<DWM_TIMING_INFO>() as u32;
        if DwmGetCompositionTimingInfo(std::ptr::null_mut(), &mut info) < 0 || info.qpcRefreshPeriod == 0 {
            return None;
        }
        let (mut now, mut freq) = (0i64, 0i64);
        if QueryPerformanceCounter(&mut now) == 0 || QueryPerformanceFrequency(&mut freq) == 0 || freq <= 0 {
            return None;
        }
        let period = info.qpcRefreshPeriod as i64;
        let mut age = now - info.qpcVBlank as i64;
        // The last vblank at or before now (DWM may report the next one).
        while age < 0 {
            age += period;
        }
        if age > 2 * period {
            return None;
        }
        Instant::now().checked_sub(Duration::from_secs_f64(age as f64 / freq as f64))
    }
}

fn queue(event: Event) {
    EVENTS.with(|e| e.borrow_mut().push_back(event));
}

/// What the window procedure queued, into the window: input to dispatch, a refresh due, a resize or close to notice.
fn absorb() {
    let events: Vec<Event> = EVENTS.with(|e| e.borrow_mut().drain(..).collect());
    if events.is_empty() {
        return;
    }
    WIN.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else { return };
        for event in events {
            match event {
                Event::Input(input) => w.input.push_back(input),
                Event::Vsync(at) => {
                    // Minimized, a refresh makes a frame due only every HIDDEN_FRAME_MS.
                    if w.minimized && w.last_due.elapsed().as_secs_f64() * 1000.0 < HIDDEN_FRAME_MS {
                        continue;
                    }
                    w.frame_due = Some(timers::now_ms() - at.elapsed().as_secs_f64() * 1000.0);
                    w.last_due = Instant::now();
                    w.ticking = false;
                }
                Event::Size => w.resized = true,
                Event::Close => w.closed_by_user = true,
                Event::Hidden(hidden) => {
                    if w.minimized != hidden {
                        w.minimized = hidden;
                        MINIMIZED.store(hidden, Ordering::Release);
                        w.hidden_change = Some(hidden);
                    }
                }
                Event::ToggleFullscreen => w.toggle_fullscreen = true,
            }
        }
    });
}

fn mods() -> Mods {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};
    // SAFETY: plain queries of the thread's keyboard state.
    let down = |vk: u16| unsafe { GetKeyState(vk as i32) } < 0;
    Mods { shift: down(VK_SHIFT), ctrl: down(VK_CONTROL), alt: down(VK_MENU), meta: down(VK_LWIN) || down(VK_RWIN) }
}

/// The DOM's `buttons` from a mouse message's key state.
fn buttons_of(wparam: WPARAM) -> u16 {
    let k = wparam as u32;
    let mut b = 0;
    for (mk, bit) in [(MK_LBUTTON, 1), (MK_RBUTTON, 2), (MK_MBUTTON, 4), (MK_XBUTTON1, 8), (MK_XBUTTON2, 16)] {
        if k & mk != 0 {
            b |= bit;
        }
    }
    b
}

/// A message's signed client coordinates (GET_X_LPARAM, GET_Y_LPARAM).
fn point_of(lparam: LPARAM) -> (i32, i32) {
    ((lparam & 0xffff) as i16 as i32, ((lparam >> 16) & 0xffff) as i16 as i32)
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let scale = SCALE.with(|s| s.get());
    let pointer = |kind: PointerKind, x: i32, y: i32, button: i16, buttons: u16| {
        queue(Event::Input(Input::Pointer { kind, x: x as f64 / scale, y: y as f64 / scale, button, buttons, mods: mods(), touch: None }));
    };
    match msg {
        WM_VSYNC => {
            VSYNC_POSTED.store(false, Ordering::Release);
            if let Some(at) = VSYNC.lock().unwrap_or_else(|e| e.into_inner()).take() {
                queue(Event::Vsync(at));
            }
            // SAFETY: on the pump fiber inside a modal loop, a posted message's dispatch (the module's doc).
            unsafe { yield_from_modal() };
            0
        }
        WM_WAKE => {
            // SAFETY: as above.
            unsafe { yield_from_modal() };
            0
        }
        wm::WM_TIMER if wparam == LIVE_TIMER => {
            // SAFETY: as above.
            unsafe { yield_from_modal() };
            0
        }
        // A modal loop of Windows' own begins (a drag of the border or title bar, the window menu): the program's loop
        // keeps turning from inside it (the module's doc), at each refresh and at least every 10 ms.
        wm::WM_ENTERSIZEMOVE | wm::WM_ENTERMENULOOP => {
            MODAL.with(|m| m.set(true));
            // SAFETY: a timer on this thread's own window.
            unsafe { wm::SetTimer(hwnd, LIVE_TIMER, 10, None) };
            0
        }
        wm::WM_EXITSIZEMOVE | wm::WM_EXITMENULOOP => {
            MODAL.with(|m| m.set(false));
            // SAFETY: as above.
            unsafe { wm::KillTimer(hwnd, LIVE_TIMER) };
            0
        }
        wm::WM_GETMINMAXINFO => {
            // SAFETY: the system's MINMAXINFO for this message; the DPI of this thread's own window.
            unsafe {
                let info = &mut *(lparam as *mut wm::MINMAXINFO);
                let dpi = GetDpiForWindow(hwnd).max(96);
                let s = dpi as f64 / 96.0;
                let (ow, oh) = outer_size((MIN_CSS.0 * s) as i32, (MIN_CSS.1 * s) as i32, dpi);
                // Full screen (a popup over the monitor) has no frame to keep a least size by.
                if FULL.with(|f| f.get()).is_none() {
                    info.ptMinTrackSize = POINT { x: ow, y: oh };
                }
            }
            0
        }
        // Another launch's link (launch.rs): its fragment, checked again here, becomes the page's address on the
        // loop's next turn.
        wm::WM_COPYDATA => {
            let data = lparam as *const windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
            if data.is_null() {
                return 0;
            }
            // SAFETY: the system copied the sender's block into this process for the duration of the message.
            let data = unsafe { &*data };
            if data.dwData != crate::launch::COPYDATA_FRAGMENT || data.lpData.is_null() || data.cbData as usize > crate::launch::MAX_FRAGMENT {
                return 0;
            }
            // SAFETY: as above, cbData bytes at lpData.
            let bytes = unsafe { std::slice::from_raw_parts(data.lpData as *const u8, data.cbData as usize) };
            match std::str::from_utf8(bytes).ok().and_then(crate::launch::valid_fragment) {
                Some(fragment) => {
                    crate::page::open_fragment(fragment);
                    1
                }
                None => 0,
            }
        }
        wm::WM_MOUSEMOVE => {
            // While a test injects input, the real cursor's moves (Windows sends them whenever the cursor rests over
            // the window and something changes) would undo the injected position: only injected moves count.
            if INJECTING.load(Ordering::Relaxed) && wparam & INJECTED_MOVE == 0 {
                return 0;
            }
            let wparam = wparam & !INJECTED_MOVE;
            let (x, y) = point_of(lparam);
            // Locked, a move is the motion away from the centre, and the cursor goes back there.
            if let Some((_, injected)) = LOCKED.with(|l| l.get()) {
                // SAFETY: queries and the cursor's position for this thread's own window.
                let (cx, cy) = unsafe { client_centre(hwnd).0 };
                let (dx, dy) = (x - cx, y - cy);
                if dx != 0 || dy != 0 {
                    queue(Event::Input(Input::Motion { dx: f64::from(dx) / scale, dy: f64::from(dy) / scale, buttons: buttons_of(wparam), mods: mods() }));
                    if !injected {
                        let mut c = POINT { x: cx, y: cy };
                        // SAFETY: as above.
                        unsafe {
                            ClientToScreen(hwnd, &mut c);
                            wm::SetCursorPos(c.x, c.y);
                        }
                    }
                }
                return 0;
            }
            // The page hears the mouse leave the window (WM_MOUSELEAVE), once per visit; not in an injected run, whose
            // posted moves are not where the system's cursor is.
            if !INJECTING.load(Ordering::Relaxed) && !TRACKING.with(|t| t.replace(true)) {
                let mut track = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                // SAFETY: a tracking request for this thread's own window.
                unsafe { TrackMouseEvent(&mut track) };
            }
            pointer(PointerKind::Move, x, y, 0, buttons_of(wparam));
            0
        }
        WM_MOUSELEAVE => {
            TRACKING.with(|t| t.set(false));
            // A drag that leaves the window keeps the mouse (the capture) until its button goes up.
            if BUTTONS.with(|b| b.get()) == 0 {
                queue(Event::Input(Input::Leave));
            }
            0
        }
        // The document's cursor over the client area (none while the pointer is locked).
        wm::WM_SETCURSOR if (lparam & 0xffff) as u32 == wm::HTCLIENT => {
            let cursor = if LOCKED.with(|l| l.get()).is_some() { std::ptr::null_mut() } else { current_cursor() };
            // SAFETY: the cursor for this thread's own window.
            unsafe { wm::SetCursor(cursor) };
            1
        }
        wm::WM_SETFOCUS => {
            queue(Event::Input(Input::Focus(true)));
            0
        }
        wm::WM_KILLFOCUS => {
            // The lock goes with the focus, as a browser's does.
            // SAFETY: the system cursor, given back.
            if unsafe { release_cursor() } {
                queue(Event::Input(Input::LockLost));
            }
            queue(Event::Input(Input::Focus(false)));
            0
        }
        wm::WM_LBUTTONDOWN | wm::WM_RBUTTONDOWN | wm::WM_MBUTTONDOWN | wm::WM_XBUTTONDOWN | wm::WM_LBUTTONUP | wm::WM_RBUTTONUP | wm::WM_MBUTTONUP | wm::WM_XBUTTONUP => {
            let (x, y) = point_of(lparam);
            // The DOM's 0 main, 1 auxiliary, 2 secondary, 3 back, 4 forward.
            let button = match msg {
                wm::WM_LBUTTONDOWN | wm::WM_LBUTTONUP => 0,
                wm::WM_MBUTTONDOWN | wm::WM_MBUTTONUP => 1,
                wm::WM_RBUTTONDOWN | wm::WM_RBUTTONUP => 2,
                _ if (wparam >> 16) & 0xffff == wm::XBUTTON1 as usize => 3,
                _ => 4,
            };
            let down = matches!(msg, wm::WM_LBUTTONDOWN | wm::WM_RBUTTONDOWN | wm::WM_MBUTTONDOWN | wm::WM_XBUTTONDOWN);
            let buttons = buttons_of(wparam);
            // The window keeps the mouse while a button is down, so the up reaches it outside the client area.
            // SAFETY: capture on this thread's own window.
            unsafe {
                if down && BUTTONS.with(|b| b.get()) == 0 {
                    SetCapture(hwnd);
                } else if !down && buttons == 0 {
                    ReleaseCapture();
                }
            }
            BUTTONS.with(|b| b.set(buttons));
            pointer(if down { PointerKind::Down } else { PointerKind::Up }, x, y, button, buttons);
            // XBUTTON messages answer TRUE.
            if matches!(msg, wm::WM_XBUTTONDOWN | wm::WM_XBUTTONUP) { 1 } else { 0 }
        }
        wm::WM_MOUSEWHEEL | wm::WM_MOUSEHWHEEL => {
            // Screen coordinates, unlike the other mouse messages.
            let (sx, sy) = point_of(lparam);
            let mut p = POINT { x: sx, y: sy };
            // SAFETY: a conversion on this thread's own window.
            unsafe { ScreenToClient(hwnd, &mut p) };
            // A notch (WHEEL_DELTA, 120) scrolls the system's lines (or characters, sideways) at 100/3 CSS px each, as
            // Chromium scrolls on Windows: 100 px at the default 3; the vertical wheel's positive is away from the user
            // (up), the DOM's is down.
            let notches = ((wparam >> 16) & 0xffff) as i16 as f64 / wm::WHEEL_DELTA as f64;
            let px = wheel_lines(msg == wm::WM_MOUSEWHEEL) * 100.0 / 3.0;
            let (dx, dy) = if msg == wm::WM_MOUSEWHEEL { (0.0, -notches * px) } else { (notches * px, 0.0) };
            pointer(PointerKind::Wheel { dx, dy }, p.x, p.y, 0, buttons_of(wparam & 0xffff));
            0
        }
        wm::WM_KEYDOWN | wm::WM_SYSKEYDOWN | wm::WM_KEYUP | wm::WM_SYSKEYUP => {
            let down = matches!(msg, wm::WM_KEYDOWN | wm::WM_SYSKEYDOWN);
            let vk = wparam as u16;
            let scan = ((lparam >> 16) & 0xff) as u32;
            let extended = lparam & (1 << 24) != 0;
            let repeat = down && lparam & (1 << 30) != 0;
            // Alt+F4 still closes the window.
            if msg == wm::WM_SYSKEYDOWN && vk == windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_F4 {
                // SAFETY: the default handling of this window's own message.
                return unsafe { wm::DefWindowProcW(hwnd, msg, wparam, lparam) };
            }
            // Alt+Enter and F11 are the window's: fullscreen toggled once per press (a browser's F11), the page not
            // hearing the key.
            {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_F11, VK_RETURN};
                let alt_enter = matches!(msg, wm::WM_SYSKEYDOWN | wm::WM_SYSKEYUP) && vk == VK_RETURN;
                if alt_enter || vk == VK_F11 {
                    if down && !repeat {
                        queue(Event::ToggleFullscreen);
                    }
                    return 0;
                }
            }
            let m = mods();
            let key = key_of(vk, scan, &m);
            let code = code_of(scan, extended, vk);
            if down && !repeat && frame_trace() {
                KEY_AT.with(|k| k.set(Some(Instant::now())));
            }
            queue(Event::Input(Input::Key { down, key, code, mods: m, repeat }));
            0
        }
        // Alt alone or Alt+key would enter the (absent) menu bar's modal loop, and beep.
        wm::WM_SYSCHAR => 0,
        wm::WM_SYSCOMMAND if (wparam & 0xfff0) as u32 == wm::SC_KEYMENU => 0,
        wm::WM_SIZE => {
            // Minimized hides the page; restored or maximized shows it.
            queue(Event::Hidden(wparam as u32 == wm::SIZE_MINIMIZED));
            // A locked cursor stays held in the client area it now has.
            if matches!(LOCKED.with(|l| l.get()), Some((_, false))) {
                // SAFETY: the cursor, for this thread's own window.
                unsafe { hold_cursor(hwnd) };
            }
            queue(Event::Size);
            0
        }
        wm::WM_DPICHANGED => {
            SCALE.with(|s| s.set(((wparam >> 16) & 0xffff).max(96) as f64 / 96.0));
            // The suggested rectangle keeps the window's size in CSS px on the new monitor.
            let r = unsafe { &*(lparam as *const RECT) };
            // SAFETY: sizing this thread's own window (it sends WM_SIZE back here, which only queues).
            unsafe { wm::SetWindowPos(hwnd, std::ptr::null_mut(), r.left, r.top, r.right - r.left, r.bottom - r.top, wm::SWP_NOZORDER | wm::SWP_NOACTIVATE) };
            queue(Event::Size);
            0
        }
        wm::WM_CLOSE => {
            queue(Event::Close);
            0
        }
        // The surface covers the client area once a frame has presented: no background to erase; before it, the class's
        // dark one.
        wm::WM_ERASEBKGND if WIN.with(|w| w.try_borrow().ok().and_then(|w| w.as_ref().map(|w| !w.cloaked)).unwrap_or(true)) => 1,
        // SAFETY: the default handling of this window's own message.
        _ => unsafe { wm::DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

/// The lines a wheel notch scrolls (the characters, sideways), as the user set it: 3 by default, and 3 for a page.
fn wheel_lines(vertical: bool) -> f64 {
    let mut lines: u32 = 3;
    let action = if vertical { wm::SPI_GETWHEELSCROLLLINES } else { wm::SPI_GETWHEELSCROLLCHARS };
    // SAFETY: a u32 out-parameter.
    let ok = unsafe { wm::SystemParametersInfoW(action, 0, (&mut lines as *mut u32).cast(), 0) } != 0;
    if !ok || lines == 0 || lines == u32::MAX { 3.0 } else { f64::from(lines) }
}

/// The client area's centre (client px), and the client area in screen px.
unsafe fn client_centre(hwnd: HWND) -> ((i32, i32), RECT) {
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    // SAFETY: queries of the caller's window.
    unsafe {
        wm::GetClientRect(hwnd, &mut r);
        let mut tl = POINT { x: r.left, y: r.top };
        let mut br = POINT { x: r.right, y: r.bottom };
        ClientToScreen(hwnd, &mut tl);
        ClientToScreen(hwnd, &mut br);
        (((r.right - r.left) / 2, (r.bottom - r.top) / 2), RECT { left: tl.x, top: tl.y, right: br.x, bottom: br.y })
    }
}

/// The system cursor held for the lock: confined to the client area, hidden, at its centre.
unsafe fn hold_cursor(hwnd: HWND) {
    // SAFETY: the cursor, for the caller's window.
    unsafe {
        let ((cx, cy), screen) = client_centre(hwnd);
        wm::ClipCursor(&screen);
        let mut c = POINT { x: cx, y: cy };
        ClientToScreen(hwnd, &mut c);
        wm::SetCursorPos(c.x, c.y);
        wm::SetCursor(std::ptr::null_mut());
    }
}

/// The lock's end on the window: the system cursor free, back where it was and shown. False when there was no lock.
unsafe fn release_cursor() -> bool {
    let Some((was, injected)) = LOCKED.with(|l| l.take()) else { return false };
    if !injected {
        // SAFETY: the cursor, given back.
        unsafe {
            wm::ClipCursor(std::ptr::null());
            wm::SetCursorPos(was.x, was.y);
            wm::SetCursor(current_cursor());
        }
    }
    true
}

/// dom.rs's pointer lock on the window: true when it was taken (the window has the focus) or given back.
pub fn set_pointer_lock(on: bool) -> bool {
    let hwnd = HWND_POSTED.load(Ordering::Acquire) as HWND;
    if !on {
        // SAFETY: the cursor, given back.
        unsafe { release_cursor() };
        return true;
    }
    if hwnd.is_null() {
        return false;
    }
    if LOCKED.with(|l| l.get()).is_some() {
        return true;
    }
    let injected = INJECTING.load(Ordering::Relaxed);
    let mut was = POINT { x: 0, y: 0 };
    if !injected {
        // SAFETY: the focus query and the cursor, for this thread's own window.
        unsafe {
            if wm::GetForegroundWindow() != hwnd {
                return false;
            }
            wm::GetCursorPos(&mut was);
            hold_cursor(hwnd);
        }
    }
    LOCKED.with(|l| l.set(Some((was, injected))));
    true
}

thread_local! {
    /// While the window is full screen (dom.rs's Fullscreen API): its style and placement before, put back after.
    static FULL: Cell<Option<(isize, wm::WINDOWPLACEMENT)>> = const { Cell::new(None) };
}

/// Whether the window can go full screen (it is open).
pub fn fullscreen_available() -> bool {
    HWND_POSTED.load(Ordering::Acquire) != 0
}

/// dom.rs's fullscreen on the window: borderless over the whole monitor it is on (taskbar included, as a browser's
/// fullscreen covers it), or back to the style and placement it had. The client area's change reaches the document
/// and the GPU surfaces as any resize does (WM_SIZE, then `watch`). False when there is no window.
pub fn set_fullscreen(on: bool) -> bool {
    let hwnd = HWND_POSTED.load(Ordering::Acquire) as HWND;
    if hwnd.is_null() {
        return false;
    }
    // SAFETY: styles, placement and position of this thread's own window (each sends it messages, which only queue).
    unsafe {
        if on {
            if FULL.with(|f| f.get()).is_some() {
                return true;
            }
            let mut placement: wm::WINDOWPLACEMENT = std::mem::zeroed();
            placement.length = size_of::<wm::WINDOWPLACEMENT>() as u32;
            if wm::GetWindowPlacement(hwnd, &mut placement) == 0 {
                return false;
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info: MONITORINFOEXW = std::mem::zeroed();
            info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
            if GetMonitorInfoW(monitor, (&raw mut info).cast()) == 0 {
                return false;
            }
            let style = wm::GetWindowLongPtrW(hwnd, wm::GWL_STYLE);
            FULL.with(|f| f.set(Some((style, placement))));
            wm::SetWindowLongPtrW(hwnd, wm::GWL_STYLE, style & !(wm::WS_OVERLAPPEDWINDOW as isize) | wm::WS_POPUP as isize);
            let r = info.monitorInfo.rcMonitor;
            wm::SetWindowPos(hwnd, wm::HWND_TOP, r.left, r.top, r.right - r.left, r.bottom - r.top, wm::SWP_NOOWNERZORDER | wm::SWP_FRAMECHANGED | wm::SWP_SHOWWINDOW);
        } else {
            let Some((style, placement)) = FULL.with(|f| f.take()) else { return true };
            wm::SetWindowLongPtrW(hwnd, wm::GWL_STYLE, style);
            wm::SetWindowPlacement(hwnd, &placement);
            wm::SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, wm::SWP_NOMOVE | wm::SWP_NOSIZE | wm::SWP_NOZORDER | wm::SWP_NOOWNERZORDER | wm::SWP_FRAMECHANGED);
        }
        // A locked cursor stays held in the client area it now has.
        if matches!(LOCKED.with(|l| l.get()), Some((_, false))) {
            hold_cursor(hwnd);
        }
    }
    eprintln!("scriptc-host window: {}", if on { "full screen" } else { "windowed" });
    true
}

/// navigator.wakeLock (page.rs): the display stays on while the lock is held and the page visible (a browser
/// releases it when the page hides).
pub fn stay_awake(on: bool) {
    AWAKE.with(|a| a.set(on));
    apply_awake();
}

/// The thread's execution state after the wake lock and the page's visibility.
fn apply_awake() {
    use windows_sys::Win32::System::Power::{ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, SetThreadExecutionState};
    let on = AWAKE.with(|a| a.get()) && !dom::page_hidden();
    // SAFETY: this thread's own execution state.
    unsafe { SetThreadExecutionState(if on { ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS }) };
}

/// A lock key's toggle (getModifierState's CapsLock, NumLock, ScrollLock).
pub fn lock_key_on(name: &str) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_CAPITAL, VK_NUMLOCK, VK_SCROLL};
    let vk = match name {
        "CapsLock" => VK_CAPITAL,
        "NumLock" => VK_NUMLOCK,
        "ScrollLock" => VK_SCROLL,
        _ => return false,
    };
    // SAFETY: a plain query of the thread's keyboard state.
    unsafe { GetKeyState(i32::from(vk)) & 1 != 0 }
}

/// The system cursor for a CSS cursor name (null: `none`); a cursor Windows has no shape for is the arrow.
fn cursor_handle(name: &str) -> wm::HCURSOR {
    let id = match name {
        "none" => return std::ptr::null_mut(),
        "pointer" | "grab" | "grabbing" => wm::IDC_HAND,
        "text" | "vertical-text" => wm::IDC_IBEAM,
        "crosshair" | "cell" => wm::IDC_CROSS,
        "move" | "all-scroll" => wm::IDC_SIZEALL,
        "not-allowed" | "no-drop" => wm::IDC_NO,
        "wait" => wm::IDC_WAIT,
        "progress" => wm::IDC_APPSTARTING,
        "help" => wm::IDC_HELP,
        "ew-resize" | "col-resize" | "e-resize" | "w-resize" => wm::IDC_SIZEWE,
        "ns-resize" | "row-resize" | "n-resize" | "s-resize" => wm::IDC_SIZENS,
        "nwse-resize" | "nw-resize" | "se-resize" => wm::IDC_SIZENWSE,
        "nesw-resize" | "ne-resize" | "sw-resize" => wm::IDC_SIZENESW,
        _ => wm::IDC_ARROW,
    };
    // SAFETY: a system cursor (shared, never destroyed).
    unsafe { wm::LoadCursorW(std::ptr::null_mut(), id) }
}

/// The cursor the document last named (the arrow before it has named one).
fn current_cursor() -> wm::HCURSOR {
    CURSOR.with(|c| c.get()).unwrap_or_else(|| cursor_handle("default"))
}

/// The cursor for the document's CSS cursor: the first of its `url()` images that makes one, else its keyword's.
fn document_cursor() -> wm::HCURSOR {
    let scale = SCALE.with(|s| s.get());
    dom::cursor_images()
        .into_iter()
        .map(|(url, hotspot, resolution)| custom_cursor(&url, hotspot, f64::from(resolution), scale))
        .find(|c| !c.is_null())
        .unwrap_or_else(|| cursor_handle(dom::cursor_name()))
}

/// Cursor images fetched off the window's thread (one not in a data: URL may be on the network), by URL: None while
/// the fetch runs, then the bytes (empty: it failed).
static CURSOR_FETCHES: Mutex<Option<HashMap<String, Option<Vec<u8>>>>> = Mutex::new(None);

/// A cursor image's bytes: a data: URL's at once; any other's from a fetch on a thread, None until it arrives (the
/// keyword is shown meanwhile, and the next input after it arrives picks it up). Some(empty): it cannot be had.
fn cursor_image_bytes(url: &url::Url) -> Option<Vec<u8>> {
    if url.scheme() == "data" {
        return Some(crate::modules::document_load(url).unwrap_or_default());
    }
    let mut fetches = CURSOR_FETCHES.lock().unwrap_or_else(|e| e.into_inner());
    let fetches = fetches.get_or_insert_with(HashMap::new);
    if let Some(got) = fetches.get(url.as_str()) {
        return got.clone();
    }
    fetches.insert(url.as_str().to_owned(), None);
    let url = url.clone();
    std::thread::spawn(move || {
        let bytes = crate::modules::document_load(&url).unwrap_or_default();
        CURSOR_FETCHES.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(url.as_str().to_owned(), Some(bytes));
    });
    None
}

/// The cursor made from a CSS cursor image of the resolution (image px per CSS px: an `image-set()` candidate's)
/// at the window's scale (physical px per CSS px), its hotspot in the image's CSS px (none: its top left corner).
/// Null while the image loads, or when it is not an image, cannot be read, or is over 128 CSS px either way
/// (Chrome's limit; the next image or the keyword is shown instead).
fn custom_cursor(url: &str, hotspot: Option<(f32, f32)>, resolution: f64, scale: f64) -> wm::HCURSOR {
    let key = format!("{scale}|{resolution}|{hotspot:?}|{url}");
    if let Some(cursor) = CUSTOM_CURSORS.with(|m| m.borrow().get(&key).copied()) {
        return cursor;
    }
    let Ok(parsed) = url::Url::parse(url) else {
        CUSTOM_CURSORS.with(|m| m.borrow_mut().insert(key, std::ptr::null_mut()));
        return std::ptr::null_mut();
    };
    // Still loading: nothing remembered, asked for again on the next input.
    let Some(bytes) = cursor_image_bytes(&parsed) else {
        return std::ptr::null_mut();
    };
    let cursor = cursor_pixels(&bytes, resolution.max(0.01), scale).map_or(std::ptr::null_mut(), |(w, h, bgra)| {
        let (hx, hy) = hotspot.map_or((0.0, 0.0), |(x, y)| (f64::from(x) * scale, f64::from(y) * scale));
        let hx = (hx.round().max(0.0) as u32).min(w - 1);
        let hy = (hy.round().max(0.0) as u32).min(h - 1);
        // SAFETY: bitmaps made from buffers of their own size, copied into the cursor, then deleted.
        unsafe { make_cursor(w, h, &bgra, hx, hy) }
    });
    if std::env::var_os("SCRIPTC_HOST_TRACE_INPUT").is_some() {
        let shown = url.char_indices().nth(48).map_or(url, |(i, _)| &url[..i]);
        eprintln!("input: cursor image {shown} ({} bytes, {resolution}x) at scale {scale}, hotspot {hotspot:?}: {}", bytes.len(), if cursor.is_null() { "not made" } else { "made" });
    }
    CUSTOM_CURSORS.with(|m| m.borrow_mut().insert(key, cursor));
    cursor
}

/// A cursor image's pixels at the scale: width, height, and straight-alpha BGRA8 rows top down. Its CSS size is its
/// own (an SVG's size, a raster image's pixels) over the resolution; it is drawn at that times the scale, a raster
/// image resampled when the two differ.
fn cursor_pixels(bytes: &[u8], resolution: f64, scale: f64) -> Option<(u32, u32, Vec<u8>)> {
    const MAX_CSS: f64 = 128.0;
    let factor = scale / resolution;
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    let (w, h, mut px) = if head.contains("<svg") {
        let tree = anyrender_svg::usvg::Tree::from_data(bytes, &anyrender_svg::usvg::Options::default()).ok()?;
        let (sw, sh) = (f64::from(tree.size().width()), f64::from(tree.size().height()));
        if sw / resolution > MAX_CSS || sh / resolution > MAX_CSS {
            return None;
        }
        let w = (sw * factor).ceil().max(1.0) as u32;
        let h = (sh * factor).ceil().max(1.0) as u32;
        let mut rgba = anyrender::render_to_buffer::<anyrender_vello_cpu::VelloCpuImageRenderer, _>(
            |scene| anyrender_svg::render_svg_tree(scene, &tree, kurbo::Affine::scale(factor)),
            w,
            h,
        );
        // The renderer's pixels are premultiplied; a cursor's colour bitmap is straight.
        for p in rgba.chunks_exact_mut(4) {
            let a = u32::from(p[3]);
            if a != 0 && a != 255 {
                for c in &mut p[..3] {
                    *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        (w, h, rgba)
    } else {
        let img = image::load_from_memory(bytes).ok()?.into_rgba8();
        let (iw, ih) = (f64::from(img.width()), f64::from(img.height()));
        if iw / resolution > MAX_CSS || ih / resolution > MAX_CSS {
            return None;
        }
        let w = (iw * factor).round().max(1.0) as u32;
        let h = (ih * factor).round().max(1.0) as u32;
        let img = if (w, h) == (img.width(), img.height()) { img } else { image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle) };
        (w, h, img.into_raw())
    };
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
    }
    Some((w, h, px))
}

/// A cursor from straight-alpha BGRA8 pixels (rows top down) and its hotspot, made as winit makes one.
unsafe fn make_cursor(w: u32, h: u32, bgra: &[u8], hx: u32, hy: u32) -> wm::HCURSOR {
    use windows_sys::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
    // The AND mask, all set (rows padded to 16 bits): the colour bitmap's alpha decides.
    let mask = vec![0xffu8; (w.div_ceil(16) * 2 * h) as usize];
    // SAFETY: the caller's; both buffers are the size their bitmap reads.
    unsafe {
        let color = CreateBitmap(w as i32, h as i32, 1, 32, bgra.as_ptr().cast());
        let and = CreateBitmap(w as i32, h as i32, 1, 1, mask.as_ptr().cast());
        let info = wm::ICONINFO { fIcon: 0, xHotspot: hx, yHotspot: hy, hbmMask: and, hbmColor: color };
        let cursor = if color.is_null() || and.is_null() { std::ptr::null_mut() } else { wm::CreateIconIndirect(&info) };
        if !color.is_null() {
            DeleteObject(color);
        }
        if !and.is_null() {
            DeleteObject(and);
        }
        cursor
    }
}

/// After input: the document's cursor under the mouse, shown when the mouse is over the window.
fn follow_cursor(hwnd: HWND) {
    let cursor = document_cursor();
    if CURSOR.with(|c| c.replace(Some(cursor))) == Some(cursor) || LOCKED.with(|l| l.get()).is_some() {
        return;
    }
    let mut at = POINT { x: 0, y: 0 };
    // SAFETY: queries, and the cursor while it is over this thread's own window.
    unsafe {
        if wm::GetCursorPos(&mut at) != 0 && wm::WindowFromPoint(at) == hwnd {
            wm::SetCursor(cursor);
        }
    }
}

/// The DOM's `key`: a named key's name, else the characters the key types under the current layout (Ctrl and Alt
/// set aside when they turn it into a control character, as `charactersIgnoringModifiers` does on macOS).
fn key_of(vk: u16, scan: u32, m: &Mods) -> String {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let named = match vk {
        VK_RETURN => "Enter",
        VK_TAB => "Tab",
        VK_SPACE => " ",
        VK_BACK => "Backspace",
        VK_ESCAPE => "Escape",
        VK_DELETE => "Delete",
        VK_INSERT => "Insert",
        VK_LEFT => "ArrowLeft",
        VK_RIGHT => "ArrowRight",
        VK_DOWN => "ArrowDown",
        VK_UP => "ArrowUp",
        VK_HOME => "Home",
        VK_END => "End",
        VK_PRIOR => "PageUp",
        VK_NEXT => "PageDown",
        VK_SHIFT | VK_LSHIFT | VK_RSHIFT => "Shift",
        VK_CONTROL | VK_LCONTROL | VK_RCONTROL => "Control",
        VK_MENU | VK_LMENU | VK_RMENU => "Alt",
        VK_LWIN | VK_RWIN => "Meta",
        VK_CAPITAL => "CapsLock",
        VK_NUMLOCK => "NumLock",
        VK_SCROLL => "ScrollLock",
        VK_PAUSE => "Pause",
        VK_SNAPSHOT => "PrintScreen",
        VK_APPS => "ContextMenu",
        f @ VK_F1..=VK_F24 => return format!("F{}", f - VK_F1 + 1),
        _ => "",
    };
    if !named.is_empty() {
        return named.into();
    }
    let mut state = [0u8; 256];
    // SAFETY: the thread's keyboard state into a 256-byte buffer.
    if unsafe { GetKeyboardState(state.as_mut_ptr()) } == 0 {
        return "Unidentified".into();
    }
    let typed = |state: &[u8; 256]| {
        let mut buf = [0u16; 8];
        // Flag 4: the keyboard's dead-key state is left as it was (Windows 10 1607 and later).
        // SAFETY: a 256-byte key state and an 8-unit buffer.
        let n = unsafe { ToUnicode(vk as u32, scan, state.as_ptr(), buf.as_mut_ptr(), buf.len() as i32, 4) };
        match n {
            n if n < 0 => Some("Dead".to_string()),
            0 => None,
            n => Some(String::from_utf16_lossy(&buf[..n as usize])),
        }
    };
    let control = |s: &str| s.chars().all(|c| c.is_control());
    match typed(&state) {
        Some(s) if !control(&s) => s,
        _ if m.ctrl || m.alt => {
            for vk in [VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU] {
                state[vk as usize] = 0;
            }
            typed(&state).filter(|s| !control(s)).unwrap_or_else(|| "Unidentified".into())
        }
        _ => "Unidentified".into(),
    }
}

/// The DOM's `code` (the physical key, by its US-layout name) from a key message's scan code (set 1) and extended
/// bit; the virtual key tells Pause and the numpad's keys apart where the scan code does not.
fn code_of(scan: u32, extended: bool, vk: u16) -> String {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_NUMLOCK, VK_PAUSE};
    if vk == VK_PAUSE {
        return "Pause".into();
    }
    if vk == VK_NUMLOCK {
        return "NumLock".into();
    }
    let name = if extended {
        match scan {
            0x1c => "NumpadEnter",
            0x1d => "ControlRight",
            0x35 => "NumpadDivide",
            0x37 => "PrintScreen",
            0x38 => "AltRight",
            0x47 => "Home",
            0x48 => "ArrowUp",
            0x49 => "PageUp",
            0x4b => "ArrowLeft",
            0x4d => "ArrowRight",
            0x4f => "End",
            0x50 => "ArrowDown",
            0x51 => "PageDown",
            0x52 => "Insert",
            0x53 => "Delete",
            0x5b => "MetaLeft",
            0x5c => "MetaRight",
            0x5d => "ContextMenu",
            _ => "Unidentified",
        }
    } else {
        const SET1: [&str; 0x59] = [
            "Unidentified", "Escape", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0",
            "Minus", "Equal", "Backspace", "Tab", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP",
            "BracketLeft", "BracketRight", "Enter", "ControlLeft", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK",
            "KeyL", "Semicolon", "Quote", "Backquote", "ShiftLeft", "Backslash", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN",
            "KeyM", "Comma", "Period", "Slash", "ShiftRight", "NumpadMultiply", "AltLeft", "Space", "CapsLock", "F1", "F2", "F3",
            "F4", "F5", "F6", "F7", "F8", "F9", "F10", "NumLock", "ScrollLock", "Numpad7", "Numpad8", "Numpad9", "NumpadSubtract",
            "Numpad4", "Numpad5", "Numpad6", "NumpadAdd", "Numpad1", "Numpad2", "Numpad3", "Numpad0", "NumpadDecimal",
            "Unidentified", "Unidentified", "IntlBackslash", "F11", "F12",
        ];
        SET1.get(scan as usize).copied().unwrap_or("Unidentified")
    };
    name.into()
}

/// Drains the message queue until `ms` from now (infinite: until a message arrives) or until there is work.
pub fn sleep(ms: f64) {
    if !is_open() {
        return;
    }
    let deadline = if ms.is_finite() { Some(Instant::now() + Duration::from_secs_f64(ms.max(0.0) / 1000.0)) } else { None };
    loop {
        if work_ready() || !is_open() || WOKEN.swap(false, Ordering::AcqRel) {
            return;
        }
        // The window's own tick (the compositor silent) is a deadline too.
        let tick = silent_tick();
        let until = match (deadline, tick) {
            (Some(d), Some(t)) => Some(d.min(t)),
            (d, t) => d.or(t),
        };
        let wait = until.map(|d| d.saturating_duration_since(Instant::now()).as_secs_f64());
        crate::profile::phase(Phase::Wait);
        let pumped = pump(wait);
        crate::profile::phase(Phase::Loop);
        if !pumped && (tick_if_silent() || deadline.is_some_and(|d| Instant::now() >= d)) {
            return;
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

/// The window's next self-paced frame: a refresh and a half after the compositor's last, a refresh after its own.
fn silent_tick() -> Option<Instant> {
    WIN.with(|w| {
        let w = w.borrow();
        let w = w.as_ref()?;
        let periods = if w.ticking { 1.0 } else { 1.5 };
        let ms = if w.minimized { HIDDEN_FRAME_MS.max(w.refresh_ms * periods) } else { w.refresh_ms * periods };
        Some(w.last_due + Duration::from_secs_f64(ms / 1000.0))
    })
}

/// Every message in the queue dispatched, after waiting up to `wait` seconds (None: until one arrives) when there
/// was none, on the pump fiber once there is one (the module's doc). False when none came.
fn pump(wait: Option<f64>) -> bool {
    if PARKED.with(|p| p.get()) {
        // The modal loop takes the window's messages, so even a pump that must not wait goes back into it: a busy
        // loop (a busy page never sleeps) only ever asks for those, and answering them here starved the modal
        // loop and hung the window. It comes back at its next refresh, timer tick (10 ms) or wake.
        // SAFETY: the pump fiber is parked in yield_from_modal; this thread is a fiber (it made one).
        return unsafe { resume_pump(wait) };
    }
    match pump_fiber() {
        // SAFETY: as above, the pump fiber waiting at the bottom of its loop.
        Some(_) => unsafe { resume_pump(wait) },
        None => pump_here(wait),
    }
}

/// The current fiber (GetCurrentFiber, an inline of winnt.h's: the TEB's NT_TIB.FiberData).
fn current_fiber() -> *mut std::ffi::c_void {
    let fiber: *mut std::ffi::c_void;
    // SAFETY: a read of this thread's own TEB.
    #[cfg(target_arch = "x86_64")]
    unsafe {
        std::arch::asm!("mov {}, gs:[0x20]", out(reg) fiber, options(nostack, readonly, preserves_flags));
    }
    // SAFETY: as above (x18 holds the TEB).
    #[cfg(target_arch = "aarch64")]
    unsafe {
        std::arch::asm!("ldr {}, [x18, #0x20]", out(reg) fiber, options(nostack, readonly, preserves_flags));
    }
    fiber
}

/// The pump fiber, made on first need once the program's runtime has made this thread a fiber (it converts the
/// thread itself and aborts if that fails, so the window never converts it). None until then: the pump runs here.
fn pump_fiber() -> Option<*mut std::ffi::c_void> {
    let fiber = PUMP_FIBER.with(|f| f.get());
    if !fiber.is_null() {
        return Some(fiber);
    }
    // SAFETY: a query of this thread; a fiber with its own stack (1 MiB reserved), run only by resume_pump.
    unsafe {
        if IsThreadAFiber() == 0 {
            return None;
        }
        // The runtime's own fibers' flags (0: the floating-point state is not switched; nothing here changes it).
        let fiber = CreateFiberEx(64 << 10, 1 << 20, 0, Some(pump_main), std::ptr::null());
        if fiber.is_null() {
            return None;
        }
        PUMP_FIBER.with(|f| f.set(fiber));
        Some(fiber)
    }
}

/// Switches to the pump fiber with `wait`; back here with its answer (a pump done, or a modal loop's refresh).
unsafe fn resume_pump(wait: Option<f64>) -> bool {
    PUMP_WAIT.with(|w| w.set(wait));
    PUMP_CALLER.with(|c| c.set(current_fiber()));
    // SAFETY: the caller's guarantee; the pump fiber switches back to PUMP_CALLER.
    unsafe { SwitchToFiber(PUMP_FIBER.with(|f| f.get())) };
    PUMP_ANSWER.with(|a| a.get())
}

/// The pump fiber: a pump per switch, its answer handed back.
unsafe extern "system" fn pump_main(_: *mut std::ffi::c_void) {
    loop {
        let any = pump_here(PUMP_WAIT.with(|w| w.get()));
        PUMP_ANSWER.with(|a| a.set(any));
        // SAFETY: PUMP_CALLER is the fiber that switched here.
        unsafe { SwitchToFiber(PUMP_CALLER.with(|c| c.get())) };
    }
}

/// Inside a modal loop on the pump fiber (a posted message's dispatch: the refresh, a timer tick, a wake): back to
/// the program's loop, as a pump that dispatched something; its next pump resumes here, back into the modal loop.
unsafe fn yield_from_modal() {
    let fiber = PUMP_FIBER.with(|f| f.get());
    if !MODAL.with(|m| m.get()) || fiber.is_null() || current_fiber() != fiber {
        return;
    }
    PARKED.with(|p| p.set(true));
    PUMP_ANSWER.with(|a| a.set(true));
    // SAFETY: PUMP_CALLER is the program's loop, waiting in resume_pump.
    unsafe { SwitchToFiber(PUMP_CALLER.with(|c| c.get())) };
    PARKED.with(|p| p.set(false));
}

/// The pump itself (on whichever fiber runs it).
fn pump_here(wait: Option<f64>) -> bool {
    // SAFETY: this thread's own message queue.
    unsafe {
        let mut msg: wm::MSG = std::mem::zeroed();
        let mut any = false;
        loop {
            while wm::PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, wm::PM_REMOVE) != 0 {
                any = true;
                wm::DispatchMessageW(&msg);
            }
            if any || wait == Some(0.0) {
                return any;
            }
            let ms = wait.map_or(INFINITE, |s| (s * 1000.0).ceil().min(u32::MAX as f64 - 1.0) as u32);
            let woke = wm::MsgWaitForMultipleObjectsEx(0, std::ptr::null(), ms, wm::QS_ALLINPUT, wm::MWMO_INPUTAVAILABLE);
            if woke == windows_sys::Win32::Foundation::WAIT_TIMEOUT {
                return false;
            }
            // Something arrived (or the wait failed): one more drain, then stop.
            while wm::PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, wm::PM_REMOVE) != 0 {
                any = true;
                wm::DispatchMessageW(&msg);
            }
            return any;
        }
    }
}

/// How long a composite waits for the GPU thread to run the streams its frame sent (the layer's scene: await_streams): 50 ms by
/// default, SCRIPTC_HOST_GPU_WAIT_MS otherwise (0: never; the composite then shows the last frame the GPU thread
/// finished, a frame behind). Read once.
fn gpu_wait() -> Duration {
    static WAIT: std::sync::OnceLock<Duration> = std::sync::OnceLock::new();
    *WAIT.get_or_init(|| Duration::from_secs_f64(std::env::var("SCRIPTC_HOST_GPU_WAIT_MS").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(50.0).max(0.0) / 1000.0))
}

/// SCRIPTC_HOST_TRACE=1, read once (each frame asks).
fn frame_trace() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE").is_some())
}

/// The loop turn's share (timers::run_due): pending messages drained, input dispatched, the refresh's frame callbacks
/// run and the frame composited. Callbacks that throw are reported there and the page goes on, so this answers false
/// (the signature keeps run_due's "threw" contract).
pub fn turn() -> bool {
    if !is_open() {
        return false;
    }
    // The program alive, for the updater's confirmation of a new version (the layer's lifecycle).
    crate::layer::get().heartbeat();
    pump(Some(0.0));
    absorb();
    // A busy loop never sleeps: a silent compositor's frames are made due here too.
    tick_if_silent();
    // Not while the pump fiber is parked in a modal loop of the window's (it ends with the window's next turn).
    if !PARKED.with(|p| p.get()) && WIN.with(|w| w.borrow().as_ref().is_some_and(|w| w.closed_by_user)) {
        close(false);
        return false;
    }
    watch();
    // The page hidden or shown (minimized, restored), its wake lock with it; the window's fullscreen key; a kept
    // fullscreen restored once the document has its root.
    let (hidden, toggle, restore) = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else { return (None, false, false) };
        (w.hidden_change.take(), std::mem::take(&mut w.toggle_fullscreen), w.restore_fullscreen)
    });
    if let Some(hidden) = hidden {
        dom::set_page_hidden(hidden);
        apply_awake();
    }
    if toggle {
        dom::toggle_fullscreen();
    }
    if restore && (dom::fullscreen_active() || dom::toggle_fullscreen()) {
        WIN.with(|w| {
            if let Some(w) = w.borrow_mut().as_mut() {
                w.restore_fullscreen = false;
            }
        });
    }
    // A page that has not presented in two seconds shows its window anyway (the dark background).
    let late = WIN.with(|w| w.borrow_mut().as_mut().filter(|w| w.cloaked && w.opened.elapsed() >= Duration::from_secs(2)).map(|w| {
        w.cloaked = false;
        w.hwnd
    }));
    if let Some(hwnd) = late {
        // SAFETY: this thread's own window.
        unsafe { cloak(hwnd, false) };
        crate::layer::get().shown();
    }
    // Injections timed in milliseconds (`@<n>ms`), on the turn they come due whether or not a frame presents.
    let timed = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        if w.timed.is_empty() {
            return None;
        }
        let elapsed = w.opened.elapsed().as_millis() as u64;
        let (due, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut w.timed).into_iter().partition(|(_, at)| *at <= elapsed);
        w.timed = rest;
        (!due.is_empty()).then(|| (w.hwnd, w.scale, due.into_iter().map(|(i, _)| i).collect::<Vec<_>>()))
    });
    if let Some((hwnd, scale, due)) = timed {
        run_injected(hwnd, scale, due);
    }
    // The pointer lock's changes since the last turn reach the document first (a browser's task after the request).
    dom::flush_pointer_lock_events();
    // Fullscreen's changes (after the resize they brought, as a browser's fullscreen steps follow its resize steps).
    dom::flush_fullscreen();
    let mut had_input = false;
    crate::profile::phase(Phase::Input);
    loop {
        let next = WIN.with(|w| w.borrow_mut().as_mut().and_then(|w| w.input.pop_front()));
        let Some(input) = next else { break };
        if frame_trace() && let Input::Key { down: true, .. } = &input && let Some(at) = KEY_AT.with(|k| k.take()) {
            eprintln!("key dispatched {:.2} ms after its message", at.elapsed().as_secs_f64() * 1e3);
            KEY_SEEN.with(|k| k.set(Some(at)));
        }
        WIN.with(|w| {
            if let Some(w) = w.borrow_mut().as_mut() {
                w.dirty = true;
            }
        });
        // Listeners that throw are reported by the dispatch; an Err here is the host's own.
        if let Err(e) = dom::input(&input) {
            eprintln!("scriptc-host window: input dispatch: {e}");
        }
        had_input = true;
    }
    crate::profile::phase(Phase::Loop);
    if had_input {
        dom::flush_pointer_lock_events();
        if let Some(hwnd) = WIN.with(|w| w.borrow().as_ref().map(|w| w.hwnd)) {
            follow_cursor(hwnd);
        }
    }
    if !PARKED.with(|p| p.get()) && WIN.with(|w| w.borrow().as_ref().is_some_and(|w| w.close_requested)) {
        close(true);
        return false;
    }
    let due = WIN.with(|w| w.borrow_mut().as_mut().and_then(|w| w.frame_due.take()));
    if let Some(ts) = due {
        let ran = timers::frames_waiting();
        // The refresh this frame is for, on the clock the presents are timed by (SCRIPTC_HOST_TRACE's `late`).
        FRAME_DUE_AT.with(|d| d.set(Instant::now().checked_sub(Duration::from_secs_f64((timers::now_ms() - ts).max(0.0) / 1000.0))));
        let t0 = Instant::now();
        // The document clock moves to this frame's time, once: the callbacks, the resolves they force, the observers
        // and the paint all read it (timers::frame_clock_ms).
        timers::begin_frame(ts);
        crate::profile::phase(Phase::Frame);
        timers::run_frames(ts);
        crate::profile::phase(Phase::Observers);
        // Resize and mutation observers, after the frame's callbacks and a layout pass.
        crate::observers::deliver();
        let t1 = Instant::now();
        render_into(ran, None);
        crate::profile::phase(Phase::Loop);
        // The GPU's completions are settled once the frame is presented, by the loop's turn (abi.rs io_poll,
        // settle_after_frame).
        if frame_trace() {
            let frames = WIN.with(|w| w.borrow().as_ref().map_or(0, |w| w.frames));
            if frames % 600 == 0 && let Some(report) = crate::layer::get().trace_report() {
                eprintln!("gpu at frame {frames}: {report}");
            }
            eprintln!("frame at {ts:.2}: callbacks {:.2} ms, composite {:.2} ms, late {:.2} ms", (t1 - t0).as_secs_f64() * 1e3, t1.elapsed().as_secs_f64() * 1e3, timers::now_ms() - ts);
        }
    }
    false
}

/// Notices a resize or a DPI change: the surface, the scene and the document follow the client area.
fn watch() {
    let state = WIN.with(|w| w.borrow_mut().as_mut().filter(|w| w.resized).map(|w| {
        w.resized = false;
        w.hwnd
    }));
    let Some(hwnd) = state else { return };
    let mut client = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    // SAFETY: queries of this thread's own window.
    let dpi = unsafe {
        wm::GetClientRect(hwnd, &mut client);
        GetDpiForWindow(hwnd).max(96)
    };
    let (pw, ph) = ((client.right - client.left) as u32, (client.bottom - client.top) as u32);
    // Minimized: nothing to size to; the last size stands.
    if pw == 0 || ph == 0 {
        return;
    }
    let scale = dpi as f64 / 96.0;
    SCALE.with(|s| s.set(scale));
    let changed = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        if (w.config.width, w.config.height) == (pw, ph) && w.scale == scale {
            return None;
        }
        w.scale = scale;
        w.config.width = pw;
        w.config.height = ph;
        configure_surface(&w.config);
        w.configured = Instant::now();
        w.dirty = true;
        Some(())
    });
    if changed.is_some() {
        crate::layer::get().resize(pw, ph);
        dom::set_viewport(pw, ph, scale as f32);
        // The window's resize event (it does not bubble; listeners on the window hear it).
        dom::fire_window_event("resize");
    }
}

/// The page ends: the capture (for `window.close()`), `pagehide` and `unload` at the window (as a browser's closing
/// tab fires them), the window and the vsync thread gone, the timers dropped, and the process ended if the page
/// still holds it a little later (below).
fn close(capture: bool) {
    if capture {
        if let Ok(path) = std::env::var("SCRIPTC_HOST_CAPTURE") {
            render_into(true, Some(path));
        }
    }
    if !is_open() {
        return;
    }
    // A version on trial that ran a while is confirmed by its window's close (the layer's lifecycle).
    crate::layer::get().closed();
    dom::fire_window_event("pagehide");
    dom::fire_window_event("unload");
    // The pipelines made since the last save kept (the process may end below before the loop's next save).
    crate::layer::get().save_pipeline_cache(true);
    let Some(mut win) = WIN.with(|w| w.borrow_mut().take()) else { return };
    CLOSED.with(|c| c.set(true));
    if win.remember {
        remember_place(win.hwnd);
    }
    // The display's own power policy back.
    AWAKE.with(|a| a.set(false));
    apply_awake();
    HWND_POSTED.store(0, Ordering::Release);
    // No more presents (the GPU thread's included) to a window about to go.
    EXECUTOR_MODE.store(false, Ordering::Release);
    *PRESENTER.lock().unwrap_or_else(|e| e.into_inner()) = None;
    if let Some(t) = win.vsync_thread.take() {
        let _ = t.join();
    }
    // SAFETY: this thread's own window, and the timer period begun when it opened.
    unsafe {
        wm::DestroyWindow(win.hwnd);
        timeEndPeriod(1);
    }
    let n = win.paint_ms.len();
    if n > 0 {
        let mut p = win.paint_ms.clone();
        p.sort_by(|a, b| a.total_cmp(b));
        let mut v = VSYNC_INTERVALS.lock().unwrap_or_else(|e| e.into_inner()).1.clone();
        v.sort_by(|a, b| a.total_cmp(b));
        let q = |v: &[f64], f: f64| if v.is_empty() { 0.0 } else { v[((v.len() as f64 * f) as usize).min(v.len() - 1)] };
        eprintln!(
            "scriptc-host window: closed after {} frames; document paint p50 {:.2} ms p95 {:.2} ms ({} paints); vsync {} waits, interval p50 {:.2} p95 {:.2} ms (refresh {:.2} ms)",
            win.frames, p[n / 2], p[(n * 95 / 100).min(n - 1)], n, v.len() + 1, q(&v, 0.5), q(&v, 0.95), win.refresh_ms
        );
    }
    timers::clear_all();
    crate::profile::stop();
    // Web Audio closes with the page: the output device released now, not at the process's end (audio.rs).
    #[cfg(feature = "audio")]
    crate::audio::shutdown();
    // The page is gone with its window, as a browser tab is. The loop ends by itself once nothing holds it (a quiet page
    // does), but a busy one still holds sockets, workers and its render thread, and
    // kept a process with no window running. It ends a grace after the close, for what pagehide began (a save, a
    // last message), exiting as a normal end does (its atexit handlers run).
    // A run driven by SCRIPTC_HOST_INJECT ends as its program does (its exit code is the test's), unless it reloads.
    if INJECTING.load(Ordering::Relaxed) && !RELOAD.load(Ordering::Acquire) {
        return;
    }
    let _ = std::thread::Builder::new().name("scriptc-host exit".into()).spawn(|| {
        std::thread::sleep(Duration::from_secs(3));
        eprintln!("scriptc-host window: the page outlived its window by 3 s: exiting");
        start_again();
        std::process::exit(0);
    });
}

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

/// Composites and presents when anything may have changed: the document repainted, the scene under it. With the
/// render thread's GPU thread presenting ([`executor_mode`]), the document's paint is published for it instead.
fn render_into(callbacks_ran: bool, capture: Option<String>) {
    if executor_mode() {
        render_for_executor(callbacks_ran, capture);
        return;
    }
    // The attached canvas sizes the layer's scene (its drawing buffer) and places it (its box).
    let canvas = crate::layer::get().canvas_frame();
    let scene = crate::layer::get().scene();
    // The secondary views (a paperdoll, a showcase): each scene in its canvas's box, under the page's hole there.
    let views = crate::layer::get().view_frames();
    // A view repaints the window only when it presented since the last composite (or the views changed), as the
    // main scene does: compositing on every turn kept the loop busy and starved the program.
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
    let go = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else { return false };
        let scene_new = scene.as_ref().is_some_and(|s| s.presented != w.scene_presented);
        w.dirty || document_changed || scene_new || callbacks_ran || capture.is_some() || views_new
    });
    if !go {
        // A test that injects input counts refreshes: with nothing to present (a static page; the real cursor's moves,
        // which used to keep one presenting, are ignored meanwhile) the frames its steps name still come.
        if INJECTING.load(Ordering::Relaxed) && capture.is_none() {
            let inject = WIN.with(|w| {
                let mut w = w.borrow_mut();
                let w = w.as_mut()?;
                w.frames += 1;
                let frames = w.frames;
                let due: Vec<Injected> = w.inject.iter().filter(|(_, at)| frames == *at).map(|(i, _)| i.clone()).collect();
                Some((w.hwnd, w.scale, due))
            });
            if let Some((hwnd, scale, due)) = inject {
                run_injected(hwnd, scale, due);
            }
        }
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
    crate::profile::phase(Phase::Paint);
    let (rgba, gpu_painted) = match gpu_ui(pw, ph) {
        Some((mut painter, overlay, fresh)) => {
            // The frame's document clock (sampled once per frame: timers::begin_frame), as the frame's resolves read it.
            let now = crate::timers::frame_clock_ms() / 1000.0;
            let painted = crate::dom::with_document_quiet(|doc| {
                if fresh {
                    doc.track_paint_damage(true);
                }
                if !(changed || fresh || doc.is_animating()) {
                    return false;
                }
                let (damage, profile) = painter.paint_damage(doc, &overlay, scale as f32, now, fresh);
                // SCRIPTC_HOST_TRACE: the paint's stages (the document's resolve, Vello's scene, its raster: encoding
                // and submission on the shared device).
                if frame_trace() && !matches!(damage, blitz_ui::PaintDamage::None) {
                    eprintln!("  ui stages: resolve {:.2} ms, encode {:.2} ms, raster {:.2} ms", profile.resolve_ms, profile.scene_ms, profile.raster_ms);
                }
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
    // The executor on its own thread (the layer's scene): the scene the callbacks just drew, once it has run there (the document's
    // paint above ran meanwhile), so the composite shows this frame's scene, not the last one's.
    let t_wait = Instant::now();
    let scene = if gpu_wait().is_zero() || !crate::layer::get().await_streams(gpu_wait()) { scene } else { crate::layer::get().scene() };
    let wait_ms = t_wait.elapsed().as_secs_f64() * 1e3;
    // The cursor follows the style under a still mouse as well (an attribute the page set on a timer, say), as a
    // browser's does: once the document changed, after its styles were resolved for this paint.
    if document_changed && let Some(hwnd) = WIN.with(|w| w.borrow().as_ref().map(|w| w.hwnd)) {
        follow_cursor(hwnd);
    }
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
        crate::profile::phase(Phase::Acquire);
        // The surface's acquire to its present under the presenter's lock (the GPU thread may present too).
        let mut presenter = PRESENTER.lock().unwrap_or_else(|e| e.into_inner());
        let p = presenter.as_mut()?;
        let frame = match p.surface.get_current_texture() {
            // A configure that did not take left the swap chain at its old size: configured again, and this frame composed
            // offscreen ([`configured_size_holds`]).
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) if !configured_size_holds(&f, &w.config) => {
                drop(f);
                p.config = w.config.clone();
                p.surface.configure(&w.device, &w.config);
                w.configured = Instant::now();
                None
            }
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => Some(f),
            other => {
                if w.offscreen.is_none() {
                    eprintln!("scriptc-host window: no surface texture (minimized?): composing offscreen until there is");
                }
                // A stale surface is configured again at once; any other, once a second at most.
                let stale = matches!(other, wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost);
                if stale || w.configured.elapsed().as_secs_f64() >= 1.0 {
                    p.config = w.config.clone();
                    p.surface.configure(&w.device, &w.config);
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
        let acquire_ms = t_acquire.elapsed().as_secs_f64() * 1e3;
        crate::profile::phase(Phase::Composite);
        let t_composite = Instant::now();
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
        let view_groups: Vec<([f32; 4], wgpu::BindGroup)> = views
            .iter()
            .map(|(place, v)| (*place, bind(&v.texture.create_view(&wgpu::TextureViewDescriptor { format: Some(v.format.remove_srgb_suffix()), ..Default::default() }))))
            .collect();
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
                let mut drawn = (pw as f32, ph as f32);
                if let Some((x, y, vw, vh)) = placed.filter(|&(_, _, vw, vh)| vw > 0.0 && vh > 0.0) {
                    pass.set_viewport(x, y, vw, vh, 0.0, 1.0);
                    drawn = (vw, vh);
                }
                // Drawn a quarter larger or more than it was rendered (a render scale under 1, as Android's
                // performance mode), the scene is sharpened as it is upscaled (window.rs `fs_sharp`; <PREFIX>SHARPEN).
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
        let composite_ms = t_composite.elapsed().as_secs_f64() * 1e3;
        crate::profile::phase(Phase::Present);
        let t_present = Instant::now();
        let presented = frame.is_some();
        if let Some(frame) = frame {
            w.queue.present(frame);
            drop(presenter);
            if frame_trace() {
                let now = Instant::now();
                let late = FRAME_DUE_AT.with(|d| d.get()).map_or(0.0, |d| now.saturating_duration_since(d).as_secs_f64() * 1e3);
                eprintln!("present at {:.2}: by main, scene {}, late {late:.2} ms", pacing_ms(now), w.scene_presented);
            }
            // The first frame on screen: the window shows (it opened cloaked).
            if w.cloaked {
                w.cloaked = false;
                // SAFETY: this thread's own window (the attribute sends it no message).
                unsafe { cloak(w.hwnd, false) };
                // A layer's start-up window, up while the program started, goes now that this one shows.
                crate::layer::get().shown();
            }
        }
        if frame_trace() {
            let painted = if rgba.is_some() || gpu_painted == Some(true) { format!("paint {paint_ms:.2} ms") } else { "paint kept".to_string() };
            let to = if presented { "presented" } else { "offscreen" };
            // The render thread's scene count (a threaded program): how many frames it has presented, so a trace gives
            // the render thread's own rate beside the window's.
            eprintln!(
                "  {painted}, acquire {acquire_ms:.2} ms, composite {composite_ms:.2} ms, present {:.2} ms, {to}, scene {}, gpu wait {wait_ms:.2} ms",
                t_present.elapsed().as_secs_f64() * 1e3,
                w.scene_presented
            );
            // A key's way to the screen: its message to this present (the frame whose callbacks first saw it).
            if presented && let Some(at) = KEY_SEEN.with(|k| k.take()) {
                eprintln!("key presented {:.2} ms after its message", at.elapsed().as_secs_f64() * 1e3);
            }
        }
        w.frames += 1;
        let frames = w.frames;
        let due: Vec<Injected> = w.inject.iter().filter(|(_, at)| frames == *at).map(|(i, _)| i.clone()).collect();
        Some((w.hwnd, w.scale, due))
    });
    // Outside the window's borrow: posting and sizing send the window messages.
    if let Some((hwnd, scale, due)) = inject {
        run_injected(hwnd, scale, due);
    }
}

// ---- The window's present on the render thread's GPU thread (SCRIPTC_HOST_PRESENT_ON_EXECUTOR) ------------------------------
//
// A threaded program's scene is drawn by the render thread's stream on the render thread's GPU thread. That thread composites
// it with the document and presents as soon as the stream's PRESENT has run ([`executor_frame`]), as a browser's
// worker presents its OffscreenCanvas at the end of its own frame, instead of waiting for this thread's turn (its
// input, frame callbacks, style, layout and paint). This thread paints the document into a texture of its own and
// publishes it ([`render_for_executor`]); a change of the document alone asks the GPU thread for a composite
// (the layer's scene: request_composite), which the next scene brings when the render thread is drawing, at the latest a refresh later.
// The swap chain's waitable (frame latency 2) then holds back the GPU thread, and so the render thread's frames in flight,
// when the display falls behind, as a compositor's BeginFrame does.

/// The window's surface and what composites into it, shared by the thread that presents: the window's own, or the
/// render thread's GPU thread. Each acquire-to-present (and each configure) runs under this lock.
struct Presenter {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    configured: Instant,
    compositor: Arc<Compositor>,
}

static PRESENTER: Mutex<Option<Presenter>> = Mutex::new(None);

/// What the window last published for the GPU thread's composites.
struct UiFrame {
    /// The document's texture: Vello's straight alpha (`straight`), or the CPU paint's premultiplied.
    overlay: Option<wgpu::Texture>,
    straight: bool,
    /// The scene's box (physical px), when the page placed it in a canvas.
    canvas: Option<[f32; 4]>,
    /// The views' scenes and their boxes.
    views: Vec<([f32; 4], gpu_stream_wgpu::SceneFrame)>,
    /// SCRIPTC_HOST_TRACE: a key's message whose frame this is (the next present reports its latency).
    key_at: Option<Instant>,
}

static UI: Mutex<Option<UiFrame>> = Mutex::new(None);
/// A composite the window asked for that the GPU thread has not made yet: when it was first asked.
static UI_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);
/// The window has handed its presents to the render thread's GPU thread (until it closes).
static EXECUTOR_MODE: AtomicBool = AtomicBool::new(false);
/// Frames the GPU thread presented, and when its last new scene was.
static EXECUTOR_PRESENTS: AtomicU64 = AtomicU64::new(0);
static LAST_SCENE_AT: Mutex<Option<Instant>> = Mutex::new(None);

thread_local! {
    /// The refresh the window's current frame is for (its `late` in SCRIPTC_HOST_TRACE's present line).
    static FRAME_DUE_AT: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// SCRIPTC_HOST_TRACE's clock for refreshes and presents, the same on every thread: ms since the window opened.
fn pacing_ms(at: Instant) -> f64 {
    static EPOCH: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    at.saturating_duration_since(*EPOCH.get_or_init(Instant::now)).as_secs_f64() * 1e3
}

/// The surface configured for `config` (a resize), under the presenter's lock.
/// Whether the swap chain hands out textures of the size it was last asked for. wgpu-core refuses a configure when
/// another thread submits while it waits for the GPU to go idle (`GpuWaitTimeout`, "Failed to wait for GPU to come idle
/// before reconfiguring the Surface"): with the render thread's GPU thread submitting, a resize's configure often did not take,
/// and the window went on presenting at its old size (a band of nothing along the edge, 2026-11-20). The acquire
/// succeeds at the old size all the same, so it is the texture's size that tells.
fn configured_size_holds(frame: &wgpu::SurfaceTexture, config: &wgpu::SurfaceConfiguration) -> bool {
    (frame.texture.width(), frame.texture.height()) == (config.width, config.height)
}

fn configure_surface(config: &wgpu::SurfaceConfiguration) {
    if let Some(p) = PRESENTER.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        p.config = config.clone();
        p.surface.configure(&p.device, config);
        p.configured = Instant::now();
    }
}

/// SCRIPTC_HOST_PRESENT_ON_EXECUTOR: the render thread's GPU thread composites and presents (on by default where a render
/// thread draws on the window's device); `0` keeps every composite and present on the window's thread. Read once.
fn present_on_executor() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("SCRIPTC_HOST_PRESENT_ON_EXECUTOR").as_deref() != Ok("0"))
}

/// Whether the render thread's GPU thread presents for the window: switched on (for good) the first time a render thread's GPU
/// thread runs on the window's device. One-thread pages, and the window before the render thread opens its device, present
/// here.
fn executor_mode() -> bool {
    if EXECUTOR_MODE.load(Ordering::Acquire) {
        return true;
    }
    if !present_on_executor() || !crate::layer::get().render_executor_ready() {
        return false;
    }
    EXECUTOR_MODE.store(true, Ordering::Release);
    if frame_trace() {
        eprintln!("scriptc-host window: the render thread's GPU thread presents from now on");
    }
    true
}

/// When the GPU thread's composite of the document's change is due: at once by default. SCRIPTC_HOST_UI_COALESCE=1
/// instead waits, while the render thread draws scenes, up to a refresh for its next scene to bring the change (fewer presents;
/// measured on G5: input to present p50 33 ms against 17 ms on the window's own present, so off).
fn ui_due_at(asked: Instant) -> Instant {
    static COALESCE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if !*COALESCE.get_or_init(|| std::env::var("SCRIPTC_HOST_UI_COALESCE").as_deref() == Ok("1")) {
        return asked;
    }
    let refresh = Duration::from_micros(timers::REFRESH_US.load(Ordering::Relaxed).max(1000));
    let drawing = LAST_SCENE_AT.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| t.elapsed() < refresh * 3 / 2);
    if drawing { asked + refresh } else { asked }
}

/// The GPU thread's wait: until the document's change is due to be composited (None: nothing asked).
pub fn executor_deadline() -> Option<Instant> {
    if !EXECUTOR_MODE.load(Ordering::Acquire) {
        return None;
    }
    // A frame held for the next refresh ([`present_throttle`]) is due right after it.
    let held = HELD.lock().unwrap_or_else(|e| e.into_inner()).is_some().then(next_refresh).flatten();
    let asked = (*UI_REQUEST.lock().unwrap_or_else(|e| e.into_inner())).map(ui_due_at);
    match (held, asked) {
        (Some(h), Some(a)) => Some(h.min(a)),
        (h, a) => h.or(a),
    }
}

/// SCRIPTC_HOST_PRESENT_THROTTLE: at most one present per display refresh from the GPU thread (on by default; `0`
/// presents every frame at once). A second frame in the same refresh would only queue behind the first in the swap
/// chain (FIFO shows it a refresh later anyway) and, two queued, block the next acquire up to a refresh, the GPU thread
/// and the render thread's frames with it (measured: acquire p50 9.5 ms with UI composites on top of scenes). Held instead, it
/// is composited right after the next vblank, with the newest scene and document then.
fn present_throttle() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("SCRIPTC_HOST_PRESENT_THROTTLE").as_deref() != Ok("0"))
}

/// A frame held for the next refresh: whether it has a new scene, and when that scene's frame began.
static HELD: Mutex<Option<(bool, Option<Instant>)>> = Mutex::new(None);
/// When the GPU thread last presented.
static LAST_PRESENT: Mutex<Option<Instant>> = Mutex::new(None);

/// The vsync thread's last vblank while it is fresh (at most two refreshes old: not minimized, the compositor live).
fn last_vblank() -> Option<Instant> {
    let at = (*VSYNC.lock().unwrap_or_else(|e| e.into_inner()))?;
    let refresh = Duration::from_micros(timers::REFRESH_US.load(Ordering::Relaxed).max(1000));
    (at.elapsed() < refresh * 2).then_some(at)
}

/// Just after the next vblank (the last one plus a refresh, and half a millisecond).
fn next_refresh() -> Option<Instant> {
    let refresh = Duration::from_micros(timers::REFRESH_US.load(Ordering::Relaxed).max(1000));
    Some(last_vblank()? + refresh + Duration::from_micros(500))
}

/// The render thread's GPU thread after each job (the layer's scene: gpu_thread): with the window's presents handed to it, a new
/// `scene` (its PRESENT just ran; `began`: when its frame began) or a due change of the document composited and
/// presented here, at most once a refresh ([`present_throttle`]).
pub fn executor_frame(scene: Option<gpu_stream_wgpu::SceneFrame>, new_scene: bool, began: Option<Instant>) {
    if !EXECUTOR_MODE.load(Ordering::Acquire) {
        return;
    }
    let now = Instant::now();
    let ui_due = UI_REQUEST.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|a| now >= ui_due_at(a));
    let held = *HELD.lock().unwrap_or_else(|e| e.into_inner());
    if !new_scene && !ui_due && held.is_none() {
        return;
    }
    if new_scene {
        *LAST_SCENE_AT.lock().unwrap_or_else(|e| e.into_inner()) = Some(now);
    }
    // On the present thread (the default): handed over, the newest frame winning, and nothing here waits on the swap
    // chain.
    if present_thread_on() {
        let asked = UI_REQUEST.lock().unwrap_or_else(|e| e.into_inner()).take();
        if MINIMIZED.load(Ordering::Acquire) {
            return;
        }
        hand_to_present_thread(scene, new_scene, began, asked);
        return;
    }
    // A scene held earlier and not shown is still news to the present that shows the newest one.
    let (new_scene, began) = match held {
        Some((h, b)) if !new_scene => (h, b),
        _ => (new_scene, began),
    };
    // Presented since the last vblank already: held for just after the next one.
    if present_throttle()
        && let Some(vblank) = last_vblank()
        && LAST_PRESENT.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|p| p > vblank)
    {
        *HELD.lock().unwrap_or_else(|e| e.into_inner()) = Some((new_scene, began));
        return;
    }
    *HELD.lock().unwrap_or_else(|e| e.into_inner()) = None;
    // This composite takes the document as last published, so whatever was asked is in it.
    let asked = UI_REQUEST.lock().unwrap_or_else(|e| e.into_inner()).take();
    // Minimized, nothing is seen (the window's restore brings a new frame).
    if MINIMIZED.load(Ordering::Acquire) {
        return;
    }
    *LAST_PRESENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    executor_present(|| Some((scene, new_scene, began, asked)));
}

/// SCRIPTC_HOST_PRESENT_THREAD: the GPU thread hands its frames to a thread of their own, which acquires the swap
/// chain's texture (waiting there when the display is behind: a FIFO swap chain fed every refresh waits up to a refresh
/// in each acquire, measured p50 9.5-14 ms), composites the newest scene and document it has then, and presents. The GPU
/// thread then never waits on the display, only the presents do (frames that came meanwhile are folded into the newest).
/// On by default; `0` presents on the GPU thread itself (at most once a refresh with SCRIPTC_HOST_PRESENT_THROTTLE).
fn present_thread_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("SCRIPTC_HOST_PRESENT_THREAD").as_deref() != Ok("0"))
}

/// The frame waiting for the present thread: the newest scene, whether any scene since the last present was new (and
/// when the newest new one's frame began), and the earliest composite the window asked for.
type Pending = (Option<gpu_stream_wgpu::SceneFrame>, bool, Option<Instant>, Option<Instant>);
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static PENDING_READY: std::sync::Condvar = std::sync::Condvar::new();

fn hand_to_present_thread(scene: Option<gpu_stream_wgpu::SceneFrame>, new_scene: bool, began: Option<Instant>, asked: Option<Instant>) {
    static THREAD: std::sync::Once = std::sync::Once::new();
    THREAD.call_once(|| {
        let _ = std::thread::Builder::new().name("scriptc-host present".into()).spawn(|| loop {
            {
                let mut p = PENDING.lock().unwrap_or_else(|e| e.into_inner());
                while p.is_none() {
                    p = PENDING_READY.wait(p).unwrap_or_else(|e| e.into_inner());
                }
            }
            // The frame is taken once the swap chain has a texture for it: the newest by then.
            executor_present(|| PENDING.lock().unwrap_or_else(|e| e.into_inner()).take());
        });
    });
    let mut p = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    let merged = match p.take() {
        Some((_, was_new, was_began, was_asked)) => (scene, new_scene || was_new, if new_scene { began } else { was_began }, was_asked.or(asked)),
        None => (scene, new_scene, began, asked),
    };
    *p = Some(merged);
    PENDING_READY.notify_one();
}

/// Acquires the window's texture, then composites the frame `take` gives (None: nothing to present, the texture
/// dropped) and presents it.
fn executor_present(take: impl FnOnce() -> Option<Pending>) {
    let t0 = Instant::now();
    let mut guard = PRESENTER.lock().unwrap_or_else(|e| e.into_inner());
    let Some(p) = guard.as_mut() else { return };
    let frame = match p.surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
        other => {
            // A stale surface is configured again at once; any other, once a second at most (as the window's own).
            let stale = matches!(other, wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost);
            if stale || p.configured.elapsed().as_secs_f64() >= 1.0 {
                p.surface.configure(&p.device, &p.config);
                p.configured = Instant::now();
            }
            return;
        }
    };
    // A configure that did not take left the swap chain at its old size: configured again, this frame skipped
    // ([`configured_size_holds`]).
    if !configured_size_holds(&frame, &p.config) {
        drop(frame);
        p.surface.configure(&p.device, &p.config);
        p.configured = Instant::now();
        return;
    }
    let t_acquired = Instant::now();
    let Some((scene, new_scene, began, asked)) = take() else { return };
    let (pw, ph) = (frame.texture.width(), frame.texture.height());
    let key_at = {
        // The document held as published until the composite is submitted: the window paints its next one into its
        // other texture, and swaps only under this lock.
        let mut ui = UI.lock().unwrap_or_else(|e| e.into_inner());
        let mut encoder = p.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("scriptc-host composite (GPU thread)") });
        let target = frame.texture.create_view(&Default::default());
        let key_at = match ui.as_mut() {
            Some(u) => {
                compose_pass(&p.device, &p.compositor, &mut encoder, &target, (pw, ph), scene.as_ref(), u.canvas, &u.views, u.overlay.as_ref(), u.straight);
                u.key_at.take()
            }
            None => {
                compose_pass(&p.device, &p.compositor, &mut encoder, &target, (pw, ph), scene.as_ref(), None, &[], None, false);
                None
            }
        };
        p.queue.submit([encoder.finish()]);
        key_at
    };
    let t_composed = Instant::now();
    p.queue.present(frame);
    drop(guard);
    EXECUTOR_PRESENTS.fetch_add(1, Ordering::Relaxed);
    if frame_trace() {
        let now = Instant::now();
        let ms = |a: Instant, b: Instant| b.saturating_duration_since(a).as_secs_f64() * 1e3;
        let late = match (new_scene, began) {
            (true, Some(b)) => format!("{:.2} ms", ms(b, now)),
            _ => "-".to_string(),
        };
        let ui = asked.map_or(String::new(), |a| format!(", ui {:.2} ms after its ask", ms(a, now)));
        eprintln!(
            "present at {:.2}: by gpu, scene {}, late {late}, acquire {:.2} ms, composite {:.2} ms, present {:.2} ms{ui}",
            pacing_ms(now),
            scene.as_ref().map_or(0, |s| s.presented),
            ms(t0, t_acquired),
            ms(t_acquired, t_composed),
            ms(t_composed, now)
        );
        if let Some(at) = key_at {
            eprintln!("key presented {:.2} ms after its message", ms(at, now));
        }
    }
}

/// The window's composite into `target` (`size` px): white, the scene (in the canvas's box when the page gave one,
/// sharpened when drawn a quarter larger or more than it was rendered), each view in its box, the document over all.
#[allow(clippy::too_many_arguments)]
fn compose_pass(
    device: &wgpu::Device,
    compositor: &Compositor,
    encoder: &mut wgpu::CommandEncoder,
    target: &wgpu::TextureView,
    size: (u32, u32),
    scene: Option<&gpu_stream_wgpu::SceneFrame>,
    canvas: Option<[f32; 4]>,
    views: &[([f32; 4], gpu_stream_wgpu::SceneFrame)],
    overlay: Option<&wgpu::Texture>,
    straight: bool,
) {
    let (pw, ph) = (size.0 as f32, size.1 as f32);
    let bind = |view: &wgpu::TextureView| {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &compositor.layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&compositor.sampler) }],
        })
    };
    let srgb_free = |f: wgpu::TextureFormat| wgpu::TextureViewDescriptor { format: Some(f.remove_srgb_suffix()), ..Default::default() };
    let scene_group = scene.map(|s| bind(&s.texture.create_view(&srgb_free(s.format))));
    let view_groups: Vec<([f32; 4], wgpu::BindGroup)> = views.iter().map(|(place, v)| (*place, bind(&v.texture.create_view(&srgb_free(v.format))))).collect();
    let overlay_group = overlay.map(|o| bind(&o.create_view(&Default::default())));
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("scriptc-host composite"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: target,
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
        let placed = canvas.map(|[x, y, cw, ch]| {
            let (x0, y0) = (x.clamp(0.0, pw), y.clamp(0.0, ph));
            (x0, y0, (x + cw).min(pw) - x0, (y + ch).min(ph) - y0)
        });
        let mut drawn = (pw, ph);
        if let Some((x, y, vw, vh)) = placed.filter(|&(_, _, vw, vh)| vw > 0.0 && vh > 0.0) {
            pass.set_viewport(x, y, vw, vh, 0.0, 1.0);
            drawn = (vw, vh);
        }
        let upscaled = scene.is_some_and(|s| drawn.0 >= s.texture.width() as f32 * 1.25);
        match (&compositor.scene_sharp, upscaled) {
            (Some(sharp), true) => pass.set_pipeline(sharp),
            _ => pass.set_pipeline(&compositor.opaque),
        }
        pass.set_bind_group(0, g, &[]);
        pass.draw(0..3, 0..1);
        pass.set_viewport(0.0, 0.0, pw, ph, 0.0, 1.0);
    }
    for ([x, y, cw, ch], g) in &view_groups {
        let (x0, y0) = (x.clamp(0.0, pw), y.clamp(0.0, ph));
        let (vw, vh) = ((x + cw).min(pw) - x0, (y + ch).min(ph) - y0);
        if vw <= 0.0 || vh <= 0.0 {
            continue;
        }
        pass.set_viewport(x0, y0, vw, vh, 0.0, 1.0);
        pass.set_pipeline(&compositor.opaque);
        pass.set_bind_group(0, g, &[]);
        pass.draw(0..3, 0..1);
        pass.set_viewport(0.0, 0.0, pw, ph, 0.0, 1.0);
    }
    if let Some(g) = &overlay_group {
        pass.set_pipeline(if straight { &compositor.over_straight } else { &compositor.over });
        pass.set_bind_group(0, g, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// The document's two textures (published and painted), made for `pw` x `ph` when they do not fit: true when one was
/// made (the next paint is whole).
fn ensure_overlays(w: &mut Win, pw: u32, ph: u32) -> bool {
    let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC | blitz_ui::gpu_paint::TARGET_USAGE;
    let fits = |o: &Option<(wgpu::Texture, u32, u32)>| o.as_ref().is_some_and(|(t, ow, oh)| *ow == pw && *oh == ph && t.usage().contains(usage));
    let mut made = false;
    let device = w.device.clone();
    for slot in [&mut w.overlay, &mut w.overlay_back] {
        if !fits(slot) {
            let t = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("scriptc-host document"),
                size: wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: blitz_ui::gpu_paint::TARGET_FORMAT,
                usage,
                view_formats: &[],
            });
            *slot = Some((t, pw, ph));
            made = true;
        }
    }
    made
}

/// The window's frame with the render thread's GPU thread presenting: the document painted into the texture the GPU thread
/// is not compositing (its damage over a copy of the published one), then published with the scene's box and the
/// views, and a composite asked for when any of it changed. A capture composites here, offscreen.
fn render_for_executor(callbacks_ran: bool, capture: Option<String>) {
    let canvas = crate::layer::get().canvas_frame().map(|(_, place)| place);
    let views = crate::layer::get().view_frames();
    let place = (canvas, views.iter().map(|(_, v)| v.presented).collect::<Vec<u64>>());
    crate::modules::deliver_loads();
    let document_changed = dom::take_dirty();
    // The first frame on screen (the GPU thread presented it): the window shows (it opened cloaked).
    let shown = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        (w.cloaked && EXECUTOR_PRESENTS.load(Ordering::Relaxed) > 0).then(|| {
            w.cloaked = false;
            w.hwnd
        })
    });
    if let Some(hwnd) = shown {
        // SAFETY: this thread's own window.
        unsafe { cloak(hwnd, false) };
        crate::layer::get().shown();
    }
    let go = WIN.with(|w| w.borrow().as_ref().is_some_and(|w| w.dirty || document_changed || callbacks_ran || capture.is_some() || w.published_place != place));
    if !go {
        if INJECTING.load(Ordering::Relaxed) {
            let inject = WIN.with(|w| {
                let mut w = w.borrow_mut();
                let w = w.as_mut()?;
                w.frames += 1;
                let frames = w.frames;
                let due: Vec<Injected> = w.inject.iter().filter(|(_, at)| frames == *at).map(|(i, _)| i.clone()).collect();
                Some((w.hwnd, w.scale, due))
            });
            if let Some((hwnd, scale, due)) = inject {
                run_injected(hwnd, scale, due);
            }
        }
        return;
    }
    let Some((pw, ph, scale, dirty, fresh, back, front)) = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        let (pw, ph) = (w.config.width, w.config.height);
        let fresh = ensure_overlays(w, pw, ph);
        let back = w.overlay_back.as_ref()?.0.clone();
        let front = w.overlay.as_ref()?.0.clone();
        Some((pw, ph, w.scale, w.dirty, fresh, back, front))
    }) else {
        return;
    };
    let changed = dirty || document_changed || capture.is_some() || fresh;
    let t = Instant::now();
    crate::profile::phase(Phase::Paint);
    let (painted, straight) = match gpu_ui_painter() {
        Some(mut painter) => {
            let now = crate::timers::frame_clock_ms() / 1000.0;
            let painted = crate::dom::with_document_quiet(|doc| {
                if fresh {
                    doc.track_paint_damage(true);
                }
                if !(changed || doc.is_animating()) {
                    return false;
                }
                let (damage, profile) = painter.paint_damage_over(doc, &back, (!fresh).then_some(&front), scale as f32, now, fresh);
                if frame_trace() && !matches!(damage, blitz_ui::PaintDamage::None) {
                    eprintln!("  ui stages: resolve {:.2} ms, encode {:.2} ms, raster {:.2} ms", profile.resolve_ms, profile.scene_ms, profile.raster_ms);
                }
                !matches!(damage, blitz_ui::PaintDamage::None)
            });
            dom::take_dirty();
            WIN.with(|w| {
                if let Some(w) = w.borrow_mut().as_mut() {
                    w.ui_gpu = Some(painter);
                }
            });
            (painted, true)
        }
        None => match super::compose::document_pixels(changed, scale, pw, ph) {
            Some(rgba) => {
                WIN.with(|w| {
                    if let Some(w) = w.borrow().as_ref() {
                        w.queue.write_texture(
                            wgpu::TexelCopyTextureInfo { texture: &back, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                            &rgba,
                            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(pw * 4), rows_per_image: Some(ph) },
                            wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
                        );
                    }
                });
                (true, false)
            }
            None => (false, false),
        },
    };
    let paint_ms = t.elapsed().as_secs_f64() * 1000.0;
    crate::profile::phase(Phase::Loop);
    if document_changed && let Some(hwnd) = WIN.with(|w| w.borrow().as_ref().map(|w| w.hwnd)) {
        follow_cursor(hwnd);
    }
    let key_at = KEY_SEEN.with(|k| k.take());
    let publish = painted || fresh || WIN.with(|w| w.borrow().as_ref().is_some_and(|w| w.published_place != place));
    // The painted texture becomes the published one, the published one the next to paint (swapped under the UI lock
    // below: the GPU thread composites only what is published).
    let front = if painted {
        WIN.with(|w| {
            let mut w = w.borrow_mut();
            let w = w.as_mut()?;
            std::mem::swap(&mut w.overlay, &mut w.overlay_back);
            w.paint_ms.push(paint_ms);
            w.overlay.as_ref().map(|(t, _, _)| t.clone())
        })
    } else {
        Some(front)
    };
    if publish {
        {
            let mut ui = UI.lock().unwrap_or_else(|e| e.into_inner());
            let key_at = key_at.or_else(|| ui.as_mut().and_then(|u| u.key_at.take()));
            *ui = Some(UiFrame { overlay: front.clone(), straight, canvas, views: views.clone(), key_at });
        }
        UI_REQUEST.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Instant::now);
        crate::layer::get().request_composite();
    } else if let Some(at) = key_at {
        // The key's frame changed nothing here: the next present (the render thread's scene) is the one that shows it.
        if let Some(u) = UI.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            u.key_at.get_or_insert(at);
        }
    }
    if let Some(path) = &capture {
        capture_offscreen(path, (pw, ph), canvas, &views, front.as_ref(), straight);
    }
    let inject = WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        w.dirty = false;
        w.published_place = place;
        if frame_trace() {
            eprintln!("  {}, {}", if painted { format!("paint {paint_ms:.2} ms") } else { "paint kept".to_string() }, if publish { "published" } else { "unchanged" });
        }
        w.frames += 1;
        let frames = w.frames;
        let due: Vec<Injected> = w.inject.iter().filter(|(_, at)| frames == *at).map(|(i, _)| i.clone()).collect();
        Some((w.hwnd, w.scale, due))
    });
    if let Some((hwnd, scale, due)) = inject {
        run_injected(hwnd, scale, due);
    }
}

/// The document's GPU painter (taken out of the window for the paint), None on the CPU (as [`gpu_ui`]).
fn gpu_ui_painter() -> Option<blitz_ui::gpu_paint::GpuUiPainter> {
    WIN.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut()?;
        if w.ui_cpu {
            return None;
        }
        match w.ui_gpu.take() {
            Some(p) => Some(p),
            None => match blitz_ui::gpu_paint::GpuUiPainter::new(&w.device, &w.queue) {
                Ok(p) => Some(p),
                Err(e) => {
                    eprintln!("scriptc-host window: the document paints on the CPU ({e})");
                    w.ui_cpu = true;
                    None
                }
            },
        }
    })
}

/// A capture with the GPU thread presenting: the frame composited here into a texture of its own and written as PNG.
fn capture_offscreen(path: &str, size: (u32, u32), canvas: Option<[f32; 4]>, views: &[([f32; 4], gpu_stream_wgpu::SceneFrame)], overlay: Option<&wgpu::Texture>, straight: bool) {
    let Some((device, queue, compositor, format)) = WIN.with(|w| w.borrow().as_ref().map(|w| (w.device.clone(), w.queue.clone(), w.compositor.clone(), w.config.format))) else { return };
    let (pw, ph) = size;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("scriptc-host capture"),
        size: wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let scene = crate::layer::get().scene();
    let mut encoder = device.create_command_encoder(&Default::default());
    compose_pass(&device, &compositor, &mut encoder, &texture.create_view(&Default::default()), size, scene.as_ref(), canvas, views, overlay, straight);
    let row = (pw * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (row * ph) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(ph) } },
        wgpu::Extent3d { width: pw, height: ph, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let bgra = format == wgpu::TextureFormat::Bgra8Unorm;
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

/// The test injector's steps due this frame, posted to the window (the real input path).
fn run_injected(hwnd: HWND, scale: f64, due: Vec<Injected>) {
        for i in due {
            match i {
                Injected::Click(x, y) => unsafe { post_click(hwnd, scale, x, y) },
                Injected::ClickText(text) => match dom::text_center(&text) {
                    Some((x, y)) => unsafe { post_click(hwnd, scale, x, y) },
                    None => eprintln!("scriptc-host window: no element with the text {text:?} to click"),
                },
                Injected::Key(c) if c.is_ascii_uppercase() => unsafe { send_shifted_key(hwnd, c) },
                Injected::Key(c) => unsafe {
                    post_key_edge(hwnd, c, true);
                    post_key_edge(hwnd, c, false);
                    eprintln!("scriptc-host window: posted key {c:?}");
                },
                Injected::KeyHeld(c, down) => unsafe {
                    post_key_edge(hwnd, c, down);
                    eprintln!("scriptc-host window: posted key {c:?} {}", if down { "down" } else { "up" });
                },
                Injected::NamedKey(vk, name) => unsafe {
                    post_vk_edge(hwnd, vk, true);
                    post_vk_edge(hwnd, vk, false);
                    eprintln!("scriptc-host window: posted key {name}");
                },
                Injected::NamedKeyHeld(vk, name, down) => unsafe {
                    post_vk_edge(hwnd, vk, down);
                    eprintln!("scriptc-host window: posted key {name} {}", if down { "down" } else { "up" });
                },
                Injected::Chord(mods, vk, name) => unsafe { send_chord(hwnd, &mods, vk, &name) },
                Injected::Clip(text) => {
                    let ok = set_clipboard_text(&text);
                    eprintln!("scriptc-host window: set the clipboard to {text:?} ({})", if ok { "done" } else { "failed" });
                }
                Injected::Button(button, down, x, y) => unsafe { post_button(hwnd, scale, button, down, x, y) },
                Injected::Move(x, y) => unsafe {
                    wm::PostMessageW(hwnd, wm::WM_MOUSEMOVE, mk_held() | INJECTED_MOVE, lparam_at(scale, x, y));
                    eprintln!("scriptc-host window: posted a move to ({x}, {y})");
                },
                Injected::Wheel(x, y, notches) => unsafe {
                    // The wheel's messages carry screen coordinates; a notch toward the user is a negative delta.
                    let mut p = POINT { x: (x * scale).round() as i32, y: (y * scale).round() as i32 };
                    ClientToScreen(hwnd, &mut p);
                    let delta = (-notches * wm::WHEEL_DELTA as f64).round() as i16 as u16 as usize;
                    let at = ((p.y as u32 & 0xffff) << 16 | (p.x as u32 & 0xffff)) as LPARAM;
                    wm::PostMessageW(hwnd, wm::WM_MOUSEWHEEL, (delta << 16) | mk_held(), at);
                    eprintln!("scriptc-host window: posted a wheel of {notches} notches at ({x}, {y})");
                },
                Injected::Resize(w, h) => unsafe {
                    let dpi = GetDpiForWindow(hwnd).max(96);
                    let (ow, oh) = outer_size((w * scale).round() as i32, (h * scale).round() as i32, dpi);
                    wm::SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, ow, oh, wm::SWP_NOMOVE | wm::SWP_NOZORDER | wm::SWP_NOACTIVATE);
                    eprintln!("scriptc-host window: resized the client area to {w}x{h}");
                },
                Injected::Capture(name) => {
                    if let Some(path) = name.or_else(|| std::env::var("SCRIPTC_HOST_CAPTURE").ok()) {
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

/// A letter or digit going down or up, posted to the window's queue (the real input path).
unsafe fn post_key_edge(hwnd: HWND, c: char, down: bool) {
    unsafe {
        let vk = (VkKeyScanW(c as u16) & 0xff) as u32;
        let scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
        if down {
            wm::PostMessageW(hwnd, wm::WM_KEYDOWN, vk as WPARAM, (1 | (scan << 16)) as LPARAM);
        } else {
            wm::PostMessageW(hwnd, wm::WM_KEYUP, vk as WPARAM, (1 | (scan << 16) | (1 << 30) | (1 << 31)) as LPARAM);
        }
    }
}

/// An upper-case letter's press with Shift held (the injector's `key:<A-Z>`): a posted message cannot carry the
/// keyboard's state, so the thread's state holds Shift while the press is sent straight to the window, then is put back.
unsafe fn send_shifted_key(hwnd: HWND, c: char) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyboardState, SetKeyboardState, VK_LSHIFT, VK_SHIFT};
    unsafe {
        let mut saved = [0u8; 256];
        GetKeyboardState(saved.as_mut_ptr());
        let mut shifted = saved;
        shifted[VK_SHIFT as usize] = 0x80;
        shifted[VK_LSHIFT as usize] = 0x80;
        SetKeyboardState(shifted.as_ptr());
        let vk = (VkKeyScanW(c as u16) & 0xff) as u32;
        let scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
        wm::SendMessageW(hwnd, wm::WM_KEYDOWN, vk as WPARAM, (1 | (scan << 16)) as LPARAM);
        wm::SendMessageW(hwnd, wm::WM_KEYUP, vk as WPARAM, (1 | (scan << 16) | (1 << 30) | (1 << 31)) as LPARAM);
        SetKeyboardState(saved.as_ptr());
        eprintln!("scriptc-host window: sent key {c:?} with Shift");
    }
}

/// A key pressed with modifiers held (the injector's `chord:`): as `send_shifted_key`, the thread's keyboard state
/// holds the modifiers while the press is sent straight to the window, then is put back.
unsafe fn send_chord(hwnd: HWND, mods: &[u16], vk: u16, name: &str) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let extended = matches!(vk, VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_INSERT | VK_DELETE);
    unsafe {
        let mut saved = [0u8; 256];
        GetKeyboardState(saved.as_mut_ptr());
        let mut held = saved;
        for m in mods {
            held[*m as usize] = 0x80;
            let side = match *m {
                VK_CONTROL => VK_LCONTROL,
                VK_SHIFT => VK_LSHIFT,
                _ => VK_LMENU,
            };
            held[side as usize] = 0x80;
        }
        SetKeyboardState(held.as_ptr());
        let scan = MapVirtualKeyW(u32::from(vk), MAPVK_VK_TO_VSC);
        let lparam = 1 | (scan << 16) | (u32::from(extended) << 24);
        wm::SendMessageW(hwnd, wm::WM_KEYDOWN, vk as WPARAM, lparam as LPARAM);
        wm::SendMessageW(hwnd, wm::WM_KEYUP, vk as WPARAM, (lparam | (1 << 30) | (1 << 31)) as LPARAM);
        SetKeyboardState(saved.as_ptr());
    }
    eprintln!("scriptc-host window: sent the chord {name}");
}

/// The caret's blink time (Windows' GetCaretBlinkTime: each phase, on and off, in ms; 530 by default), None when the
/// user turned blinking off (the caret stays solid).
pub fn caret_blink_ms() -> Option<u32> {
    // SAFETY: a plain query of the user's setting.
    let ms = unsafe { wm::GetCaretBlinkTime() };
    (ms != 0 && ms != u32::MAX).then_some(ms)
}

/// CF_UNICODETEXT (WinUser.h).
const CF_UNICODETEXT: u32 = 13;

/// Opens the clipboard for the window (another application may hold it a moment: a few tries, as browsers make).
unsafe fn open_clipboard() -> bool {
    use windows_sys::Win32::System::DataExchange::OpenClipboard;
    let owner = HWND_POSTED.load(Ordering::Acquire) as HWND;
    for _ in 0..5 {
        // SAFETY: the window (or no window) as the clipboard's owner while it is open.
        if unsafe { OpenClipboard(owner) } != 0 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    false
}

/// The system clipboard's text (CF_UNICODETEXT, "\r\n" as it is there): Some(None) when it holds no text, None when
/// there is no window to read it for or it could not be opened.
pub fn clipboard_text() -> Option<Option<String>> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable};
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    if HWND_POSTED.load(Ordering::Acquire) == 0 {
        return None;
    }
    // SAFETY: the clipboard opened, its text locked while it is read (bounded by its block's size), and closed.
    unsafe {
        if !open_clipboard() {
            return None;
        }
        let mut text = None;
        if IsClipboardFormatAvailable(CF_UNICODETEXT) != 0 {
            let h = GetClipboardData(CF_UNICODETEXT);
            if !h.is_null() {
                let p = GlobalLock(h) as *const u16;
                if !p.is_null() {
                    let units = GlobalSize(h) / 2;
                    let slice = std::slice::from_raw_parts(p, units);
                    let len = slice.iter().position(|u| *u == 0).unwrap_or(units);
                    text = Some(String::from_utf16_lossy(&slice[..len]));
                    GlobalUnlock(h);
                }
            }
        }
        CloseClipboard();
        Some(text)
    }
}

/// Puts `text` on the system clipboard as CF_UNICODETEXT ("\n" written "\r\n", as Windows' text has it). False when
/// there is no window or the clipboard could not be opened.
pub fn set_clipboard_text(text: &str) -> bool {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};
    use windows_sys::Win32::Foundation::GlobalFree;
    if HWND_POSTED.load(Ordering::Acquire) == 0 {
        return false;
    }
    let wide: Vec<u16> = text.replace("\r\n", "\n").replace('\n', "\r\n").encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: a movable block the size of the text, filled while locked, handed to the clipboard (which owns it once
    // SetClipboardData succeeds; freed here otherwise), the clipboard closed.
    unsafe {
        if !open_clipboard() {
            return false;
        }
        EmptyClipboard();
        let h = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        let mut ok = false;
        if !h.is_null() {
            let p = GlobalLock(h) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
                GlobalUnlock(h);
                ok = !SetClipboardData(CF_UNICODETEXT, h).is_null();
            }
            if !ok {
                GlobalFree(h);
            }
        }
        CloseClipboard();
        ok
    }
}

/// A named key's virtual key (the injector's `key:<Name>`).
fn named_vk(name: &str) -> Option<u16> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    Some(match name {
        "Escape" => VK_ESCAPE,
        "Enter" => VK_RETURN,
        "Tab" => VK_TAB,
        "Space" => VK_SPACE,
        "Backspace" => VK_BACK,
        "Delete" => VK_DELETE,
        "Insert" => VK_INSERT,
        "Home" => VK_HOME,
        "End" => VK_END,
        "PageUp" => VK_PRIOR,
        "PageDown" => VK_NEXT,
        "ArrowLeft" => VK_LEFT,
        "ArrowRight" => VK_RIGHT,
        "ArrowUp" => VK_UP,
        "ArrowDown" => VK_DOWN,
        // The step separator `;` cannot be a step's key: `chord:Ctrl+Shift+Alt+Semicolon` (the dev unlock) names it.
        "Semicolon" => VK_OEM_1,
        _ => {
            let n: u16 = name.strip_prefix('F')?.parse().ok().filter(|n| (1..=24).contains(n))?;
            VK_F1 + n - 1
        }
    })
}

/// A virtual key going down or up, posted to the window's queue (the extended keys flagged as a keyboard sends them).
unsafe fn post_vk_edge(hwnd: HWND, vk: u16, down: bool) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let extended = matches!(vk, VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_INSERT | VK_DELETE);
    unsafe {
        let scan = MapVirtualKeyW(u32::from(vk), MAPVK_VK_TO_VSC);
        let lparam = 1 | (scan << 16) | (u32::from(extended) << 24);
        if down {
            wm::PostMessageW(hwnd, wm::WM_KEYDOWN, vk as WPARAM, lparam as LPARAM);
        } else {
            wm::PostMessageW(hwnd, wm::WM_KEYUP, vk as WPARAM, (lparam | (1 << 30) | (1 << 31)) as LPARAM);
        }
    }
}

/// A mouse message's coordinates for CSS px (x, y).
fn lparam_at(scale: f64, x: f64, y: f64) -> LPARAM {
    let (px, py) = ((x * scale).round() as i32, (y * scale).round() as i32);
    ((py as u32 & 0xffff) << 16 | (px as u32 & 0xffff)) as LPARAM
}

/// The buttons held now, as a mouse message's key state.
/// Marks a mouse move the test injector posted (a wparam bit no MK_ flag uses).
const INJECTED_MOVE: WPARAM = 0x4000_0000;

fn mk_held() -> WPARAM {
    let b = BUTTONS.with(|b| b.get());
    let mut mk = 0;
    for (bit, flag) in [(1, MK_LBUTTON), (2, MK_RBUTTON), (4, MK_MBUTTON)] {
        if b & bit != 0 {
            mk |= flag;
        }
    }
    mk as WPARAM
}

/// A button (the DOM's 0 left, 1 middle, 2 right) going down or up at CSS px (x, y), posted to the window's queue;
/// the mouse moves there first, unless the pointer is locked (a locked mouse's moves are motion).
unsafe fn post_button(hwnd: HWND, scale: f64, button: i16, down: bool, x: f64, y: f64) {
    let at = lparam_at(scale, x, y);
    let (msg, flag) = match (button, down) {
        (0, true) => (wm::WM_LBUTTONDOWN, MK_LBUTTON),
        (0, false) => (wm::WM_LBUTTONUP, MK_LBUTTON),
        (1, true) => (wm::WM_MBUTTONDOWN, MK_MBUTTON),
        (1, false) => (wm::WM_MBUTTONUP, MK_MBUTTON),
        (_, true) => (wm::WM_RBUTTONDOWN, MK_RBUTTON),
        (_, false) => (wm::WM_RBUTTONUP, MK_RBUTTON),
    };
    let held = mk_held() as u32;
    let state = if down { held | flag } else { held & !flag };
    unsafe {
        if LOCKED.with(|l| l.get()).is_none() {
            wm::PostMessageW(hwnd, wm::WM_MOUSEMOVE, held as WPARAM | INJECTED_MOVE, at);
        }
        wm::PostMessageW(hwnd, msg, state as WPARAM, at);
    }
    eprintln!("scriptc-host window: posted button {button} {} at ({x}, {y})", if down { "down" } else { "up" });
}

/// A left click at CSS px (x, y): a button down and up posted to the window's queue (the real input path).
unsafe fn post_click(hwnd: HWND, scale: f64, x: f64, y: f64) {
    let (px, py) = ((x * scale).round() as i32, (y * scale).round() as i32);
    let at = ((py as u32 & 0xffff) << 16 | (px as u32 & 0xffff)) as LPARAM;
    unsafe {
        wm::PostMessageW(hwnd, wm::WM_MOUSEMOVE, INJECTED_MOVE, at);
        wm::PostMessageW(hwnd, wm::WM_LBUTTONDOWN, MK_LBUTTON as WPARAM, at);
        wm::PostMessageW(hwnd, wm::WM_LBUTTONUP, 0, at);
    }
    eprintln!("scriptc-host window: posted a click at ({x}, {y})");
}

#[allow(dead_code)]
pub fn closed() -> bool {
    CLOSED.with(|c| c.get())
}

