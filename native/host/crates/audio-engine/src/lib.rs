//! A native Web Audio graph (the contract; the host's audio.rs binds `AudioContext` and its nodes to it).
//!
//! Only what a page's sound typically uses: gain, buffer sources, oscillators, biquad filters,
//! stereo panners, panners (equal-power, distance models, cones), a convolver, a dynamics compressor, AudioParam
//! automation, the listener. Semantics follow the Web Audio spec (and Chrome where the spec leaves room): 128-frame
//! render quanta, params a-rate or k-rate as the spec says, node inputs summed with the spec's up/down-mixing for
//! mono and stereo (channelCountMode "max"/"clamped-max"/"explicit" as each node's default), a panner's output stereo.
//!
//! Threads: an `Engine` is driven from one thread (the page's). Every call is a command queued to the render thread
//! (no lock held while rendering); the render thread applies the queued commands at the start of each quantum, so a
//! batch of calls made in one turn lands together. Times are the context's clock: seconds of audio rendered.
//!
//! Output: Windows renders through WASAPI shared mode on the default render endpoint (event-driven, at the mix
//! format's rate, f32 stereo, the graph's stereo up-mixed as the endpoint needs), following the default device when it
//! changes. Without a device (none, or it failed) the clock still advances in real time and nothing is heard, as
//! Chrome's context does with no output.

mod biquad;
mod bus;
mod compressor;
mod convolver;
mod graph;
mod nodes;
mod oscillator;
mod output;
mod param;
mod source;
#[cfg(windows)]
mod wasapi;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use crate::convolver::ConvolverState;
use crate::graph::{Cmd, GENERATION_MASK, Garbage, Mailbox, Renderer, SLOT_BITS, STATE_CLOSED, STATE_RUNNING, STATE_SUSPENDED, Shared, slot};
use crate::nodes::{NodeState, Target};
use crate::oscillator::WaveTables;
use crate::param::QUANTUM;

/// A node in the graph. `DESTINATION` is the context's destination (one input, stereo).
pub type NodeId = u32;
pub const DESTINATION: NodeId = 0;

/// Decoded or script-written sample data, immutable once handed over (a JS AudioBuffer's contents as acquired when
/// it is assigned to a source or a convolver). Planar f32, every channel `frames` long.
#[derive(Debug)]
pub struct BufferData {
    pub sample_rate: f32,
    pub channels: Vec<Vec<f32>>,
}

impl BufferData {
    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BiquadType {
    Lowpass,
    Highpass,
    Bandpass,
    Lowshelf,
    Highshelf,
    Peaking,
    Notch,
    Allpass,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OscillatorType {
    Sine,
    Square,
    Sawtooth,
    Triangle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DistanceModel {
    Linear,
    Inverse,
    Exponential,
}

/// What to create. Every node starts with the spec's defaults (gain 1, a lowpass at 350 Hz Q 1, an oscillator's sine at
/// 440 Hz, a compressor's -24 dB / 30 dB / 12:1 / 3 ms / 250 ms, a panner's inverse model, ref 1, max 10000, rolloff
/// 1, cones 360/360/0, a convolver normalizing, ...).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeKind {
    Gain,
    BufferSource,
    Oscillator,
    BiquadFilter,
    StereoPanner,
    /// PannerNode. Only "equalpower" panning: an "HRTF" request is rendered equal-power (equal-power is what the pages it was built for ask for).
    Panner,
    Convolver,
    DynamicsCompressor,
}

/// An AudioParam of a node (or of the listener, `NodeId` ignored).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Param {
    /// A GainNode's gain, or a BiquadFilter's gain (dB).
    Gain,
    Frequency,
    Detune,
    Q,
    PlaybackRate,
    Pan,
    PositionX,
    PositionY,
    PositionZ,
    OrientationX,
    OrientationY,
    OrientationZ,
    Threshold,
    Knee,
    Ratio,
    Attack,
    Release,
    // The listener's (NodeId ignored).
    ListenerPositionX,
    ListenerPositionY,
    ListenerPositionZ,
    ListenerForwardX,
    ListenerForwardY,
    ListenerForwardZ,
    ListenerUpX,
    ListenerUpY,
    ListenerUpZ,
}

/// One AudioParam call, with the spec's semantics (times in context seconds; an event in the past takes effect at
/// once; `Value` is the `.value` setter, which Chrome applies as setValueAtTime(v, currentTime)).
#[derive(Clone, Debug, PartialEq)]
pub enum ParamEvent {
    Value(f32),
    SetValueAtTime { value: f32, time: f64 },
    LinearRampToValueAtTime { value: f32, time: f64 },
    ExponentialRampToValueAtTime { value: f32, time: f64 },
    SetTargetAtTime { target: f32, time: f64, time_constant: f64 },
    SetValueCurveAtTime { values: Vec<f32>, time: f64, duration: f64 },
    CancelScheduledValues { time: f64 },
    CancelAndHoldAtTime { time: f64 },
}

/// A node's non-param attribute.
#[derive(Clone, Debug)]
pub enum Attr {
    BiquadType(BiquadType),
    OscillatorType(OscillatorType),
    /// A buffer source's or a convolver's buffer (None clears a convolver's).
    Buffer(Option<Arc<BufferData>>),
    Loop(bool),
    LoopStart(f64),
    LoopEnd(f64),
    Normalize(bool),
    DistanceModel(DistanceModel),
    RefDistance(f64),
    MaxDistance(f64),
    RolloffFactor(f64),
    ConeInnerAngle(f64),
    ConeOuterAngle(f64),
    ConeOuterGain(f64),
}

/// What the render thread reports back, drained by `Engine::take_events` on the page thread.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A buffer source or oscillator finished (stopped, or a non-looping buffer played out): its `ended` event.
    Ended(NodeId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Suspended,
    Running,
    Closed,
}


/// The context's engine: a handle on the render thread's graph.
pub struct Engine {
    shared: Arc<Shared>,
    page: Mutex<Page>,
    sample_rate: f32,
    /// An offline engine's renderer (driven by `render` on the caller's thread).
    offline: Option<Mutex<Renderer>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

/// The page thread's side: node ids handed out, what kind each is (for the calls that need work done before they reach
/// the render thread), and slots freed to reuse.
struct Page {
    next_slot: u32,
    free: Vec<u32>,
    /// Per slot: the id living there now (or next, once freed), its kind, and (a convolver) `normalize`.
    ids: Vec<NodeId>,
    kinds: Vec<Option<NodeKind>>,
    normalize: Vec<bool>,
}

impl Page {
    fn new() -> Page {
        Page { next_slot: 1, free: Vec::new(), ids: vec![DESTINATION], kinds: vec![None], normalize: vec![true] }
    }

