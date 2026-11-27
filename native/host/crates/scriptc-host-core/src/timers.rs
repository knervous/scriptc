//! setTimeout / setInterval / requestAnimationFrame on the program's event loop: the runtime asks `pending` whether
//! the host has work (armed timers keep the program alive, as in a page); abi.rs's `io_poll` sleeps at most until the
//! earliest one (`until_next_ms`) and runs what is due (`run_due`).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::Instant;

use crate::abi;
use crate::objects::{self, Value};

/// Animation frames at a fixed 60 Hz without a window; with one (window.rs) they run at the display's refresh.
const FRAME_MS: f64 = 1000.0 / 60.0;

struct Timer {
    closure: u64,
    interval: Option<f64>,
    args: Vec<Value>,
    /// requestAnimationFrame: the callback receives the frame time.
    frame: bool,
}

#[derive(Default)]
struct Timers {
    /// (deadline ms, id) -> timer: ordered by deadline, then by arming order (ids increase).
    queue: BTreeMap<(u64, u64), Timer>,
    deadline_of: BTreeMap<u64, u64>,
    next_id: u64,
    /// The timer whose callback is running (off the queue), and whether that callback cleared it.
    running: Option<u64>,
    running_cancelled: bool,
    /// Frame callbacks waiting for the window's next display refresh (in request order).
    frames: Vec<(u64, Timer)>,
}

thread_local! {
    static TIMERS: RefCell<Timers> = RefCell::new(Timers::default());
    static START: Instant = Instant::now();
    /// The long timers SCRIPTC_HOST_TRACE_TIMERS follows.
    static LONG: RefCell<std::collections::HashSet<u64>> = RefCell::new(std::collections::HashSet::new());
}

/// SCRIPTC_HOST_TRACE_TIMERS=1: each timer of at least LONG_MS, armed and fired, on stderr (a watchdog's or a cap's:
/// whether it runs on time).
const LONG_MS: f64 = 5000.0;

fn trace() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE_TIMERS").is_some())
}

pub fn now_ms() -> f64 {
    START.with(|s| s.elapsed().as_secs_f64() * 1000.0)
}

thread_local! {
    /// The document clock ([`frame_clock_ms`]): the current frame's timestamp and how many frames have moved it.
    static FRAME_CLOCK: std::cell::Cell<Option<(f64, u64)>> = const { std::cell::Cell::new(None) };
}

/// The window's frame begins at `ts` (performance.now() ms: its refresh's, the frame callbacks' argument): the document
/// clock moves there, once per frame, and stays until the next frame begins. Never backwards.
pub fn begin_frame(ts: f64) {
    FRAME_CLOCK.with(|c| {
        let (at, generation) = c.get().unwrap_or((f64::NEG_INFINITY, 0));
        c.set(Some((ts.max(at), generation + 1)));
    });
}

/// The document's clock (performance.now() ms), as a browser's document timeline has it: the timestamp of the frame
/// being rendered, sampled once per frame by the window ([`begin_frame`]), the same for every read until the next
/// frame begins (its callbacks, the style resolves they force, observers, the paint, and the tasks between frames).
/// The program's clock now ([`now_ms`]) on a thread whose window has not begun a frame (none open, or not yet).
pub fn frame_clock_ms() -> f64 {
    FRAME_CLOCK.with(|c| c.get()).map_or_else(now_ms, |(at, _)| at)
}

/// How many times the document clock has moved ([`begin_frame`]; 0 before the first frame): what changed since a
/// reading of [`frame_clock_ms`] is told by comparing this (animations need ticking only when it moved).
#[allow(dead_code)] // dom.rs's animation ticking reads it.
pub fn frame_clock_generation() -> u64 {
    FRAME_CLOCK.with(|c| c.get()).map_or(0, |(_, generation)| generation)
}

/// Deadlines are kept in microseconds so the map key is an integer.
fn key_us(ms: f64) -> u64 {
    (ms * 1000.0) as u64
}

