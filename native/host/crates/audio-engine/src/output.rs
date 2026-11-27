//! The render thread: renders quanta for the device as it asks (wasapi.rs on Windows), or, with no device, on a silent
//! clock that keeps the context's time advancing in real time and its sources ending when they should.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::graph::{Renderer, STATE_CLOSED, STATE_RUNNING, Shared};
use crate::param::QUANTUM;

/// Marks the render thread gone when it ends, however it ends.
struct Gone(Arc<Shared>);

impl Drop for Gone {
    fn drop(&mut self) {
        self.0.render_gone.store(true, Ordering::Release);
    }
}

/// Starts the render thread on the default output (or the silent clock); returns once the context's rate is known.
pub fn start(shared: Arc<Shared>) -> (JoinHandle<()>, f32) {
    let (ready, rate) = std::sync::mpsc::channel::<f32>();
    let thread = std::thread::Builder::new()
        .name("audio-render".into())
        .spawn(move || {
            let _gone = Gone(shared.clone());
            #[cfg(windows)]
            let ended = catch_unwind(AssertUnwindSafe(|| crate::wasapi::run(shared.clone(), ready)));
            #[cfg(not(windows))]
            let ended = catch_unwind(AssertUnwindSafe(|| {
                let sample_rate = 48000.0;
                shared.sample_rate.store(f32::to_bits(sample_rate), Ordering::Release);
                let _ = ready.send(sample_rate);
                let mut pump = Pump::new(sample_rate);
                silent_clock(&shared, &mut pump, || false);
            }));
            if ended.is_err() {
                // The output itself failed (the graph's own panics are caught a quantum at a time, in `Pump`): keep
                // time on the silent clock on a fresh graph, so commands are still taken and sources still end.
                let rate = f32::from_bits(shared.sample_rate.load(Ordering::Acquire));
                let mut pump = Pump::new(if rate > 0.0 { rate } else { 48000.0 });
                pump.renderer.frame = shared.frames.load(Ordering::Acquire);
                let _ = catch_unwind(AssertUnwindSafe(|| silent_clock(&shared, &mut pump, || false)));
            }
        })
        .expect("spawning the audio render thread");
    let sample_rate = rate.recv().unwrap_or(48000.0);
    (thread, sample_rate)
}

/// The renderer and the quantum being played out, for an output that asks for any number of frames.
pub struct Pump {
    pub renderer: Renderer,
    /// Frames of `renderer.out` already handed out (QUANTUM when a new quantum is needed).
    used: usize,
}

impl Pump {
    pub fn new(sample_rate: f32) -> Pump {
        Pump { renderer: Renderer::new(sample_rate), used: QUANTUM }
    }

    /// Renders one quantum: commands in, the graph, events and garbage out, the clock published. A panic in the graph
    /// costs the graph, not the thread: rendering goes on from a fresh one (`Renderer::salvage`).
    pub fn quantum(&mut self, shared: &Shared) {
        self.renderer.exchange(shared);
        let frame = self.renderer.frame;
        if catch_unwind(AssertUnwindSafe(|| self.renderer.render_quantum())).is_err() {
            self.salvage(frame);
        }
        shared.frames.store(self.renderer.frame, Ordering::Release);
        self.used = 0;
    }

    /// While suspended: commands still apply (and garbage goes back), but nothing renders and time stands still.
    pub fn idle(&mut self, shared: &Shared) {
        self.renderer.exchange(shared);
        let frame = self.renderer.frame;
        if catch_unwind(AssertUnwindSafe(|| self.renderer.apply_commands())).is_err() {
            self.salvage(frame);
            self.renderer.frame = frame;
        }
    }

    fn salvage(&mut self, frame: u64) {
        let fresh = Renderer::new(self.renderer.sample_rate);
        let old = std::mem::replace(&mut self.renderer, fresh);
        self.renderer.salvage(old, frame);
        self.renderer.out.set_silent();
    }

    /// The next stereo frame, rendering a quantum when the last one is used up (the device path).
    #[cfg_attr(not(windows), allow(dead_code))]
    #[inline]
    pub fn next(&mut self, shared: &Shared) -> (f32, f32) {
        if self.used == QUANTUM {
            self.quantum(shared);
        }
        let i = self.used;
        self.used += 1;
        let out = &self.renderer.out;
        if out.silent() { (0.0, 0.0) } else { (out.ch[0][i], out.ch[1][i]) }
    }
}

/// Renders in real time without a device until the context closes or `device_back` (asked about once a second) says
/// a device is there to open. True when the context closed.
pub fn silent_clock(shared: &Shared, pump: &mut Pump, mut device_back: impl FnMut() -> bool) -> bool {
    let sample_rate = pump.renderer.sample_rate as f64;
    let mut base = Instant::now();
    let mut base_frame = pump.renderer.frame;
    let mut last_check = Instant::now();
    loop {
        let state = shared.state.load(Ordering::Acquire);
        if state == STATE_CLOSED {
            return true;
        }
        if state == STATE_RUNNING {
            let target = base_frame + (base.elapsed().as_secs_f64() * sample_rate) as u64;
            if target > pump.renderer.frame + sample_rate as u64 / 2 {
                // Far behind (the machine slept, or the thread was starved): carry on from now rather than race.
                base = Instant::now();
                base_frame = pump.renderer.frame;
            }
            while pump.renderer.frame + QUANTUM as u64 <= target {
                pump.quantum(shared);
            }
        } else {
            pump.idle(shared);
            base = Instant::now();
            base_frame = pump.renderer.frame;
        }
        if last_check.elapsed() >= Duration::from_secs(1) {
            last_check = Instant::now();
            if device_back() {
                return false;
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