    fn kind(&self, id: NodeId) -> Option<NodeKind> {
        let s = slot(id);
        if self.ids.get(s) == Some(&id) { self.kinds[s] } else { None }
    }

    /// Slots the render thread freed: their next id is a generation on, so the old id names nothing.
    fn reclaim(&mut self, freed: &mut Vec<u32>) {
        for s in freed.drain(..) {
            let s = s as usize;
            if s == 0 || s >= self.ids.len() {
                continue;
            }
            let generation = ((self.ids[s] >> SLOT_BITS) + 1) & GENERATION_MASK;
            self.ids[s] = (generation << SLOT_BITS) | s as u32;
            self.kinds[s] = None;
            self.free.push(s as u32);
        }
    }
}

impl Default for Engine {
    fn default() -> Engine {
        Engine::new()
    }
}

impl Engine {
    /// Opens the default output and starts rendering, Running (the host has no autoplay policy to honour). Never
    /// fails: no device means the silent clock.
    pub fn new() -> Engine {
        let shared = Shared::new(0.0);
        let (thread, sample_rate) = output::start(shared.clone());
        Engine { shared, page: Mutex::new(Page::new()), sample_rate, offline: None, thread: Mutex::new(Some(thread)) }
    }

    /// A clock with no device at all (the examples and offline checks): `render` drives it.
    pub fn offline(sample_rate: f32) -> Engine {
        let shared = Shared::new(sample_rate);
        Engine {
            shared,
            page: Mutex::new(Page::new()),
            sample_rate,
            offline: Some(Mutex::new(Renderer::new(sample_rate))),
            thread: Mutex::new(None),
        }
    }