fn arm(closure: u64, after_ms: f64, interval: Option<f64>, args: Vec<Value>, frame: bool) -> u64 {
    abi::closure_retain(closure);
    for a in &args {
        if let Value::Object(r) = a { objects::retain(*r) }
        if let Value::Closure(c) | Value::Program(c) = a { abi::closure_retain(*c) }
    }
    TIMERS.with(|t| {
        let mut t = t.borrow_mut();
        t.next_id += 1;
        let id = t.next_id;
        let at = key_us(now_ms() + after_ms);
        if after_ms >= LONG_MS && trace() {
            eprintln!("scriptc-host timers: #{id} armed for {after_ms} ms at {:.0} ms", now_ms());
            LONG.with(|l| l.borrow_mut().insert(id));
        }
        t.queue.insert((at, id), Timer { closure, interval, args, frame });
        t.deadline_of.insert(id, at);
        id
    })
}

pub fn add(closure: u64, delay_ms: f64, repeat: bool, args: Vec<Value>) -> u64 {
    // Browsers clamp a repeating timer's period to at least 1 ms.
    arm(closure, delay_ms, repeat.then_some(delay_ms.max(1.0)), args, false)
}

pub fn add_frame(closure: u64) -> u64 {
    // A render thread paced by the display (render_vsync_on) waits for its next refresh as a window's frames do.
    if crate::window::is_open() || (render_vsync_on() && !crate::render_thread::is_main_thread()) {
        abi::closure_retain(closure);
        return TIMERS.with(|t| {
            let mut t = t.borrow_mut();
            t.next_id += 1;
            let id = t.next_id;
            t.frames.push((id, Timer { closure, interval: None, args: Vec::new(), frame: true }));
            id
        });
    }
    let now = now_ms();
    let next_frame = (now / FRAME_MS).floor() * FRAME_MS + FRAME_MS;
    arm(closure, next_frame - now, None, Vec::new(), true)
}

fn drop_timer(timer: Timer) {
    abi::closure_release(timer.closure);
    for a in timer.args {
        if let Value::Object(r) = a { objects::release(r) }
        if let Value::Closure(c) | Value::Program(c) = a { abi::closure_release(c) }
    }
}

pub fn cancel(id: u64) {
    let removed = TIMERS.with(|t| {
        let mut t = t.borrow_mut();
        if t.running == Some(id) {
            t.running_cancelled = true;
            return None;
        }
        if let Some(i) = t.frames.iter().position(|(f, _)| *f == id) {
            return Some(t.frames.remove(i).1);
        }
        let at = t.deadline_of.remove(&id)?;
        t.queue.remove(&(at, id))
    });
    if let Some(timer) = removed {
        drop_timer(timer);
    }
}

/// Armed timers, waiting frames, or an open window keep the program alive.
pub fn pending() -> bool {
    TIMERS.with(|t| {
        let t = t.borrow();
        !t.queue.is_empty() || !t.frames.is_empty()
    }) || crate::window::is_open()
}

/// The loop's sleep (abi.rs io_poll): with a window open, its events are drained meanwhile and the sleep ends at
/// input or a display refresh (window.rs `sleep`).
pub fn sleep(ms: f64) {
    if crate::window::is_open() {
        crate::window::sleep(ms);
    } else if ms.is_finite() && ms > 0.0 {
        // On the instance's pool, not the thread: a wake (the runtime's remote inbox, another thread's seam call) or
        // a completion ends it early, as a window's sleep ends on its events.
        crate::modules::sleep(ms);
    }
}

/// Whether frame callbacks wait for the next refresh.
pub fn frames_waiting() -> bool {
    TIMERS.with(|t| !t.borrow().frames.is_empty())
}

/// The window's refresh at `ts` (performance.now() ms): every frame callback requested before it, in order (one
/// requested from inside them waits for the next). One that throws is reported and the rest run, as a browser runs
/// its animation frame callbacks (dom.rs `report_exception`).
pub fn run_frames(ts: f64) {
    let frames = TIMERS.with(|t| std::mem::take(&mut t.borrow_mut().frames));
    // The frame block's clocks before the frame's callbacks read them (the layer's frame hook).
    crate::layer::get().before_frame();
    for (id, timer) in frames {
        TIMERS.with(|t| {
            let mut t = t.borrow_mut();
            t.running = Some(id);
            t.running_cancelled = false;
        });
        let threw = abi::call_closure(timer.closure, &[Value::Number(ts)]).is_err();
        TIMERS.with(|t| t.borrow_mut().running = None);
        drop_timer(timer);
        if threw {
            crate::dom::report_exception("a requestAnimationFrame callback");
        }
    }
}

/// The page ended (its window closed): every timer and frame callback is dropped, so the program's loop ends.
pub fn clear_all() {
    // No window frames from now on: the document clock is the program's again.
    FRAME_CLOCK.with(|c| c.set(None));
    let (queue, frames) = TIMERS.with(|t| {
        let mut t = t.borrow_mut();
        t.deadline_of.clear();
        (std::mem::take(&mut t.queue), std::mem::take(&mut t.frames))
    });
    for (_, timer) in queue {
        drop_timer(timer);
    }
    for (_, timer) in frames {
        drop_timer(timer);
    }
}

/// The refresh period a render thread paces its frames at: the window's (its display), 60 Hz until it opens.
pub static REFRESH_US: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(16_667);

thread_local! {
    /// A render thread's next frame (performance.now() ms): it has no window to drive its frame callbacks.
    static RENDER_NEXT_FRAME: std::cell::Cell<f64> = const { std::cell::Cell::new(0.0) };
    /// SCRIPTC_HOST_TRACE: when the render thread's previous frame began (performance.now() ms; 0 before its first).
    static RENDER_LAST_FRAME: std::cell::Cell<f64> = const { std::cell::Cell::new(0.0) };
    /// SCRIPTC_HOST_TRACE: the due time (timer key) of the render-thread frame whose callbacks are running, and when it began.
    static RENDER_FRAME_AT: std::cell::Cell<(u64, f64)> = const { std::cell::Cell::new((0, 0.0)) };
    /// SCRIPTC_HOST_TRACE: how many render-thread frames have begun.
    static RENDER_FRAMES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    /// SCRIPTC_HOST_TRACE_CALLS: the due time (timer key) of the render-thread frame the calls trace last began.
    static RENDER_CALLS_FRAME: std::cell::Cell<u64> = const { std::cell::Cell::new(u64::MAX) };
}

/// SCRIPTC_HOST_TRACE on a render thread whose requestAnimationFrame callbacks are frame timers (no window on the
/// thread: `add_frame`): one line per callback, `render-thread frame at <ts>` the frame's start (the same for every callback
/// due at that refresh), its interval from the previous frame's start (0 on the frame's later callbacks), the
/// callback's ms, and the scenes the GPU executor has presented for the render thread so far (relay.rs).
fn render_frame_trace(due: u64, began: Instant) {
    let callback_ms = began.elapsed().as_secs_f64() * 1e3;
    let start = now_ms() - callback_ms;
    let (key, at) = RENDER_FRAME_AT.with(|f| f.get());
    let (at, interval) = if key == due {
        (at, 0.0)
    } else {
        let last = RENDER_LAST_FRAME.with(|l| l.replace(start));
        RENDER_FRAME_AT.with(|f| f.set((due, start)));
        // The render thread's device's live handles every 300 frames (the window's trace prints them for a device on its own
        // thread: window_windows.rs `gpu at frame`).
        let frames = RENDER_FRAMES.with(|n| {
            n.set(n.get() + 1);
            n.get()
        });
        if frames % 300 == 0 && let Some(report) = crate::layer::get().trace_report() {
            eprintln!("gpu at render-thread frame {frames}: {report}");
        }
        (start, if last > 0.0 { start - last } else { 0.0 })
    };
    eprintln!("render-thread frame at {at:.2}: interval {interval:.2} ms, callbacks {callback_ms:.2} ms, scenes {}", crate::relay::scenes());
}

/// SCRIPTC_HOST_TRACE=1 (or SCRIPTC_HOST_TRACE_RENDER=1), read once: a render thread prints each frame it runs.
fn render_trace() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE").is_some() || std::env::var_os("SCRIPTC_HOST_TRACE_RENDER").is_some())
}

/// SCRIPTC_HOST_RENDER_VSYNC: a render thread's frame callbacks run at the display's refreshes (the window's vsync
/// thread stamps each one: [`vblank`]) with the refresh's vblank as their timestamp, as a worker's
/// requestAnimationFrame runs on the compositor's BeginFrame. On by default; `0` keeps the render thread on its own 60 Hz
/// timer grid (frame callbacks armed as timers). With no refresh stamped lately (no window, the compositor silent, the
/// window minimized: its vsync thread ticks every 100 ms) the render thread keeps its own clock at the display's period.
pub fn render_vsync_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("SCRIPTC_HOST_RENDER_VSYNC").as_deref() != Ok("0"))
}