    /// For an offline engine: render `frames` (a multiple of 128) and return them interleaved stereo.
    pub fn render(&self, frames: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; frames * 2];
        let Some(renderer) = &self.offline else { return out };
        {
            let mut r = renderer.lock().unwrap_or_else(|e| e.into_inner());
            for chunk in out.chunks_mut(QUANTUM * 2) {
                r.exchange(&self.shared);
                if self.shared.state.load(Ordering::Acquire) != STATE_RUNNING {
                    // Suspended (or closed): calls still apply, time stands still, the output is silent.
                    r.apply_commands();
                    continue;
                }
                r.render_quantum();
                self.shared.frames.store(r.frame, Ordering::Release);
                if !r.out.silent() {
                    for (i, frame) in chunk.as_chunks_mut::<2>().0.iter_mut().enumerate() {
                        frame[0] = r.out.ch[0][i];
                        frame[1] = r.out.ch[1][i];
                    }
                }
            }
            // Events, garbage and freed slots out to the mailbox (the render thread's own exchange does this at the
            // start of its next quantum); commands queued meanwhile stay there for the next render, in order.
            let mut m = self.shared.mailbox.lock().unwrap_or_else(|e| e.into_inner());
            r.hand_back(&mut m);
        }
        // What the renderer gave up is freed here, on the caller's thread.
        self.with_mailbox(|_| ());
        out
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }
    /// Seconds rendered so far (advances a quantum at a time while Running).
    pub fn current_time(&self) -> f64 {
        self.shared.frames.load(Ordering::Acquire) as f64 / self.sample_rate as f64
    }
    /// The output's latency in seconds (the endpoint's period plus its stream latency), for `baseLatency`/`outputLatency`.
    pub fn output_latency(&self) -> f64 {
        f64::from_bits(self.shared.latency.load(Ordering::Acquire))
    }
    pub fn state(&self) -> State {
        self.shared.state()
    }
    pub fn suspend(&self) {
        let _ = self.shared.state.compare_exchange(STATE_RUNNING, STATE_SUSPENDED, Ordering::AcqRel, Ordering::Acquire);
    }
    pub fn resume(&self) {
        let _ = self.shared.state.compare_exchange(STATE_SUSPENDED, STATE_RUNNING, Ordering::AcqRel, Ordering::Acquire);
    }
    /// Stops rendering and releases the device; every later call is ignored.
    pub fn close(&self) {
        self.shared.state.store(STATE_CLOSED, Ordering::Release);
        // Wake the render thread from its wait on the device so it sees the close now, and wait for it a little: one
        // stuck in the driver is left to end on its own (it holds only what `Shared` keeps alive).
        self.shared.wake();
        let thread = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(thread) = thread {
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
            while !thread.is_finished() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
        // Whatever was still queued is freed now, and an offline graph with it.
        let leftover = {
            let mut m = self.shared.mailbox.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut *m)
        };
        drop(leftover);
        if let Some(renderer) = &self.offline {
            let mut r = renderer.lock().unwrap_or_else(|e| e.into_inner());
            *r = Renderer::new(self.sample_rate);
        }
    }

    pub fn create(&self, kind: NodeKind) -> NodeId {
        let mut page = self.page.lock().unwrap_or_else(|e| e.into_inner());
        self.with_mailbox(|m| page.reclaim(&mut m.freed));
        let s = match page.free.pop() {
            Some(s) => s as usize,
            None => {
                let s = page.next_slot as usize;
                page.next_slot += 1;
                page.ids.push(s as NodeId);
                page.kinds.push(None);
                page.normalize.push(true);
                s
            }
        };
        let id = page.ids[s];
        page.kinds[s] = Some(kind);
        page.normalize[s] = true;
        drop(page);
        // The node, its buffers and (an oscillator) its tables are made here, not on the render thread.
        self.send(Cmd::Create(NodeState::new(id, kind, self.sample_rate)));
        id
    }
    /// `from`'s output `output` into `to`'s input `input` (connecting twice is one connection).
    pub fn connect(&self, from: NodeId, output: u32, to: NodeId, input: u32) {
        // Every node here has one input and one output.
        let _ = (output, input);
        self.send(Cmd::Connect { from, to, target: Target::Input });
    }
    /// `from`'s output into one of `to`'s params (summed with the param's own value, a-rate).
    pub fn connect_param(&self, from: NodeId, output: u32, to: NodeId, param: Param) {
        let _ = output;
        self.send(Cmd::Connect { from, to, target: Target::Param(param) });
    }
    /// `disconnect()` (every outgoing connection) when `to` is None, or only those to `to`.
    pub fn disconnect(&self, from: NodeId, to: Option<NodeId>) {
        self.send(Cmd::Disconnect { from, to });
    }
    pub fn param(&self, node: NodeId, param: Param, event: ParamEvent) {
        self.send(Cmd::Param { node, param, event });
    }
    pub fn set(&self, node: NodeId, attr: Attr) {
        let mut page = self.page.lock().unwrap_or_else(|e| e.into_inner());
        let kind = page.kind(node);
        match (kind, attr) {
            (Some(NodeKind::Oscillator), Attr::OscillatorType(t)) => {
                drop(page);
                self.send(Cmd::SetWave { node, tables: WaveTables::get(t, self.sample_rate) });
            }
            (Some(NodeKind::Convolver), Attr::Normalize(v)) => {
                // Read when the buffer is next set, as the spec has it.
                page.normalize[slot(node)] = v;
            }
            (Some(NodeKind::Convolver), Attr::Buffer(buffer)) => {
                let normalize = page.normalize[slot(node)];
                drop(page);
                // The kernel (the response partitioned, transformed and normalized) is made here.
                let state = buffer.and_then(|b| ConvolverState::new(&b, normalize, self.sample_rate));
                self.send(Cmd::SetConvolver { node, state });
            }
            (Some(_), attr) => {
                drop(page);
                self.send(Cmd::Set { node, attr });
            }
            (None, _) => {}
        }
    }
    /// A buffer source's `start(when, offset, duration)` or an oscillator's `start(when)`.
    pub fn start(&self, node: NodeId, when: f64, offset: f64, duration: Option<f64>) {
        self.send(Cmd::Start { node, when, offset, duration });
    }
    pub fn stop(&self, node: NodeId, when: f64) {
        self.send(Cmd::Stop { node, when });
    }
    /// The page no longer holds the node: the engine frees it once nothing feeds it and it can make no more sound
    /// (a playing source keeps going until it ends, as a browser's does after its JS object is collected).
    pub fn release(&self, node: NodeId) {
        self.send(Cmd::Release(node));
    }
    /// Events since the last call, in order.
    pub fn take_events(&self) -> Vec<Event> {
        let mut page = self.page.lock().unwrap_or_else(|e| e.into_inner());
        self.with_mailbox(|m| {
            page.reclaim(&mut m.freed);
            if m.events.is_empty() {
                return Vec::new();
            }
            // The mailbox keeps a vector with room, so the render thread's next events do not allocate there.
            let room = m.events.capacity().max(64);
            std::mem::replace(&mut m.events, Vec::with_capacity(room))
        })
    }