/// The display's last refresh (how many so far, and its vblank), and the render threads woken at each.
static VBLANK: std::sync::Mutex<(u64, Option<Instant>)> = std::sync::Mutex::new((0, None));
static VBLANK_WAKERS: std::sync::Mutex<Vec<crate::modules::Waker>> = std::sync::Mutex::new(Vec::new());

/// The window's vsync thread saw a refresh whose vblank was `at`: the render threads that pace on it wake.
pub fn vblank(at: Instant) {
    {
        let mut v = VBLANK.lock().unwrap_or_else(|e| e.into_inner());
        v.0 += 1;
        v.1 = Some(at);
    }
    for waker in VBLANK_WAKERS.lock().unwrap_or_else(|e| e.into_inner()).iter() {
        waker.wake();
    }
}

thread_local! {
    /// The refresh (by count) a render thread last ran its frame for, and whether its waker is with the vsync thread.
    static RENDER_VBLANK_SEEN: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static RENDER_VBLANK_WAKES: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// When the frame being run on this thread began: its refresh's vblank, or its start on the render thread's own clock (a
    /// layer's GPU thread times a stream's present from it).
    static FRAME_BEGAN: std::cell::Cell<Option<Instant>> = const { std::cell::Cell::new(None) };
}

/// When the frame this thread is running began (its refresh's vblank when the display paces it), if it runs one.
pub fn frame_began() -> Option<Instant> {
    FRAME_BEGAN.with(|f| f.get())
}

/// The display's refresh a render thread paces on, while the vsync thread stamps them (at most two and a half refreshes
/// old): how many there have been, and the last one's vblank.
fn render_vblank() -> Option<(u64, Instant)> {
    if !render_vsync_on() {
        return None;
    }
    if !RENDER_VBLANK_WAKES.with(|w| w.replace(true)) {
        VBLANK_WAKERS.lock().unwrap_or_else(|e| e.into_inner()).push(crate::modules::waker());
    }
    let (seq, at) = *VBLANK.lock().unwrap_or_else(|e| e.into_inner());
    let at = at?;
    let period = REFRESH_US.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1000.0;
    (at.elapsed().as_secs_f64() * 1e3 <= 2.5 * period).then_some((seq, at))
}

/// On a render thread with frame callbacks waiting: how long until its next frame (0 when due). Paced by the display, a
/// frame is due once a refresh came since the last (the vsync thread's wake ends the wait; the answer is only its
/// bound); else by the render thread's own clock.
fn render_frame_in_ms() -> Option<f64> {
    if crate::render_thread::is_main_thread() || !frames_waiting() {
        return None;
    }
    let period = REFRESH_US.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1000.0;
    if let Some((seq, at)) = render_vblank() {
        if seq != RENDER_VBLANK_SEEN.with(|s| s.get()) {
            return Some(0.0);
        }
        return Some((1.5 * period - at.elapsed().as_secs_f64() * 1e3).max(0.0));
    }
    Some((RENDER_NEXT_FRAME.with(|n| n.get()) - now_ms()).max(0.0))
}

/// A render thread's frame when it is due: its frame callbacks run at the display's rate, as a worker's
/// requestAnimationFrame does, with the refresh's vblank as their timestamp when the display paces them. True when one
/// ran.
fn render_frame() -> bool {
    if render_frame_in_ms().is_none_or(|ms| ms > 0.0) {
        return false;
    }
    let now = now_ms();
    let period = REFRESH_US.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1000.0;
    RENDER_NEXT_FRAME.with(|n| n.set((n.get() + period).max(now)));
    let (ts, began) = match render_vblank() {
        Some((seq, at)) => {
            RENDER_VBLANK_SEEN.with(|s| s.set(seq));
            ((now - at.elapsed().as_secs_f64() * 1e3).min(now), at)
        }
        None => (now, Instant::now()),
    };
    FRAME_BEGAN.with(|f| f.set(Some(began)));
    // SCRIPTC_HOST_TRACE_CALLS: a render-thread frame begins, and its callbacks are timed (abi.rs calls).
    abi::calls::render_frame();
    let _callbacks = abi::calls::callback();
    if !render_trace() {
        run_frames(ts);
        return true;
    }
    // The render thread's own frame (a threaded program): its interval, its callbacks' time, and the scenes the GPU executor
    // has presented for it so far (the window's trace prints the same count as `scene N` beside its own frames).
    let t = Instant::now();
    run_frames(ts);
    let callbacks_ms = t.elapsed().as_secs_f64() * 1e3;
    let last = RENDER_LAST_FRAME.with(|l| l.replace(now));
    let interval = if last > 0.0 { now - last } else { 0.0 };
    eprintln!("render-thread frame at {now:.2}: interval {interval:.2} ms, callbacks {callbacks_ms:.2} ms, scenes {}", crate::relay::scenes());
    true
}