    /// Frames the render thread has written to the device and device buffers it filled (the live example's checks;
    /// both stay 0 on the silent clock and offline).
    pub fn device_counters(&self) -> (u64, u64) {
        (self.shared.device_frames.load(Ordering::Relaxed), self.shared.device_periods.load(Ordering::Relaxed))
    }

    /// Nodes created and not yet freed by the render thread, the destination aside (the examples' check that released
    /// nodes are freed).
    pub fn live_nodes(&self) -> usize {
        let mut page = self.page.lock().unwrap_or_else(|e| e.into_inner());
        self.with_mailbox(|m| page.reclaim(&mut m.freed));
        (page.next_slot as usize - 1) - page.free.len()
    }

    fn send(&self, cmd: Cmd) {
        // Closed, or the render thread gone (it never takes commands again): the command is dropped, not queued.
        if self.shared.state.load(Ordering::Acquire) == STATE_CLOSED || (self.offline.is_none() && self.shared.render_gone.load(Ordering::Acquire)) {
            return;
        }
        self.with_mailbox(|m| m.commands.push(cmd));
    }

    /// Runs `f` on the mailbox, then frees what the render thread handed back, once the lock is let go.
    fn with_mailbox<R>(&self, f: impl FnOnce(&mut Mailbox) -> R) -> R {
        let (result, garbage) = {
            let mut m = self.shared.mailbox.lock().unwrap_or_else(|e| e.into_inner());
            let result = f(&mut m);
            // Taken with a vector with room left in its place, so the render thread's next garbage does not allocate.
            let room = m.garbage.capacity().max(64);
            let garbage: Vec<Garbage> = if m.garbage.is_empty() { Vec::new() } else { std::mem::replace(&mut m.garbage, Vec::with_capacity(room)) };
            (result, garbage)
        };
        drop(garbage);
        result
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.close();
    }
}

/// Reference computations for the examples' checks: the formulas the nodes use, evaluated directly.
pub mod reference {
    use super::{BiquadType, BufferData};

    /// A biquad's magnitude response at `at` Hz for the given settings.
    pub fn biquad_magnitude(kind: BiquadType, frequency: f64, q: f64, gain: f64, sample_rate: f64, at: f64) -> f64 {
        crate::biquad::coefficients(kind, frequency, q, gain, sample_rate).magnitude(at, sample_rate)
    }

    /// The spec's normalization scale for a convolver's response.
    pub fn convolver_scale(buffer: &BufferData) -> f32 {
        crate::convolver::normalization_scale(buffer)
    }

    /// A compressor's static curve at level `x` and its makeup gain, both linear.
    pub fn compressor_curve(threshold: f32, knee: f32, ratio: f32, x: f32) -> (f32, f32) {
        crate::compressor::static_curve(threshold, knee, ratio, x)
    }

    /// Equal-power gains (left, right) for a mono input at `azimuth` degrees.
    pub fn equal_power_gains(azimuth: f64) -> (f32, f32) {
        crate::nodes::equal_power(azimuth, 1.0, 1.0, true)
    }

    /// The azimuth (degrees) of a source at `source` for a listener at `listener` facing `forward`, `up` up.
    pub fn azimuth(source: [f64; 3], listener: [f64; 3], forward: [f64; 3], up: [f64; 3]) -> f64 {
        crate::nodes::Panner::azimuth(source, listener, forward, up)
    }
}