/// How long until the earliest armed timer is due (0 when one is due now); None with none armed.
pub fn until_next_ms() -> Option<f64> {
    if crate::window::work_ready() {
        return Some(0.0);
    }
    let frame = render_frame_in_ms();
    let earliest = TIMERS.with(|t| t.borrow().queue.keys().next().map(|(at, _)| *at as f64 / 1000.0));
    match (earliest.map(|e| (e - now_ms()).max(0.0)), frame) {
        (Some(t), Some(f)) => Some(t.min(f)),
        (t, f) => t.or(f),
    }
}

/// Runs every timer due now, in order. True when a callback threw: its exception is pending in the program, and the
/// loop reports it before anything else runs.
pub fn run_due() -> bool {
    // A window's turn first: its input, then the refresh's frame callbacks and the frame.
    if crate::window::turn() {
        return true;
    }
    // The driver's pipeline cache, when pipelines were made since it was kept (any window's device that has one).
    crate::layer::get().save_pipeline_cache(false);
    // A render thread's frame (no window drives it).
    render_frame();
    let now = key_us(now_ms());
    loop {
        let due = TIMERS.with(|t| {
            let mut t = t.borrow_mut();
            let (&(at, id), _) = t.queue.iter().next()?;
            if at > now {
                return None;
            }
            let timer = t.queue.remove(&(at, id))?;
            t.deadline_of.remove(&id);
            t.running = Some(id);
            t.running_cancelled = false;
            Some((at, id, timer))
        });
        let Some((at, id, timer)) = due else { return false };
        if trace() && LONG.with(|l| if timer.interval.is_some() { l.borrow().contains(&id) } else { l.borrow_mut().remove(&id) }) {
            eprintln!("scriptc-host timers: #{id} fires at {:.0} ms", now_ms());
        }
        // A frame callback armed as a timer (a thread with no window: a render thread's requestAnimationFrame) reads
        // the frame block's clocks too, so they are this frame's (the layer's frame hook), as run_frames fills them for the
        // window's.
        let args = if timer.frame {
            FRAME_BEGAN.with(|f| f.set(Some(Instant::now())));
            crate::layer::get().before_frame();
            vec![Value::Number(now_ms())]
        } else {
            timer.args.clone()
        };
        #[cfg(windows)]
        crate::profile::phase(crate::profile::Phase::Timers);
        let traced = (timer.frame && render_trace() && !crate::render_thread::is_main_thread()).then(Instant::now);
        // SCRIPTC_HOST_TRACE_CALLS: a render-thread frame (its first callback due at this refresh) begins, and each of its
        // callbacks is timed (abi.rs calls).
        let callback = timer.frame.then(|| {
            if RENDER_CALLS_FRAME.with(|f| f.replace(at)) != at {
                abi::calls::render_frame();
            }
            abi::calls::callback()
        });
        let threw = abi::call_closure(timer.closure, &args).is_err();
        drop(callback);
        if let Some(t) = traced {
            render_frame_trace(at, t);
        }
        #[cfg(windows)]
        crate::profile::phase(crate::profile::Phase::Loop);
        let cleared = TIMERS.with(|t| {
            let mut t = t.borrow_mut();
            t.running = None;
            t.running_cancelled
        });
        match timer.interval.filter(|_| !cleared) {
            // A repeating timer re-arms under the same id unless its callback cleared it or threw.
            Some(period) if !threw => TIMERS.with(|t| {
                let mut t = t.borrow_mut();
                let at = key_us(now_ms() + period);
                t.queue.insert((at, id), timer);
                t.deadline_of.insert(id, at);
            }),
            _ => drop_timer(timer),
        }
        if threw {
            return true;
        }
    }
}
