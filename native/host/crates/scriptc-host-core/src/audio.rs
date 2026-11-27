//! Web Audio: `AudioContext`, its nodes, params, listener and buffers, the part of the API a page's sound uses, bound
//! to the native graph (audio-engine: WASAPI output, 128-frame quanta on a render thread of its own) and
//! decoder (audio-decode). Windows only for now: elsewhere `AudioContext` stays undefined and
//! a layer's audio decode rejects, as before.
//!
//! The page side lives on the thread that made the context (the page's main thread; a render thread or a worker has
//! no `AudioContext`, as a browser's worker has none). Every call that changes the graph is a command the engine
//! queues for its render thread, so a turn's calls land together; what the page reads back is answered here without a
//! round trip: the attributes as last set, and an AudioParam's `value` from a mirror of its automation timeline,
//! evaluated at the context's `currentTime` (Chrome answers the value of the last rendered quantum).
//!
//! - `new AudioContext({ latencyHint })` (`sampleRate` is the output's; a requested one is ignored). No autoplay policy
//!   here: a context starts "running", so the page's `resume()` on its first gesture resolves and changes nothing.
//!   `sampleRate`, `currentTime`, `state`, `destination`, `listener`, `baseLatency`, `outputLatency`; `resume()`,
//!   `suspend()`, `close()` (promises; `statechange` fired as a task first); `onstatechange` and listeners.
//! - `createGain`, `createBufferSource`, `createOscillator`, `createBiquadFilter`, `createStereoPanner`, `createPanner`,
//!   `createConvolver`, `createDynamicsCompressor`, `createBuffer`, `decodeAudioData(bytes, success?, error?)`.
//! - AudioNode: `connect(node | param, output?, input?)` (the node it was given, for chaining), `disconnect()` /
//!   `disconnect(node)`; `context`, `numberOfInputs`, `numberOfOutputs`, `channelCount`, `channelCountMode`,
//!   `channelInterpretation` (read as the spec's defaults; writes kept, not rendered). Each kind's params
//!   (`gain`, `frequency`, `detune`, `Q`, `playbackRate`, `pan`, `positionX`..., `orientationX`..., `threshold`, `knee`,
//!   `ratio`, `attack`, `release`) and attributes (`type`, `buffer`, `loop`, `loopStart`, `loopEnd`, `normalize`,
//!   `panningModel`, `distanceModel`, `refDistance`, `maxDistance`, `rolloffFactor`, `coneInnerAngle`,
//!   `coneOuterAngle`, `coneOuterGain`, `reduction`); `start`/`stop` on sources, `setPosition`/`setOrientation` on a
//!   panner and the listener; `ended` (`onended` first, then listeners) as a task once the engine reports it.
//! - AudioParam: `value`, `defaultValue`, `minValue`, `maxValue`, `automationRate`; `setValueAtTime`,
//!   `linearRampToValueAtTime`, `exponentialRampToValueAtTime`, `setTargetAtTime`, `setValueCurveAtTime`,
//!   `cancelScheduledValues`, `cancelAndHoldAtTime`, each returning the param.
//! - AudioBuffer: `length`, `duration`, `sampleRate`, `numberOfChannels`, `getChannelData(i)` (one live Float32Array per
//!   channel, the same each call: the script writes its samples into it), `copyToChannel`, `copyFromChannel`. The
//!   contents are acquired, as Chrome acquires them, when the buffer is assigned to a source's or a convolver's
//!   `buffer`: one immutable snapshot, kept and shared by every later assignment until the script writes a channel
//!   again (a decoded clip assigned to fifty sources is never copied).
//! - `decodeAudioData` and a layer's audio decode: decoded on the module pool (modules.rs), resolved on this
//!   thread with an AudioBuffer at the context's rate; bytes that are no audio reject with an EncodingError.
//!
//! - `new Audio(src?)` (HTMLAudioElement, no document node): `src` (resolved against the page; a `blob:` object URL as
//!   it is), `crossOrigin`, `loop`, `preload`, `volume`, `muted`, `paused`, `currentTime` (get and set), `duration`,
//!   `ended`, `readyState`, `networkState`, `error`; `load()`, `play()` (a promise: resolved once it plays, rejected
//!   with a NotSupportedError when the source cannot be fetched or decoded, an AbortError when a pause or a new load
//!   overtakes it), `pause()`, `canPlayType()`; `play`, `playing`, `pause`, `ended`, `error`, `loadeddata`, `canplay`,
//!   `canplaythrough`, `volumechange`, `seeked` (`on<type>` and listeners). The source is fetched whole on the network
//!   threads (modules.rs `load_media`, as fetch() reads it) and decoded on the pool, then played by a buffer source
//!   into the element's gain, straight into the destination: outside every AudioContext's graph (its limiter), as a
//!   browser's media element is. `pause()` keeps the position and `play()` resumes from it.
//!
//! One output: every context and every element render on one engine, made by whichever comes first. A context's
//! `close()` stops and cuts off its own graph and closes the engine only once nothing else renders on it; its
//! `suspend()` suspends the engine, so an element's sound waits with it .
//!
//! Lifetime: a node's object is the program's to hold; when its last count goes (objects.rs release) the engine is
//! told (`Engine::release`), and frees the node once nothing feeds it. A started source holds its own object until it
//! ends, as a browser keeps a playing node and its `ended` listeners alive with no reference left in script; a running
//! context holds its own until `close()`. The window's close closes every context (the device is released at once).
//!
//! Not carried: OfflineAudioContext, the node constructors (`new GainNode(ctx)`), AudioWorklet, analysers,
//! MediaElement and MediaStream nodes, PeriodicWave, IIR filters, `getFrequencyResponse`; `disconnect(param)` drops
//! every connection to that param's node (the engine disconnects by node).
//!
//! <PREFIX>AUDIO_TRACE=1: contexts, decodes, `ended` events (sampled), buffers acquired from script writes, and every
//! ten seconds the live nodes by kind; each element's loads (the URL redacted), decodes, play, pause and end, on
//! stderr. <PREFIX>AUDIO=0: no `AudioContext` and no `Audio` at all (the page is silent, as before this file).

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use audio_engine as ae;

use crate::objects::{self, Value};
use crate::values;

/// A Web Audio object as the object table names it (objects.rs `Kind::Audio`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handle {
    Context(u32),
    /// An AudioNode (the destination too), by its key here.
    Node(u32),
    /// One of a node's (or the listener's) params: the owner's key and the param's slot.
    Param(u32, u8),
    /// The context's AudioListener, by its key here (it is kept as a node with params and no engine node).
    Listener(u32),
    Buffer(u32),
    /// An `Audio` element.
    Media(u32),
}

// ── the trace ──────────────────────────────────────────────────────────

fn trace_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| crate::config::var_os("AUDIO_TRACE").is_some_and(|v| v != "0"))
}

fn trace(what: &str) {
    if trace_on() {
        // One clock for every thread (the decode workers' included): seconds since the first trace.
        static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
        eprintln!("[{:.3}] audio: {what}", START.get_or_init(Instant::now).elapsed().as_secs_f64());
    }
}

/// The trace names the first events of a kind, then one in a hundred.
fn sampled(n: u64) -> bool {
    n <= 5 || n % 100 == 0
}

// ── the page's side ────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NodeType {
    Destination,
    Listener,
    Gain,
    BufferSource,
    Oscillator,
    Biquad,
    StereoPanner,
    Panner,
    Convolver,
    Compressor,
}

impl NodeType {
    fn interface(self) -> &'static str {
        match self {
            NodeType::Destination => "AudioDestinationNode",
            NodeType::Listener => "AudioListener",
            NodeType::Gain => "GainNode",
            NodeType::BufferSource => "AudioBufferSourceNode",
            NodeType::Oscillator => "OscillatorNode",
            NodeType::Biquad => "BiquadFilterNode",
            NodeType::StereoPanner => "StereoPannerNode",
            NodeType::Panner => "PannerNode",
            NodeType::Convolver => "ConvolverNode",
            NodeType::Compressor => "DynamicsCompressorNode",
        }
    }

    fn engine_kind(self) -> Option<ae::NodeKind> {
        Some(match self {
            NodeType::Destination | NodeType::Listener => return None,
            NodeType::Gain => ae::NodeKind::Gain,
            NodeType::BufferSource => ae::NodeKind::BufferSource,
            NodeType::Oscillator => ae::NodeKind::Oscillator,
            NodeType::Biquad => ae::NodeKind::BiquadFilter,
            NodeType::StereoPanner => ae::NodeKind::StereoPanner,
            NodeType::Panner => ae::NodeKind::Panner,
            NodeType::Convolver => ae::NodeKind::Convolver,
            NodeType::Compressor => ae::NodeKind::DynamicsCompressor,
        })
    }

    fn source(self) -> bool {
        matches!(self, NodeType::BufferSource | NodeType::Oscillator)
    }

    /// numberOfInputs, numberOfOutputs.
    fn ports(self) -> (u32, u32) {
        match self {
            NodeType::BufferSource | NodeType::Oscillator => (0, 1),
            NodeType::Destination => (1, 0),
            _ => (1, 1),
        }
    }

    /// channelCount, channelCountMode as the spec defaults them.
    fn channels(self) -> (f64, &'static str) {
        match self {
            NodeType::Destination => (2.0, "explicit"),
            NodeType::StereoPanner | NodeType::Panner | NodeType::Convolver | NodeType::Compressor => (2.0, "clamped-max"),
            _ => (2.0, "max"),
        }
    }
}

const FLT_MAX: f32 = f32::MAX;

/// A kind's params: name, engine param, default, nominal range (`None` for the frequency bound: the context's Nyquist),
/// k-rate.
fn param_specs(kind: NodeType, nyquist: f32) -> Vec<(&'static str, ae::Param, f32, f32, f32, bool)> {
    use ae::Param as P;
    let any = (-FLT_MAX, FLT_MAX);
    match kind {
        NodeType::Gain => vec![("gain", P::Gain, 1.0, any.0, any.1, false)],
        NodeType::BufferSource => vec![
            ("playbackRate", P::PlaybackRate, 1.0, any.0, any.1, true),
            ("detune", P::Detune, 0.0, any.0, any.1, true),
        ],
        NodeType::Oscillator => vec![
            ("frequency", P::Frequency, 440.0, -nyquist, nyquist, false),
            ("detune", P::Detune, 0.0, -153_600.0, 153_600.0, false),
        ],
        NodeType::Biquad => vec![
            ("frequency", P::Frequency, 350.0, 0.0, nyquist, false),
            ("detune", P::Detune, 0.0, -153_600.0, 153_600.0, false),
            ("Q", P::Q, 1.0, any.0, any.1, false),
            ("gain", P::Gain, 0.0, any.0, 1541.0, false),
        ],
        NodeType::StereoPanner => vec![("pan", P::Pan, 0.0, -1.0, 1.0, false)],
        NodeType::Panner => vec![
            ("positionX", P::PositionX, 0.0, any.0, any.1, false),
            ("positionY", P::PositionY, 0.0, any.0, any.1, false),
            ("positionZ", P::PositionZ, 0.0, any.0, any.1, false),
            ("orientationX", P::OrientationX, 1.0, any.0, any.1, false),
            ("orientationY", P::OrientationY, 0.0, any.0, any.1, false),
            ("orientationZ", P::OrientationZ, 0.0, any.0, any.1, false),
        ],
        NodeType::Compressor => vec![
            ("threshold", P::Threshold, -24.0, -100.0, 0.0, true),
            ("knee", P::Knee, 30.0, 0.0, 40.0, true),
            ("ratio", P::Ratio, 12.0, 1.0, 20.0, true),
            ("attack", P::Attack, 0.003, 0.0, 1.0, true),
            ("release", P::Release, 0.25, 0.0, 1.0, true),
        ],
        NodeType::Listener => vec![
            ("positionX", P::ListenerPositionX, 0.0, any.0, any.1, false),
            ("positionY", P::ListenerPositionY, 0.0, any.0, any.1, false),
            ("positionZ", P::ListenerPositionZ, 0.0, any.0, any.1, false),
            ("forwardX", P::ListenerForwardX, 0.0, any.0, any.1, false),
            ("forwardY", P::ListenerForwardY, 0.0, any.0, any.1, false),
            ("forwardZ", P::ListenerForwardZ, -1.0, any.0, any.1, false),
            ("upX", P::ListenerUpX, 0.0, any.0, any.1, false),
            ("upY", P::ListenerUpY, 1.0, any.0, any.1, false),
            ("upZ", P::ListenerUpZ, 0.0, any.0, any.1, false),
        ],
        NodeType::Destination | NodeType::Convolver => Vec::new(),
    }
}

/// One scheduled automation event (the mirror of what the engine was sent). Ramps are keyed by their end time.
#[derive(Clone, Debug)]
enum Ev {
    Set(f64, f64),
    Linear(f64, f64),
    Exp(f64, f64),
    Target { target: f64, time: f64, constant: f64 },
    Curve { values: Rc<[f32]>, time: f64, duration: f64 },
}

impl Ev {
    fn time(&self) -> f64 {
        match *self {
            Ev::Set(_, t) | Ev::Linear(_, t) | Ev::Exp(_, t) => t,
            Ev::Target { time, .. } | Ev::Curve { time, .. } => time,
        }
    }

    fn end(&self) -> f64 {
        match *self {
            Ev::Curve { time, duration, .. } => time + duration,
            _ => self.time(),
        }
    }
}

fn curve_at(values: &[f32], time: f64, duration: f64, t: f64) -> f64 {
    let n = values.len();
    if n == 0 {
        return 0.0;
    }
    if duration <= 0.0 || t >= time + duration {
        return f64::from(values[n - 1]);
    }
    let k = (n - 1) as f64 * ((t - time) / duration).max(0.0);
    let i = (k.floor() as usize).min(n - 1);
    let next = values[(i + 1).min(n - 1)];
    f64::from(values[i]) + (f64::from(next) - f64::from(values[i])) * (k - i as f64)
}

/// An AudioParam's timeline, as the spec computes it: `base` is the value (and the time it took it) before the first
/// event kept; events wholly in the past are folded into it as the clock passes them.
#[derive(Clone, Debug)]
struct Timeline {
    default: f32,
    min: f32,
    max: f32,
    base: (f64, f64),
    events: Vec<Ev>,
}

/// What processing one event leaves: the value, and from when it holds.
enum Step {
    Done(f64),
    Hold(f64, f64),
}

impl Timeline {
    fn new(default: f32, min: f32, max: f32) -> Timeline {
        Timeline { default, min, max, base: (f64::from(default), 0.0), events: Vec::new() }
    }

    /// Event `i` applied to `(v, vt)` and read at `t` (Done: `t` falls inside it), the next event's start bounding it.
    fn step(&self, i: usize, (v, vt): (f64, f64), t: f64) -> Step {
        let next = self.events.get(i + 1).map(Ev::time);
        match &self.events[i] {
            Ev::Linear(x, et) if *et > t => Step::Done(if t <= vt || *et <= vt { v } else { v + (x - v) * (t - vt) / (et - vt) }),
            Ev::Exp(x, et) if *et > t => Step::Done(if t <= vt || *et <= vt || v * x <= 0.0 { v } else { v * (x / v).powf((t - vt) / (et - vt)) }),
            e if e.time() > t => Step::Done(v),
            Ev::Set(x, et) | Ev::Linear(x, et) | Ev::Exp(x, et) => Step::Hold(*x, *et),
            Ev::Target { target, time, constant } => {
                let decay = |until: f64| if *constant <= 0.0 { *target } else { target + (v - target) * (-(until - time) / constant).exp() };
                match next {
                    Some(n) if n <= t => Step::Hold(decay(n), n),
                    _ => Step::Done(decay(t)),
                }
            }
            Ev::Curve { values, time, duration } => {
                let end = time + duration;
                match next {
                    Some(n) if n <= t && n < end => Step::Hold(curve_at(values, *time, *duration, n), n),
                    _ if t < end => Step::Done(curve_at(values, *time, *duration, t)),
                    _ => Step::Hold(curve_at(values, *time, *duration, end), end),
                }
            }
        }
    }

    fn value_at(&self, t: f64) -> f64 {
        let mut state = self.base;
        for i in 0..self.events.len() {
            match self.step(i, state, t) {
                Step::Done(v) => return v,
                Step::Hold(v, at) => state = (v, at),
            }
        }
        state.0
    }

    /// Folds the events the clock has passed into `base` (a node's timeline never grows without bound).
    fn prune(&mut self, now: f64) {
        loop {
            let fold = match self.events.len() {
                0 => false,
                1 => !matches!(self.events[0], Ev::Target { .. }) && self.events[0].end() <= now,
                _ => self.events[1].time() <= now,
            };
            if !fold {
                return;
            }
            // Read where the next event begins (or where this one ends): the state it leaves.
            let at = self.events.get(1).map_or(self.events[0].end(), Ev::time);
            match self.step(0, self.base, at) {
                Step::Hold(v, t) => self.base = (v, t),
                Step::Done(v) => self.base = (v, at),
            }
            self.events.remove(0);
        }
    }

    fn insert(&mut self, ev: Ev) {
        let t = ev.time();
        let at = self.events.partition_point(|e| e.time() <= t);
        self.events.insert(at, ev);
    }

    /// The engine's event applied to the mirror, at `now`.
    fn apply(&mut self, ev: &ae::ParamEvent, now: f64) {
        self.prune(now);
        match ev {
            ae::ParamEvent::Value(v) => self.insert(Ev::Set(f64::from(*v), now)),
            ae::ParamEvent::SetValueAtTime { value, time } => self.insert(Ev::Set(f64::from(*value), *time)),
            ae::ParamEvent::LinearRampToValueAtTime { value, time } => self.insert(Ev::Linear(f64::from(*value), *time)),
            ae::ParamEvent::ExponentialRampToValueAtTime { value, time } => self.insert(Ev::Exp(f64::from(*value), *time)),
            ae::ParamEvent::SetTargetAtTime { target, time, time_constant } => {
                self.insert(Ev::Target { target: f64::from(*target), time: *time, constant: *time_constant })
            }
            ae::ParamEvent::SetValueCurveAtTime { values, time, duration } => {
                self.insert(Ev::Curve { values: values.as_slice().into(), time: *time, duration: *duration })
            }
            ae::ParamEvent::CancelScheduledValues { time } => {
                // A ramp cut short leaves the param where it had got to (Chrome reads back the last rendered value,
                // and the page schedules from it: `cancelScheduledValues(t); setValueAtTime(p.value, t)`): the mirror
                // holds that value from `time` on. Nothing in progress cut: nothing held, so a later ramp still starts
                // from the event before it.
                let held = self.value_at(*time);
                self.events.retain(|e| e.time() < *time);
                if (self.value_at(*time) - held).abs() > f64::EPSILON * held.abs().max(1.0) {
                    self.insert(Ev::Set(held, *time));
                }
            }
            ae::ParamEvent::CancelAndHoldAtTime { time } => {
                let held = self.value_at(*time);
                self.events.retain(|e| e.time() < *time);
                self.insert(Ev::Set(held, *time));
            }
        }
    }

    /// `value` as Chrome reads it: the computed value now, clamped to the nominal range.
    fn read(&mut self, now: f64) -> f64 {
        self.prune(now);
        let v = self.value_at(now);
        if v.is_nan() { f64::from(self.default) } else { v.clamp(f64::from(self.min), f64::from(self.max)) }
    }
}

struct Slot {
    name: &'static str,
    param: ae::Param,
    /// Its AudioParam object, made on first read and held by the node (`node.gain === node.gain`); 0 until then.
    obj: u64,
    line: Timeline,
    k_rate: bool,
}

/// An object's event handlers: its `on<type>` property and its listeners (closures, retained here).
#[derive(Default)]
struct Listeners {
    on: Option<u64>,
    added: Vec<(String, u64)>,
}

impl Listeners {
    fn handlers(&self, kind: &str, on_kind: &str) -> Vec<u64> {
        let on = self.on.filter(|_| kind == on_kind);
        on.into_iter().chain(self.added.iter().filter(|(k, _)| k == kind).map(|(_, c)| *c)).collect()
    }

    fn drain(&mut self, later: &mut Later) {
        later.closures.extend(self.on.take());
        later.closures.extend(self.added.drain(..).map(|(_, c)| c));
    }
}

/// Counts to drop once this module's state is no longer borrowed (a release can free an object, which comes back
/// here through objects.rs, and a closure's release can free compiled values that hold host objects).
#[derive(Default)]
struct Later {
    objects: Vec<u64>,
    closures: Vec<u64>,
}

impl Later {
    fn run(self) {
        for c in self.closures {
            crate::abi::closure_release(c);
        }
        for r in self.objects {
            objects::release(r);
        }
    }
}

struct Node {
    ctx: u32,
    engine: Rc<ae::Engine>,
    id: ae::NodeId,
    kind: NodeType,
    /// The program's object (not counted here; its release frees this entry).
    obj: u64,
    params: Vec<Slot>,
    listeners: Listeners,
    /// `type`: a filter's or an oscillator's.
    type_name: &'static str,
    /// The buffer object assigned (held), and its id.
    buffer: Option<(u64, u32)>,
    looping: bool,
    loop_start: f64,
    loop_end: f64,
    normalize: bool,
    panning_model: &'static str,
    distance_model: &'static str,
    ref_distance: f64,
    max_distance: f64,
    rolloff: f64,
    cone_inner: f64,
    cone_outer: f64,
    cone_outer_gain: f64,
    channel_count: f64,
    channel_count_mode: String,
    channel_interpretation: String,
    started: bool,
    ended: bool,
    /// The node holds its own object while it plays (a started source until `ended`).
    held: bool,
}

struct Ctx {
    engine: Rc<ae::Engine>,
    obj: u64,
    rate: f32,
    state: &'static str,
    /// The destination's and the listener's keys; the context holds their objects.
    destination: u32,
    listener: u32,
    listeners: Listeners,
    /// The context holds its own object until `close()` (a running context is never collected).
    held: bool,
}

struct Buffer {
    rate: f32,
    length: usize,
    channels: usize,
    /// The contents as last acquired (None: never acquired, all zeros).
    data: Option<Arc<ae::BufferData>>,
    /// Each channel's Float32Array, once `getChannelData` made it (held; 0 for none).
    arrays: Vec<u64>,
    /// Made by createBuffer (its samples are the script's), for the trace.
    script: bool,
}

/// A task for the page thread's loop.
enum Task {
    /// An engine's node ended (the engine by [`engine_key`]).
    Ended { engine: usize, id: ae::NodeId },
    StateChange(u32),
    /// An event at a media element ("play", "pause", "ended", ...).
    MediaEvent { id: u32, kind: &'static str },
    /// A promise this module holds, and how it settles.
    Settle { promise: u64, rejected: Option<(&'static str, String)> },
}

#[derive(Default)]
struct Stats {
    created: u64,
    released: u64,
    ended: u64,
    decoded: u64,
    decode_failures: u64,
    summary_at: Option<Instant>,
    summary_seen: (u64, u64, u64),
}

#[derive(Default)]
struct Audio {
    next: u32,
    contexts: HashMap<u32, Ctx>,
    nodes: HashMap<u32, Node>,
    buffers: HashMap<u32, Buffer>,
    /// An engine's node to what it is here (the `ended` events name engine nodes).
    by_engine: HashMap<(usize, ae::NodeId), Target>,
    media: HashMap<u32, Media>,
    tasks: VecDeque<Task>,
    stats: Stats,
}

impl Audio {
    fn key(&mut self) -> u32 {
        self.next += 1;
        self.next
    }
}

thread_local! {
    static AUDIO: RefCell<Audio> = RefCell::new(Audio::default());
    /// Whether this thread can make a context (see `available`).
    static AVAILABLE: Cell<Option<bool>> = const { Cell::new(None) };
    /// The thread's one output: every AudioContext's and every media element's graph renders on it, as a browser
    /// mixes a page's contexts and media into one output stream. Gone once nothing open uses it.
    static SHARED: RefCell<Option<Rc<ae::Engine>>> = const { RefCell::new(None) };
}

/// What an engine node is here.
#[derive(Clone, Copy, Debug)]
enum Target {
    Node(u32),
    /// A media element's playing source.
    Media(u32),
}

/// An engine's identity, for the `ended` events' map (its nodes hold the engine, so the address is not reused while
/// any entry names it).
fn engine_key(e: &Rc<ae::Engine>) -> usize {
    Rc::as_ptr(e) as usize
}

/// The shared engine, made on first use (a context made, an element loading); none is opened before.
fn shared_engine() -> Result<Rc<ae::Engine>, String> {
    if let Some(e) = SHARED.with(|s| s.borrow().clone()) {
        return Ok(e);
    }
    let engine = match new_engine() {
        Ok(e) => Rc::new(e),
        Err(e) => {
            // No engine here at all: `AudioContext` and `Audio` read undefined from now on.
            eprintln!("scriptc-host audio: no audio output ({e})");
            AVAILABLE.with(|c| c.set(Some(false)));
            return Err(e);
        }
    };
    SHARED.with(|s| *s.borrow_mut() = Some(engine.clone()));
    Ok(engine)
}

/// Whether anything but context `except` still renders on `engine`: another open context, or a media element.
fn engine_in_use(a: &Audio, engine: &Rc<ae::Engine>, except: u32) -> bool {
    a.contexts.iter().any(|(id, c)| *id != except && c.state != "closed" && Rc::ptr_eq(&c.engine, engine))
        || a.media.values().any(|m| m.engine.as_ref().is_some_and(|e| Rc::ptr_eq(e, engine)))
}

/// Closes `engine` (its device released) and forgets it as the shared one.
fn close_engine(engine: &Rc<ae::Engine>) {
    engine.close();
    SHARED.with(|s| {
        let mut s = s.borrow_mut();
        if s.as_ref().is_some_and(|e| Rc::ptr_eq(e, engine)) {
            *s = None;
        }
    });
}

fn with<R>(f: impl FnOnce(&mut Audio) -> R) -> R {
    AUDIO.with(|a| f(&mut a.borrow_mut()))
}

/// An engine, or why none: the output opened (the engine never fails: no device is its silent clock), caught if the
/// engine itself cannot run here.
fn new_engine() -> Result<ae::Engine, String> {
    std::panic::catch_unwind(ae::Engine::new).map_err(|e| {
        e.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| e.downcast_ref::<String>().cloned()).unwrap_or_else(|| "the engine panicked".into())
    })
}

/// Whether `AudioContext` and `Audio` are defined on this thread: the page's main thread, unless <PREFIX>AUDIO=0 or an
/// engine could not be made. Reading them opens nothing: the output opens with the first use (`shared_engine`).
pub fn available() -> bool {
    if let Some(a) = AVAILABLE.with(Cell::get) {
        return a;
    }
    let a = crate::render_thread::is_main_thread() && !crate::workers::in_worker() && crate::config::var_os("AUDIO").is_none_or(|v| v != "0");
    AVAILABLE.with(|c| c.set(Some(a)));
    a
}

fn throw(name: &str, message: &str) -> String {
    crate::abi::throw(values::new_error(name, message))
}

/// A WebIDL double argument: `default` when absent, a TypeError when not finite.
fn double(args: &[Value], i: usize, default: f64, what: &str) -> Result<f64, String> {
    match args.get(i) {
        None | Some(Value::Undefined) => Ok(default),
        Some(Value::Number(n)) if n.is_finite() => Ok(*n),
        Some(Value::Bool(b)) => Ok(f64::from(u8::from(*b))),
        Some(Value::Null) => Ok(0.0),
        _ => Err(throw("TypeError", &format!("Failed to execute '{what}': The provided double value is non-finite."))),
    }
}

/// A WebIDL (restricted) float from a finite double: one beyond the float range is a TypeError, as the conversion
/// makes it.
fn float(v: f64, what: &str) -> Result<f32, String> {
    let f = v as f32;
    if f.is_finite() { Ok(f) } else { Err(throw("TypeError", &format!("Failed to execute '{what}': The provided float value is non-finite."))) }
}

/// A double attribute's new value (a non-finite one throws, as WebIDL's conversion does).
fn double_value(value: &Value, what: &str) -> Result<f64, String> {
    double(std::slice::from_ref(value), 0, f64::NAN, what).and_then(|n| {
        if n.is_nan() { Err(throw("TypeError", &format!("Failed to set the '{what}' property: The provided double value is non-finite."))) } else { Ok(n) }
    })
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Undefined | Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => *n != 0.0 && !n.is_nan(),
        Value::Str(s) => !s.is_empty(),
        _ => true,
    }
}

fn closure_of(v: &Value) -> Option<u64> {
    match v {
        Value::Closure(c) => Some(*c),
        _ => None,
    }
}

fn held_promise() -> (Value, u64) {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    objects::retain(r);
    (promise, r)
}

/// A new object for a handle, held once by the caller (the table's allocation count goes when the operation ends).
fn held_object(h: Handle) -> u64 {
    let Value::Object(r) = objects::new_audio(h) else { unreachable!() };
    objects::retain(r);
    r
}

// ── the context ────────────────────────────────────────────────────────

/// `new AudioContext(options)`.
pub fn construct(args: &[Value]) -> Result<Value, String> {
    if !available() {
        return Err(throw("NotSupportedError", "Failed to construct 'AudioContext': this host has no audio."));
    }
    if let Some(Value::Object(o)) = args.first() {
        // latencyHint: "interactive" is what the engine always is; a number or another category changes nothing.
        if let Ok(Value::Str(hint)) = objects::get(*o, "latencyHint")
            && !matches!(hint.as_str(), "interactive" | "balanced" | "playback")
        {
            return Err(throw("TypeError", &format!("Failed to construct 'AudioContext': The provided value '{hint}' is not a valid enum value of type AudioContextLatencyCategory.")));
        }
    }
    let engine = shared_engine().map_err(|e| throw("NotSupportedError", &format!("Failed to construct 'AudioContext': {e}")))?;
    let rate = engine.sample_rate();
    let (id, destination, listener) = with(|a| {
        let id = a.key();
        let destination = a.key();
        let listener = a.key();
        a.nodes.insert(destination, new_node(id, engine.clone(), ae::DESTINATION, NodeType::Destination, rate));
        a.nodes.insert(listener, new_node(id, engine.clone(), ae::DESTINATION, NodeType::Listener, rate));
        (id, destination, listener)
    });
    // The context's object holds itself (until close()) and its destination's and listener's objects.
    let obj = held_object(Handle::Context(id));
    let dest_obj = held_object(Handle::Node(destination));
    let listener_obj = held_object(Handle::Listener(listener));
    with(|a| {
        a.nodes.get_mut(&destination).map(|n| n.obj = dest_obj);
        a.nodes.get_mut(&listener).map(|n| n.obj = listener_obj);
        a.contexts.insert(id, Ctx { engine: engine.clone(), obj, rate, state: "running", destination, listener, listeners: Listeners::default(), held: true });
    });
    trace(&format!("context {id}: {rate} Hz, output latency {:.1} ms, {:?}", engine.output_latency() * 1000.0, engine.state()));
    Ok(Value::Object(obj))
}

fn new_node(ctx: u32, engine: Rc<ae::Engine>, id: ae::NodeId, kind: NodeType, rate: f32) -> Node {
    let params = param_specs(kind, rate / 2.0)
        .into_iter()
        .map(|(name, param, default, min, max, k_rate)| Slot { name, param, obj: 0, line: Timeline::new(default, min, max), k_rate })
        .collect();
    let (channel_count, mode) = kind.channels();
    Node {
        ctx,
        engine,
        id,
        kind,
        obj: 0,
        params,
        listeners: Listeners::default(),
        type_name: match kind {
            NodeType::Biquad => "lowpass",
            NodeType::Oscillator => "sine",
            _ => "",
        },
        buffer: None,
        looping: false,
        loop_start: 0.0,
        loop_end: 0.0,
        normalize: true,
        panning_model: "equalpower",
        distance_model: "inverse",
        ref_distance: 1.0,
        max_distance: 10000.0,
        rolloff: 1.0,
        cone_inner: 360.0,
        cone_outer: 360.0,
        cone_outer_gain: 0.0,
        channel_count,
        channel_count_mode: mode.into(),
        channel_interpretation: "speakers".into(),
        started: false,
        ended: false,
        held: false,
    }
}

/// The sample rate of `v` when it is an AudioContext (decodeAudio's context).
fn context_rate(v: &Value) -> Option<(u32, f32)> {
    let Value::Object(r) = v else { return None };
    let Some(Handle::Context(id)) = objects::audio_of(*r) else { return None };
    with(|a| a.contexts.get(&id).map(|c| (id, c.rate)))
}

const CONTEXT_METHODS: &[&str] = &[
    "createGain", "createBufferSource", "createOscillator", "createBiquadFilter", "createStereoPanner", "createPanner",
    "createConvolver", "createDynamicsCompressor", "createBuffer", "decodeAudioData", "resume", "suspend", "close",
    "addEventListener", "removeEventListener",
];

fn context_get(id: u32, name: &str) -> Option<Value> {
    with(|a| {
        let c = a.contexts.get(&id)?;
        let obj = |key: u32| a.nodes.get(&key).map_or(Value::Null, |n| Value::Object(n.obj));
        Some(match name {
            "sampleRate" => Value::Number(f64::from(c.rate)),
            "currentTime" => Value::Number(c.engine.current_time()),
            "state" => Value::Str(c.state.into()),
            "destination" => obj(c.destination),
            "listener" => obj(c.listener),
            "baseLatency" => Value::Number(128.0 / f64::from(c.rate)),
            "outputLatency" => Value::Number(c.engine.output_latency()),
            "onstatechange" => c.listeners.on.map_or(Value::Null, Value::Closure),
            _ => return None,
        })
    })
}

fn context_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    let Some((engine, rate, state)) = with(|a| a.contexts.get(&id).map(|c| (c.engine.clone(), c.rate, c.state))) else {
        return Err(throw("InvalidStateError", &format!("Failed to execute '{name}' on 'AudioContext': a released context")));
    };
    let kind = match name {
        "createGain" => Some(NodeType::Gain),
        "createBufferSource" => Some(NodeType::BufferSource),
        "createOscillator" => Some(NodeType::Oscillator),
        "createBiquadFilter" => Some(NodeType::Biquad),
        "createStereoPanner" => Some(NodeType::StereoPanner),
        "createPanner" => Some(NodeType::Panner),
        "createConvolver" => Some(NodeType::Convolver),
        "createDynamicsCompressor" => Some(NodeType::Compressor),
        _ => None,
    };
    if let Some(kind) = kind {
        // A closed context still makes nodes (they do nothing), as a browser's does.
        let engine_id = engine.create(kind.engine_kind().expect("an engine node"));
        let key = with(|a| {
            let key = a.key();
            a.nodes.insert(key, new_node(id, engine.clone(), engine_id, kind, rate));
            a.by_engine.insert((engine_key(&engine), engine_id), Target::Node(key));
            a.stats.created += 1;
            key
        });
        let v = objects::new_audio(Handle::Node(key));
        if let Value::Object(r) = v {
            with(|a| a.nodes.get_mut(&key).map(|n| n.obj = r));
        }
        return Ok(v);
    }
    match name {
        "createBuffer" => {
            let channels = double(args, 0, f64::NAN, "createBuffer")?;
            let length = double(args, 1, f64::NAN, "createBuffer")?;
            let sample_rate = double(args, 2, f64::NAN, "createBuffer")?;
            if !(1.0..=32.0).contains(&channels) {
                return Err(throw("NotSupportedError", &format!("Failed to execute 'createBuffer' on 'BaseAudioContext': The number of channels provided ({channels}) is outside the range [1, 32].")));
            }
            if !(length >= 1.0) {
                return Err(throw("NotSupportedError", &format!("Failed to execute 'createBuffer' on 'BaseAudioContext': The number of frames provided ({length}) is less than or equal to the minimum bound (0).")));
            }
            if !(3000.0..=768_000.0).contains(&sample_rate) {
                return Err(throw("NotSupportedError", &format!("Failed to execute 'createBuffer' on 'BaseAudioContext': The sample rate provided ({sample_rate}) is outside the range [3000, 768000].")));
            }
            let (channels, length) = (channels as usize, length as usize);
            if length > (1usize << 31) / 4 / channels {
                return Err(throw("NotSupportedError", &format!("Failed to execute 'createBuffer' on 'BaseAudioContext': The number of frames provided ({length}) is too large for {channels} channels.")));
            }
            Ok(new_buffer(sample_rate as f32, length, channels, None, true))
        }
        "decodeAudioData" => {
            let bytes = match args.first() {
                Some(Value::Object(r)) => values::bytes_of(*r).map(|(_, b)| b),
                _ => None,
            };
            let Some(bytes) = bytes else {
                return Err(throw("TypeError", "Failed to execute 'decodeAudioData' on 'BaseAudioContext': parameter 1 is not of type 'ArrayBuffer'."));
            };
            let success = args.get(1).and_then(closure_of);
            let failure = args.get(2).and_then(closure_of);
            Ok(decode(bytes, rate, success, failure))
        }
        "resume" | "suspend" | "close" => {
            let (promise, r) = held_promise();
            if state == "closed" {
                let message = format!("Failed to execute '{name}' on 'AudioContext': Cannot {name} a closed AudioContext.");
                with(|a| a.tasks.push_back(Task::Settle { promise: r, rejected: Some(("InvalidStateError", message)) }));
                return Ok(promise);
            }
            let next = match name {
                "resume" => {
                    engine.resume();
                    "running"
                }
                "suspend" => {
                    engine.suspend();
                    "suspended"
                }
                // The engine is shared (media elements, other contexts): the context's own graph is silenced (its
                // sources stopped, every node cut off), and the engine closes once nothing else uses it.
                _ => "closed",
            };
            let mut later = Later::default();
            let mut last = false;
            with(|a| {
                if next == "closed" {
                    for n in a.nodes.values().filter(|n| n.ctx == id && n.kind.engine_kind().is_some()) {
                        if n.kind.source() && n.started && !n.ended {
                            engine.stop(n.id, 0.0);
                        }
                        engine.disconnect(n.id, None);
                    }
                    last = !engine_in_use(a, &engine, id);
                }
                let changed = a.contexts.get_mut(&id).is_some_and(|c| {
                    let changed = c.state != next;
                    c.state = next;
                    if next == "closed" && std::mem::take(&mut c.held) {
                        // No more events: the context lets go of itself, and its playing sources of theirs.
                        later.objects.push(c.obj);
                    }
                    changed
                });
                if next == "closed" {
                    release_sources(a, id, &mut later);
                }
                if changed {
                    a.tasks.push_back(Task::StateChange(id));
                }
                a.tasks.push_back(Task::Settle { promise: r, rejected: None });
            });
            if last {
                close_engine(&engine);
            }
            trace(&format!("context {id}: {name}() -> {next}{}", if last { " (output closed)" } else { "" }));
            later.run();
            Ok(promise)
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1)) {
                let kind = objects::to_display(kind);
                let mut later = Later::default();
                with(|a| {
                    if let Some(ctx) = a.contexts.get_mut(&id) {
                        listen(&mut ctx.listeners, name == "addEventListener", &kind, *c, &mut later);
                    }
                });
                later.run();
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

fn listen(listeners: &mut Listeners, add: bool, kind: &str, closure: u64, later: &mut Later) {
    let at = listeners.added.iter().position(|(k, c)| k == kind && *c == closure);
    match (add, at) {
        (true, None) => {
            crate::abi::closure_retain(closure);
            listeners.added.push((kind.to_string(), closure));
        }
        (false, Some(i)) => {
            listeners.added.remove(i);
            later.closures.push(closure);
        }
        _ => {}
    }
}

fn set_on(listeners: &mut Listeners, value: &Value, later: &mut Later) {
    let closure = closure_of(value);
    if let Some(c) = closure {
        crate::abi::closure_retain(c);
    }
    later.closures.extend(std::mem::replace(&mut listeners.on, closure));
}

/// A closed context's sources will not end: each lets go of its own object.
fn release_sources(a: &mut Audio, ctx: u32, later: &mut Later) {
    for n in a.nodes.values_mut().filter(|n| n.ctx == ctx && n.held) {
        n.held = false;
        later.objects.push(n.obj);
    }
}

// ── buffers ────────────────────────────────────────────────────────────

fn new_buffer(rate: f32, length: usize, channels: usize, data: Option<Arc<ae::BufferData>>, script: bool) -> Value {
    let id = with(|a| {
        let id = a.key();
        a.buffers.insert(id, Buffer { rate, length, channels, data, arrays: vec![0; channels], script });
        id
    });
    objects::new_audio(Handle::Buffer(id))
}

fn zeros(rate: f32, length: usize, channels: usize) -> Arc<ae::BufferData> {
    Arc::new(ae::BufferData { sample_rate: rate, channels: vec![vec![0.0; length]; channels] })
}

fn f32_elem() -> u32 {
    values::typed_array_elem("Float32Array").expect("Float32Array")
}

/// A Float32Array's samples, when `r` is one.
fn samples_of(r: u64) -> Option<Vec<f32>> {
    let (elem, bytes) = values::bytes_of(r)?;
    (elem == f32_elem()).then(|| bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

/// The buffer's contents now, acquired: the last snapshot when the script has not written a channel since, else a new
/// one with the channels it wrote.
fn acquire(a: &mut Audio, id: u32) -> Option<Arc<ae::BufferData>> {
    let b = a.buffers.get_mut(&id)?;
    let (rate, length, count) = (b.rate, b.length, b.channels);
    let data = b.data.get_or_insert_with(|| zeros(rate, length, count));
    let mut written: Vec<(usize, Vec<f32>)> = Vec::new();
    for (ch, &array) in b.arrays.iter().enumerate() {
        if array == 0 {
            continue;
        }
        let Some((_, at, len)) = values::bytes_view(array) else { continue };
        // SAFETY: the view is the array's storage, valid until the next host call (none is made while it is read).
        let bytes = unsafe { std::slice::from_raw_parts(at, len) };
        if bytes.len() != length * 4 {
            continue;
        }
        let current = &data.channels[ch];
        let same = bytes.len() == current.len() * 4
            && current.iter().zip(bytes.chunks_exact(4)).all(|(f, c)| f.to_bits() == u32::from_le_bytes([c[0], c[1], c[2], c[3]]));
        if !same {
            written.push((ch, bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()));
        }
    }
    if !written.is_empty() {
        let mut channels = data.channels.clone();
        for (ch, samples) in written {
            channels[ch] = samples;
        }
        let peak = channels.iter().flatten().fold(0f32, |p, s| p.max(s.abs()));
        if b.script && trace_on() {
            trace(&format!("buffer {id}: acquired from the script's writes ({count} ch x {length} frames, peak {peak:.3})"));
        }
        *data = Arc::new(ae::BufferData { sample_rate: rate, channels });
    } else if b.script && trace_on() && b.arrays.iter().all(|a| *a == 0) {
        trace(&format!("buffer {id}: acquired silent (the script never took a channel)"));
    }
    Some(data.clone())
}

const BUFFER_METHODS: &[&str] = &["getChannelData", "copyToChannel", "copyFromChannel"];

fn buffer_get(id: u32, name: &str) -> Option<Value> {
    with(|a| {
        let b = a.buffers.get(&id)?;
        Some(match name {
            "sampleRate" => Value::Number(f64::from(b.rate)),
            "length" => Value::Number(b.length as f64),
            "duration" => Value::Number(b.length as f64 / f64::from(b.rate)),
            "numberOfChannels" => Value::Number(b.channels as f64),
            _ => return None,
        })
    })
}

/// A channel's Float32Array: made on first use from the contents (held by the buffer), the same one after.
fn channel_array(id: u32, ch: usize) -> Option<u64> {
    let (existing, samples) = with(|a| {
        let b = a.buffers.get(&id)?;
        let existing = *b.arrays.get(ch)?;
        Some(if existing != 0 {
            (existing, None)
        } else {
            let samples = b.data.as_ref().map_or_else(|| vec![0.0; b.length], |d| d.channels[ch].clone());
            (0, Some(samples))
        })
    })?;
    if existing != 0 {
        return Some(existing);
    }
    let bytes: Vec<u8> = samples.unwrap_or_default().iter().flat_map(|s| s.to_le_bytes()).collect();
    let Value::Object(r) = values::new_bytes(f32_elem(), bytes) else { return None };
    objects::retain(r);
    with(|a| a.buffers.get_mut(&id).map(|b| b.arrays[ch] = r));
    Some(r)
}

fn buffer_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    let Some((channels, length)) = with(|a| a.buffers.get(&id).map(|b| (b.channels, b.length))) else {
        return Err(throw("InvalidStateError", &format!("Failed to execute '{name}' on 'AudioBuffer': a released buffer")));
    };
    let ch = double(args, if name == "getChannelData" { 0 } else { 1 }, f64::NAN, name)?;
    if !(ch >= 0.0 && (ch as usize) < channels) {
        return Err(throw("IndexSizeError", &format!("Failed to execute '{name}' on 'AudioBuffer': channel index ({ch}) exceeds number of channels ({channels})")));
    }
    let ch = ch as usize;
    match name {
        "getChannelData" => channel_array(id, ch).map(Value::Object).ok_or_else(|| "getChannelData: the channel is gone".into()),
        "copyToChannel" => {
            let source = match args.first() {
                Some(Value::Object(r)) => samples_of(*r),
                _ => None,
            }
            .ok_or_else(|| throw("TypeError", "Failed to execute 'copyToChannel' on 'AudioBuffer': parameter 1 is not of type 'Float32Array'."))?;
            let start = double(args, 2, 0.0, name)?.max(0.0) as usize;
            if start >= length {
                return Ok(Value::Undefined);
            }
            let count = source.len().min(length - start);
            let array = with(|a| a.buffers.get(&id).map_or(0, |b| b.arrays[ch]));
            if array != 0 {
                // The script's array is the channel: written element by element, as the script would.
                for (i, s) in source[..count].iter().enumerate() {
                    values::set(array, &(start + i).to_string(), Value::Number(f64::from(*s)))?;
                }
            } else {
                with(|a| {
                    if let Some(b) = a.buffers.get_mut(&id) {
                        let mut channels_now = b.data.as_ref().map_or_else(|| vec![vec![0.0; b.length]; b.channels], |d| d.channels.clone());
                        channels_now[ch][start..start + count].copy_from_slice(&source[..count]);
                        b.data = Some(Arc::new(ae::BufferData { sample_rate: b.rate, channels: channels_now }));
                    }
                });
            }
            Ok(Value::Undefined)
        }
        "copyFromChannel" => {
            let Some(Value::Object(dest)) = args.first() else {
                return Err(throw("TypeError", "Failed to execute 'copyFromChannel' on 'AudioBuffer': parameter 1 is not of type 'Float32Array'."));
            };
            let Some(dest_len) = samples_of(*dest).map(|d| d.len()) else {
                return Err(throw("TypeError", "Failed to execute 'copyFromChannel' on 'AudioBuffer': parameter 1 is not of type 'Float32Array'."));
            };
            let start = double(args, 2, 0.0, name)?.max(0.0) as usize;
            let current = with(|a| acquire(a, id)).map(|d| d.channels[ch].clone()).unwrap_or_default();
            let count = dest_len.min(current.len().saturating_sub(start));
            for i in 0..count {
                values::set(*dest, &i.to_string(), Value::Number(f64::from(current[start + i])))?;
            }
            // A compiled array handed over is written in place too (its storage, held by the host's copy).
            if let Some((at, len)) = values::bytes_storage(*dest) {
                let n = count.min(len / 4);
                // SAFETY: the program's storage behind `dest`, `len` bytes, held while `dest` lives.
                let out = unsafe { std::slice::from_raw_parts_mut(at, n * 4) };
                for (i, chunk) in out.chunks_exact_mut(4).enumerate() {
                    chunk.copy_from_slice(&current[start + i].to_le_bytes());
                }
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

// ── decoding ───────────────────────────────────────────────────────────

/// Decodes `bytes` on the module pool at `rate`; the promise (and the callbacks, decodeAudioData's) settle on this
/// thread with an AudioBuffer, or an EncodingError.
fn decode(bytes: Vec<u8>, rate: f32, success: Option<u64>, failure: Option<u64>) -> Value {
    let (promise, r) = held_promise();
    for c in success.iter().chain(failure.iter()) {
        crate::abi::closure_retain(*c);
    }
    let size = bytes.len();
    crate::modules::submit_then(Box::new(move || -> Box<dyn FnOnce() + Send> {
        let started = Instant::now();
        let decoded = std::panic::catch_unwind(|| audio_decode::decode(&bytes, rate))
            .unwrap_or_else(|_| Err("Unable to decode audio data: the decoder panicked".into()));
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        match &decoded {
            Ok(d) => trace(&format!("decoded {size} bytes: {} ch x {} frames at {} Hz in {ms:.1} ms", d.channels.len(), d.channels.first().map_or(0, Vec::len), d.sample_rate)),
            Err(e) => trace(&format!("decode of {size} bytes failed in {ms:.1} ms: {e}")),
        }
        Box::new(move || settle_decoded(r, decoded, success, failure))
    }));
    promise
}

fn settle_decoded(promise: u64, decoded: Result<audio_decode::Decoded, String>, success: Option<u64>, failure: Option<u64>) {
    let (value, rejected, callback) = match decoded {
        Ok(d) if !d.channels.is_empty() && d.channels[0].len() > 0 => {
            with(|a| a.stats.decoded += 1);
            let (length, count) = (d.channels[0].len(), d.channels.len());
            let data = Arc::new(ae::BufferData { sample_rate: d.sample_rate, channels: d.channels });
            (new_buffer(d.sample_rate, length, count, Some(data), false), false, success)
        }
        Ok(_) => {
            with(|a| a.stats.decode_failures += 1);
            (values::new_error("EncodingError", "Unable to decode audio data: no samples"), true, failure)
        }
        Err(message) => {
            with(|a| a.stats.decode_failures += 1);
            (values::new_error("EncodingError", &message), true, failure)
        }
    };
    if let Some(c) = callback {
        // The callback first, then the promise, as Chrome orders them (a throw there is the program's to report).
        let _ = values::call_value(&Value::Closure(c), None, std::slice::from_ref(&value));
    }
    values::settle(promise, rejected, &value);
    objects::release(promise);
    for c in success.into_iter().chain(failure) {
        crate::abi::closure_release(c);
    }
}

/// A layer's `decodeAudio(context, bytes)`: decodeAudioData on a copy of the bytes, at the context's rate.
pub fn decode_module(context: &Value, bytes: &Value) -> Result<Value, (&'static str, String)> {
    let (_, rate) = context_rate(context).ok_or(("TypeError", "decodeAudio: the context is not an AudioContext".to_string()))?;
    // A copy now: the compiled storage the view reads may change before the decode runs.
    let bytes = match bytes {
        Value::Object(r) => values::bytes_of(*r).map(|(_, b)| b),
        _ => None,
    }
    .ok_or(("TypeError", "decodeAudio: the bytes are not a Uint8Array".to_string()))?;
    Ok(decode(bytes, rate, None, None))
}

// ── nodes ──────────────────────────────────────────────────────────────

fn node_methods(kind: NodeType) -> &'static [&'static str] {
    match kind {
        NodeType::BufferSource | NodeType::Oscillator => &["connect", "disconnect", "addEventListener", "removeEventListener", "start", "stop"],
        NodeType::Panner => &["connect", "disconnect", "addEventListener", "removeEventListener", "setPosition", "setOrientation"],
        NodeType::Listener => &["setPosition", "setOrientation"],
        _ => &["connect", "disconnect", "addEventListener", "removeEventListener"],
    }
}

const PARAM_METHODS: &[&str] = &[
    "setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "setValueCurveAtTime",
    "cancelScheduledValues", "cancelAndHoldAtTime",
];

/// A param's object (made on first read, held by its node).
fn param_object(key: u32, slot: usize) -> Option<Value> {
    let existing = with(|a| a.nodes.get(&key).and_then(|n| n.params.get(slot)).map(|s| s.obj))?;
    if existing != 0 {
        return Some(Value::Object(existing));
    }
    let r = held_object(Handle::Param(key, slot as u8));
    with(|a| a.nodes.get_mut(&key).map(|n| n.params[slot].obj = r));
    Some(Value::Object(r))
}

fn node_get(key: u32, name: &str) -> Option<Value> {
    if let Some(slot) = with(|a| a.nodes.get(&key).and_then(|n| n.params.iter().position(|s| s.name == name))) {
        return param_object(key, slot);
    }
    with(|a| {
        let n = a.nodes.get(&key)?;
        let (inputs, outputs) = n.kind.ports();
        let source = n.kind.source();
        Some(match name {
            "context" => a.contexts.get(&n.ctx).map_or(Value::Null, |c| Value::Object(c.obj)),
            "numberOfInputs" if n.kind != NodeType::Listener => Value::Number(f64::from(inputs)),
            "numberOfOutputs" if n.kind != NodeType::Listener => Value::Number(f64::from(outputs)),
            "channelCount" if n.kind != NodeType::Listener => Value::Number(n.channel_count),
            "channelCountMode" if n.kind != NodeType::Listener => Value::Str(n.channel_count_mode.clone()),
            "channelInterpretation" if n.kind != NodeType::Listener => Value::Str(n.channel_interpretation.clone()),
            "maxChannelCount" if n.kind == NodeType::Destination => Value::Number(2.0),
            "onended" if source => n.listeners.on.map_or(Value::Null, Value::Closure),
            "type" if matches!(n.kind, NodeType::Biquad | NodeType::Oscillator) => Value::Str(n.type_name.into()),
            "buffer" if matches!(n.kind, NodeType::BufferSource | NodeType::Convolver) => n.buffer.map_or(Value::Null, |(o, _)| Value::Object(o)),
            "loop" if n.kind == NodeType::BufferSource => Value::Bool(n.looping),
            "loopStart" if n.kind == NodeType::BufferSource => Value::Number(n.loop_start),
            "loopEnd" if n.kind == NodeType::BufferSource => Value::Number(n.loop_end),
            "normalize" if n.kind == NodeType::Convolver => Value::Bool(n.normalize),
            "reduction" if n.kind == NodeType::Compressor => Value::Number(0.0),
            "panningModel" if n.kind == NodeType::Panner => Value::Str(n.panning_model.into()),
            "distanceModel" if n.kind == NodeType::Panner => Value::Str(n.distance_model.into()),
            "refDistance" if n.kind == NodeType::Panner => Value::Number(n.ref_distance),
            "maxDistance" if n.kind == NodeType::Panner => Value::Number(n.max_distance),
            "rolloffFactor" if n.kind == NodeType::Panner => Value::Number(n.rolloff),
            "coneInnerAngle" if n.kind == NodeType::Panner => Value::Number(n.cone_inner),
            "coneOuterAngle" if n.kind == NodeType::Panner => Value::Number(n.cone_outer),
            "coneOuterGain" if n.kind == NodeType::Panner => Value::Number(n.cone_outer_gain),
            _ => return None,
        })
    })
}

fn node_set(key: u32, name: &str, value: &Value) -> Result<(), String> {
    let Some((kind, engine, id, ctx_rate)) = with(|a| {
        let n = a.nodes.get(&key)?;
        Some((n.kind, n.engine.clone(), n.id, a.contexts.get(&n.ctx).map_or(0.0, |c| c.rate)))
    }) else {
        return Ok(());
    };
    let interface = kind.interface();
    let mut later = Later::default();
    let result = (|| -> Result<(), String> {
        match name {
            "onended" if kind.source() => with(|a| {
                if let Some(n) = a.nodes.get_mut(&key) {
                    set_on(&mut n.listeners, value, &mut later);
                }
            }),
            "type" if kind == NodeType::Biquad => {
                use ae::BiquadType as B;
                let t = objects::to_display(value);
                let (name, ty) = match t.as_str() {
                    "lowpass" => ("lowpass", B::Lowpass),
                    "highpass" => ("highpass", B::Highpass),
                    "bandpass" => ("bandpass", B::Bandpass),
                    "lowshelf" => ("lowshelf", B::Lowshelf),
                    "highshelf" => ("highshelf", B::Highshelf),
                    "peaking" => ("peaking", B::Peaking),
                    "notch" => ("notch", B::Notch),
                    "allpass" => ("allpass", B::Allpass),
                    // An enum attribute set to a value outside the enum is ignored (WebIDL).
                    _ => return Ok(()),
                };
                engine.set(id, ae::Attr::BiquadType(ty));
                with(|a| a.nodes.get_mut(&key).map(|n| n.type_name = name));
            }
            "type" if kind == NodeType::Oscillator => {
                use ae::OscillatorType as O;
                let t = objects::to_display(value);
                let (name, ty) = match t.as_str() {
                    "sine" => ("sine", O::Sine),
                    "square" => ("square", O::Square),
                    "sawtooth" => ("sawtooth", O::Sawtooth),
                    "triangle" => ("triangle", O::Triangle),
                    "custom" => return Err(throw("InvalidStateError", "Failed to set the 'type' property on 'OscillatorNode': 'type' cannot be set directly to 'custom'.  Use setPeriodicWave() to create a custom Oscillator type.")),
                    _ => return Ok(()),
                };
                engine.set(id, ae::Attr::OscillatorType(ty));
                with(|a| a.nodes.get_mut(&key).map(|n| n.type_name = name));
            }
            "buffer" if matches!(kind, NodeType::BufferSource | NodeType::Convolver) => {
                let new = match value {
                    Value::Undefined | Value::Null => None,
                    Value::Object(r) => match objects::audio_of(*r) {
                        Some(Handle::Buffer(b)) => Some((*r, b)),
                        _ => None,
                    }
                    .map(Some)
                    .ok_or_else(|| throw("TypeError", &format!("Failed to set the 'buffer' property on '{interface}': The provided value is not of type 'AudioBuffer'.")))?,
                    _ => return Err(throw("TypeError", &format!("Failed to set the 'buffer' property on '{interface}': The provided value is not of type 'AudioBuffer'."))),
                };
                let had = with(|a| a.nodes.get(&key).and_then(|n| n.buffer).is_some());
                if kind == NodeType::BufferSource && had && new.is_some() {
                    return Err(throw("InvalidStateError", "Failed to set the 'buffer' property on 'AudioBufferSourceNode': Cannot set buffer to non-null after it has been already been set to a non-null buffer"));
                }
                let data = match new {
                    Some((_, b)) => {
                        let (channels, rate) = with(|a| a.buffers.get(&b).map_or((0, 0.0), |b| (b.channels, b.rate)));
                        if kind == NodeType::Convolver {
                            if !matches!(channels, 1 | 2 | 4) {
                                return Err(throw("NotSupportedError", &format!("Failed to set the 'buffer' property on 'ConvolverNode': The buffer must have 1, 2, or 4 channels, not {channels}")));
                            }
                            if rate != ctx_rate {
                                return Err(throw("NotSupportedError", &format!("Failed to set the 'buffer' property on 'ConvolverNode': The buffer sample rate {rate} does not match the context rate {ctx_rate}")));
                            }
                        }
                        with(|a| acquire(a, b))
                    }
                    None => None,
                };
                if let Some((r, _)) = new {
                    objects::retain(r);
                }
                with(|a| {
                    if let Some(n) = a.nodes.get_mut(&key) {
                        later.objects.extend(std::mem::replace(&mut n.buffer, new).map(|(o, _)| o));
                    }
                });
                engine.set(id, ae::Attr::Buffer(data));
            }
            "loop" if kind == NodeType::BufferSource => {
                let on = truthy(value);
                engine.set(id, ae::Attr::Loop(on));
                with(|a| a.nodes.get_mut(&key).map(|n| n.looping = on));
            }
            "loopStart" | "loopEnd" if kind == NodeType::BufferSource => {
                let v = double_value(value, name)?;
                engine.set(id, if name == "loopStart" { ae::Attr::LoopStart(v) } else { ae::Attr::LoopEnd(v) });
                with(|a| a.nodes.get_mut(&key).map(|n| if name == "loopStart" { n.loop_start = v } else { n.loop_end = v }));
            }
            "normalize" if kind == NodeType::Convolver => {
                let on = truthy(value);
                engine.set(id, ae::Attr::Normalize(on));
                with(|a| a.nodes.get_mut(&key).map(|n| n.normalize = on));
            }
            "panningModel" if kind == NodeType::Panner => {
                // Rendered equal-power either way (the engine's one model).
                let model = match objects::to_display(value).as_str() {
                    "equalpower" => "equalpower",
                    "HRTF" => "HRTF",
                    _ => return Ok(()),
                };
                with(|a| a.nodes.get_mut(&key).map(|n| n.panning_model = model));
            }
            "distanceModel" if kind == NodeType::Panner => {
                let (model, dm) = match objects::to_display(value).as_str() {
                    "linear" => ("linear", ae::DistanceModel::Linear),
                    "inverse" => ("inverse", ae::DistanceModel::Inverse),
                    "exponential" => ("exponential", ae::DistanceModel::Exponential),
                    _ => return Ok(()),
                };
                engine.set(id, ae::Attr::DistanceModel(dm));
                with(|a| a.nodes.get_mut(&key).map(|n| n.distance_model = model));
            }
            "refDistance" | "maxDistance" | "rolloffFactor" | "coneInnerAngle" | "coneOuterAngle" | "coneOuterGain" if kind == NodeType::Panner => {
                let v = double_value(value, name)?;
                let bad = match name {
                    "refDistance" | "rolloffFactor" => v < 0.0,
                    "maxDistance" => v <= 0.0,
                    "coneOuterGain" => !(0.0..=1.0).contains(&v),
                    _ => false,
                };
                if bad {
                    let error = if name == "coneOuterGain" { "InvalidStateError" } else { "RangeError" };
                    return Err(throw(error, &format!("Failed to set the '{name}' property on 'PannerNode': The {name} provided ({v}) is outside the allowed range.")));
                }
                let attr = match name {
                    "refDistance" => ae::Attr::RefDistance(v),
                    "maxDistance" => ae::Attr::MaxDistance(v),
                    "rolloffFactor" => ae::Attr::RolloffFactor(v),
                    "coneInnerAngle" => ae::Attr::ConeInnerAngle(v),
                    "coneOuterAngle" => ae::Attr::ConeOuterAngle(v),
                    _ => ae::Attr::ConeOuterGain(v),
                };
                engine.set(id, attr);
                with(|a| {
                    if let Some(n) = a.nodes.get_mut(&key) {
                        *match name {
                            "refDistance" => &mut n.ref_distance,
                            "maxDistance" => &mut n.max_distance,
                            "rolloffFactor" => &mut n.rolloff,
                            "coneInnerAngle" => &mut n.cone_inner,
                            "coneOuterAngle" => &mut n.cone_outer,
                            _ => &mut n.cone_outer_gain,
                        } = v;
                    }
                });
            }
            // Kept for reading back; the engine mixes each node as its kind's default.
            "channelCount" if kind != NodeType::Listener => {
                let v = double_value(value, name)?;
                with(|a| a.nodes.get_mut(&key).map(|n| n.channel_count = v));
            }
            "channelCountMode" | "channelInterpretation" if kind != NodeType::Listener => {
                let v = objects::to_display(value);
                with(|a| a.nodes.get_mut(&key).map(|n| if name == "channelCountMode" { n.channel_count_mode = v } else { n.channel_interpretation = v }));
            }
            _ => {
                let is_param = with(|a| a.nodes.get(&key).is_some_and(|n| n.params.iter().any(|s| s.name == name)));
                return Err(throw("TypeError", &if is_param {
                    format!("Cannot assign to read only property '{name}' of object '#<{interface}>'")
                } else {
                    format!("cannot set '{name}' on {interface}")
                }));
            }
        }
        Ok(())
    })();
    later.run();
    result
}

/// The node or param `v` names: its node's key, and the param's slot when it is one.
fn target_of(v: &Value) -> Option<(u32, Option<usize>)> {
    let Value::Object(r) = v else { return None };
    match objects::audio_of(*r)? {
        Handle::Node(k) => Some((k, None)),
        Handle::Param(k, s) => Some((k, Some(usize::from(s)))),
        _ => None,
    }
}

fn node_call(obj: u64, key: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    let Some((kind, engine, id, ctx)) = with(|a| a.nodes.get(&key).map(|n| (n.kind, n.engine.clone(), n.id, n.ctx))) else {
        return Ok(Value::Undefined);
    };
    let interface = kind.interface();
    match name {
        "connect" => {
            let dest = args.first().cloned().unwrap_or(Value::Undefined);
            let Some((to, param)) = target_of(&dest) else {
                return Err(throw("TypeError", &format!("Failed to execute 'connect' on '{interface}': parameter 1 is not of type 'AudioNode' or 'AudioParam'.")));
            };
            let Some((to_ctx, to_id, to_kind, to_param)) =
                with(|a| a.nodes.get(&to).map(|n| (n.ctx, n.id, n.kind, param.and_then(|s| n.params.get(s)).map(|s| s.param))))
            else {
                return Err(throw("InvalidAccessError", &format!("Failed to execute 'connect' on '{interface}': a released destination")));
            };
            if to_ctx != ctx {
                return Err(throw("InvalidAccessError", &format!("Failed to execute 'connect' on '{interface}': cannot connect to an AudioNode belonging to a different audio context.")));
            }
            let output = double(args, 1, 0.0, "connect")?;
            if !(output >= 0.0 && output < f64::from(kind.ports().1)) {
                return Err(throw("IndexSizeError", &format!("Failed to execute 'connect' on '{interface}': output index ({output}) exceeds number of outputs ({}).", kind.ports().1)));
            }
            match to_param {
                Some(p) => {
                    engine.connect_param(id, output as u32, to_id, p);
                    Ok(Value::Undefined)
                }
                None => {
                    let input = double(args, 2, 0.0, "connect")?;
                    if !(input >= 0.0 && input < f64::from(to_kind.ports().0)) {
                        return Err(throw("IndexSizeError", &format!("Failed to execute 'connect' on '{interface}': input index ({input}) exceeds number of inputs ({}).", to_kind.ports().0)));
                    }
                    engine.connect(id, output as u32, to_id, input as u32);
                    Ok(dest)
                }
            }
        }
        "disconnect" => {
            // disconnect(), disconnect(output): everything; disconnect(node | param, ...): the connections to that node.
            let to = match args.first() {
                None | Some(Value::Undefined | Value::Number(_)) => None,
                Some(v) => {
                    let (k, _) = target_of(v)
                        .ok_or_else(|| throw("TypeError", &format!("Failed to execute 'disconnect' on '{interface}': parameter 1 is not of type 'AudioNode' or 'AudioParam'.")))?;
                    match with(|a| a.nodes.get(&k).map(|n| n.id)) {
                        Some(to) => Some(to),
                        // A released node: nothing of this one's reaches it any more.
                        None => return Ok(Value::Undefined),
                    }
                }
            };
            engine.disconnect(id, to);
            Ok(Value::Undefined)
        }
        "start" if kind.source() => {
            let when = double(args, 0, 0.0, "start")?;
            let offset = double(args, 1, 0.0, "start")?;
            let duration = match args.get(2) {
                None | Some(Value::Undefined) => None,
                Some(_) => Some(double(args, 2, 0.0, "start")?),
            };
            if when < 0.0 || offset < 0.0 || duration.is_some_and(|d| d < 0.0) {
                return Err(throw("RangeError", &format!("Failed to execute 'start' on '{interface}': The start time, offset and duration must be non-negative.")));
            }
            let already = with(|a| a.nodes.get_mut(&key).map(|n| std::mem::replace(&mut n.started, true))).unwrap_or(true);
            if already {
                return Err(throw("InvalidStateError", &format!("Failed to execute 'start' on '{interface}': cannot call start more than once.")));
            }
            // Playing, the node keeps its own object (and so its `ended` listeners) alive until it ends.
            let hold = with(|a| {
                let closed = a.contexts.get(&ctx).is_none_or(|c| c.state == "closed");
                a.nodes.get_mut(&key).is_some_and(|n| !closed && !std::mem::replace(&mut n.held, true))
            });
            if hold {
                objects::retain(obj);
            }
            if kind == NodeType::BufferSource {
                engine.start(id, when, offset, duration);
            } else {
                engine.start(id, when, 0.0, None);
            }
            Ok(Value::Undefined)
        }
        "stop" if kind.source() => {
            let when = double(args, 0, 0.0, "stop")?;
            if when < 0.0 {
                return Err(throw("RangeError", &format!("Failed to execute 'stop' on '{interface}': The stop time must be non-negative.")));
            }
            if !with(|a| a.nodes.get(&key).is_some_and(|n| n.started)) {
                return Err(throw("InvalidStateError", &format!("Failed to execute 'stop' on '{interface}': cannot call stop without calling start first.")));
            }
            engine.stop(id, when);
            Ok(Value::Undefined)
        }
        "setPosition" | "setOrientation" if matches!(kind, NodeType::Panner | NodeType::Listener) => {
            let names: &[&str] = match (name, kind) {
                ("setPosition", _) => &["positionX", "positionY", "positionZ"],
                (_, NodeType::Panner) => &["orientationX", "orientationY", "orientationZ"],
                _ => &["forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"],
            };
            let mut numbers = Vec::with_capacity(names.len());
            for i in 0..names.len() {
                numbers.push(double(args, i, f64::NAN, name)?);
            }
            if numbers.iter().any(|n| n.is_nan()) {
                return Err(throw("TypeError", &format!("Failed to execute '{name}' on '{interface}': {} arguments required.", names.len())));
            }
            for (p, v) in names.iter().zip(numbers) {
                if let Some(slot) = with(|a| a.nodes.get(&key).and_then(|n| n.params.iter().position(|s| s.name == *p))) {
                    param_event(key, slot, ae::ParamEvent::Value(float(v, name)?));
                }
            }
            Ok(Value::Undefined)
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1)) {
                let kind = objects::to_display(kind);
                let mut later = Later::default();
                with(|a| {
                    if let Some(n) = a.nodes.get_mut(&key) {
                        listen(&mut n.listeners, name == "addEventListener", &kind, *c, &mut later);
                    }
                });
                later.run();
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

// ── params ─────────────────────────────────────────────────────────────

/// One event for a param: sent to the engine, applied to the mirror.
fn param_event(key: u32, slot: usize, event: ae::ParamEvent) {
    with(|a| {
        let Some(n) = a.nodes.get_mut(&key) else { return };
        let now = n.engine.current_time();
        let Some(s) = n.params.get_mut(slot) else { return };
        s.line.apply(&event, now);
        n.engine.param(n.id, s.param, event);
    });
}

fn param_get(key: u32, slot: usize, name: &str) -> Option<Value> {
    with(|a| {
        let n = a.nodes.get_mut(&key)?;
        let now = n.engine.current_time();
        let s = n.params.get_mut(slot)?;
        Some(match name {
            "value" => Value::Number(s.line.read(now)),
            "defaultValue" => Value::Number(f64::from(s.line.default)),
            "minValue" => Value::Number(f64::from(s.line.min)),
            "maxValue" => Value::Number(f64::from(s.line.max)),
            "automationRate" => Value::Str(if s.k_rate { "k-rate" } else { "a-rate" }.into()),
            _ => return None,
        })
    })
}

fn param_set(key: u32, slot: usize, name: &str, value: &Value) -> Result<(), String> {
    match name {
        "value" => {
            let v = float(double_value(value, "value")?, "value")?;
            param_event(key, slot, ae::ParamEvent::Value(v));
            Ok(())
        }
        // Kept as it is (the engine renders each param at its spec rate).
        "automationRate" => Ok(()),
        _ => Err(throw("TypeError", &format!("cannot set '{name}' on AudioParam"))),
    }
}

/// A curve's values: a Float32Array or an array of numbers.
fn curve_values(v: &Value) -> Option<Vec<f32>> {
    let Value::Object(r) = v else { return None };
    if let Some(samples) = samples_of(*r) {
        return Some(samples);
    }
    if !values::is_array(*r) {
        return None;
    }
    let len = match objects::get(*r, "length") {
        Ok(Value::Number(n)) => n as usize,
        _ => 0,
    };
    (0..len)
        .map(|i| match objects::get(*r, &i.to_string()) {
            Ok(Value::Number(n)) if n.is_finite() && (n as f32).is_finite() => Some(n as f32),
            _ => None,
        })
        .collect()
}

fn param_call(obj: u64, key: u32, slot: usize, name: &str, args: &[Value]) -> Result<Value, String> {
    let what = |m: &str| format!("Failed to execute '{name}' on 'AudioParam': {m}");
    let time = |i: usize| -> Result<f64, String> {
        let t = double(args, i, f64::NAN, name)?;
        if t.is_nan() {
            return Err(throw("TypeError", &what("2 arguments required.")));
        }
        if t < 0.0 {
            return Err(throw("RangeError", &what(&format!("The time provided ({t}) is less than the minimum bound (0)."))));
        }
        Ok(t)
    };
    let value = |i: usize| -> Result<f32, String> {
        let v = double(args, i, f64::NAN, name)?;
        if v.is_nan() { Err(throw("TypeError", &what("a value is required."))) } else { float(v, name) }
    };
    let event = match name {
        "setValueAtTime" => ae::ParamEvent::SetValueAtTime { value: value(0)?, time: time(1)? },
        "linearRampToValueAtTime" => ae::ParamEvent::LinearRampToValueAtTime { value: value(0)?, time: time(1)? },
        "exponentialRampToValueAtTime" => {
            let v = value(0)?;
            if v == 0.0 {
                return Err(throw("RangeError", &what("The float target value provided (0) should not be in the range (-1.40130e-45, 1.40130e-45).")));
            }
            ae::ParamEvent::ExponentialRampToValueAtTime { value: v, time: time(1)? }
        }
        "setTargetAtTime" => {
            let target = value(0)?;
            let at = time(1)?;
            let constant = double(args, 2, f64::NAN, name)?;
            if !(constant >= 0.0) {
                return Err(throw("RangeError", &what(&format!("The time constant provided ({constant}) is less than the minimum bound (0)."))));
            }
            ae::ParamEvent::SetTargetAtTime { target, time: at, time_constant: constant }
        }
        "setValueCurveAtTime" => {
            let values = args.first().and_then(curve_values).ok_or_else(|| throw("TypeError", &what("parameter 1 is not of type 'Float32Array'.")))?;
            if values.len() < 2 {
                return Err(throw("InvalidStateError", &what(&format!("The curve length provided ({}) is less than the minimum bound (2).", values.len()))));
            }
            let at = time(1)?;
            let duration = double(args, 2, f64::NAN, name)?;
            if !(duration > 0.0) {
                return Err(throw("RangeError", &what(&format!("The duration provided ({duration}) is less than or equal to the minimum bound (0)."))));
            }
            ae::ParamEvent::SetValueCurveAtTime { values, time: at, duration }
        }
        "cancelScheduledValues" => ae::ParamEvent::CancelScheduledValues { time: time(0)? },
        "cancelAndHoldAtTime" => ae::ParamEvent::CancelAndHoldAtTime { time: time(0)? },
        _ => return Err(format!("{name} is not a function")),
    };
    param_event(key, slot, event);
    Ok(Value::Object(obj))
}

// ── media elements ─────────────────────────────────────────────────────

/// What an element's source has come to.
enum Load {
    Empty,
    Loading,
    Ready(Arc<ae::BufferData>),
    Failed(String),
}

/// The source playing now: from `offset` seconds into the clip, begun at engine time `started_at`.
struct Playing {
    source: ae::NodeId,
    started_at: f64,
    offset: f64,
}

/// An `Audio` element (HTMLAudioElement, no document node): its source fetched whole and decoded, played by a buffer
/// source into a gain (its volume) on the shared engine's destination, beside every AudioContext's graph and outside
/// it, as a browser's media element is.
struct Media {
    /// The program's object (not counted here, but while it plays: see `held`).
    obj: u64,
    src: String,
    cross_origin: Option<String>,
    looping: bool,
    preload: String,
    volume: f64,
    muted: bool,
    paused: bool,
    /// Where playback stands while nothing plays (seconds into the clip).
    position: f64,
    load: Load,
    /// Bumped by each load, so a fetch or decode that a later `src` overtook is dropped.
    generation: u32,
    /// The engine and the element's gain on it, once it first loads.
    engine: Option<Rc<ae::Engine>>,
    gain: ae::NodeId,
    playing: Option<Playing>,
    /// play() promises waiting on the load (held).
    waiting: Vec<u64>,
    /// The element holds its own object while it is not paused (a playing element is never collected).
    held: bool,
    ons: Vec<(&'static str, u64)>,
    listeners: Listeners,
}

const MEDIA_EVENTS: &[&str] = &["play", "playing", "pause", "ended", "error", "loadeddata", "canplay", "canplaythrough", "volumechange", "seeked"];
const MEDIA_METHODS: &[&str] = &["play", "pause", "load", "canPlayType", "addEventListener", "removeEventListener"];

impl Media {
    fn handlers(&self, kind: &str) -> Vec<u64> {
        let on = self.ons.iter().filter(|(k, _)| *k == kind).map(|(_, c)| *c);
        on.chain(self.listeners.added.iter().filter(|(k, _)| k == kind).map(|(_, c)| *c)).collect()
    }

    fn duration(&self) -> Option<f64> {
        match &self.load {
            Load::Ready(d) => Some(d.frames() as f64 / f64::from(d.sample_rate)),
            _ => None,
        }
    }

    fn level(&self) -> f32 {
        if self.muted { 0.0 } else { self.volume as f32 }
    }

    /// The playback position now.
    fn position_now(&self) -> f64 {
        let (Some(p), Some(e)) = (&self.playing, &self.engine) else { return self.position };
        let t = p.offset + (e.current_time() - p.started_at).max(0.0);
        match self.duration() {
            Some(d) if d > 0.0 && self.looping => t % d,
            Some(d) => t.min(d),
            None => t,
        }
    }
}

/// `new Audio(src?)`.
pub fn construct_media(args: &[Value]) -> Result<Value, String> {
    if !available() {
        return Err(throw("NotSupportedError", "Failed to construct 'Audio': this host has no audio."));
    }
    let id = with(|a| {
        let id = a.key();
        a.media.insert(id, Media {
            obj: 0,
            src: String::new(),
            cross_origin: None,
            looping: false,
            // `new Audio()` sets preload "auto", as the spec's constructor does.
            preload: "auto".into(),
            volume: 1.0,
            muted: false,
            paused: true,
            position: 0.0,
            load: Load::Empty,
            generation: 0,
            engine: None,
            gain: 0,
            playing: None,
            waiting: Vec::new(),
            held: false,
            ons: Vec::new(),
            listeners: Listeners::default(),
        });
        id
    });
    let v = objects::new_audio(Handle::Media(id));
    if let Value::Object(r) = v {
        with(|a| a.media.get_mut(&id).map(|m| m.obj = r));
    }
    match args.first() {
        None | Some(Value::Undefined) => {}
        Some(src) => set_src(id, &objects::to_display(src)),
    }
    Ok(v)
}

/// The element's engine and gain, made on first use.
fn media_engine(id: u32) -> Result<(Rc<ae::Engine>, ae::NodeId), String> {
    if let Some(found) = with(|a| a.media.get(&id).and_then(|m| m.engine.clone().map(|e| (e, m.gain)))) {
        return Ok(found);
    }
    let engine = shared_engine()?;
    let gain = engine.create(ae::NodeKind::Gain);
    engine.connect(gain, 0, ae::DESTINATION, 0);
    let level = with(|a| a.media.get(&id).map_or(1.0, Media::level));
    engine.param(gain, ae::Param::Gain, ae::ParamEvent::Value(level));
    with(|a| {
        if let Some(m) = a.media.get_mut(&id) {
            m.engine = Some(engine.clone());
            m.gain = gain;
        }
    });
    Ok((engine, gain))
}

/// Not paused any more (the element holds itself) or paused again (it lets go).
fn set_paused(m: &mut Media, paused: bool, later: &mut Later) {
    m.paused = paused;
    if !paused && !m.held {
        objects::retain(m.obj);
        m.held = true;
    } else if paused && std::mem::take(&mut m.held) {
        later.objects.push(m.obj);
    }
}

/// The playing source stopped where it is (its position kept).
fn stop_source(a: &mut Audio, id: u32) {
    let Some(m) = a.media.get_mut(&id) else { return };
    let position = m.position_now();
    let (Some(p), Some(e)) = (m.playing.take(), m.engine.clone()) else { return };
    m.position = position;
    e.stop(p.source, 0.0);
    e.release(p.source);
    a.by_engine.remove(&(engine_key(&e), p.source));
}

/// A source for the clip from the element's position, now.
fn start_source(a: &mut Audio, id: u32) {
    let Some(m) = a.media.get_mut(&id) else { return };
    let (Load::Ready(data), Some(e)) = (&m.load, m.engine.clone()) else { return };
    if m.playing.is_some() {
        return;
    }
    let duration = data.frames() as f64 / f64::from(data.sample_rate);
    // Played to its end, it starts over (as play() on an ended element does).
    let offset = if m.position >= duration { 0.0 } else { m.position.max(0.0) };
    let source = e.create(ae::NodeKind::BufferSource);
    e.set(source, ae::Attr::Buffer(Some(data.clone())));
    e.set(source, ae::Attr::Loop(m.looping));
    e.connect(source, 0, m.gain, 0);
    e.start(source, 0.0, offset, None);
    m.playing = Some(Playing { source, started_at: e.current_time(), offset });
    a.by_engine.insert((engine_key(&e), source), Target::Media(id));
}

/// Play promises settled (rejected with `error` when given).
fn settle_waiting(a: &mut Audio, id: u32, error: Option<(&'static str, &str)>) {
    let Some(m) = a.media.get_mut(&id) else { return };
    for promise in m.waiting.drain(..) {
        a.tasks.push_back(Task::Settle { promise, rejected: error.map(|(n, msg)| (n, msg.to_string())) });
    }
}

/// The load algorithm: what was playing stops, the source is forgotten, a waiting play() rejects with an AbortError.
fn reset(id: u32, later: &mut Later) {
    with(|a| {
        stop_source(a, id);
        settle_waiting(a, id, Some(("AbortError", "The play() request was interrupted by a new load request.")));
        let Some(m) = a.media.get_mut(&id) else { return };
        m.generation += 1;
        m.load = Load::Empty;
        m.position = 0.0;
        if !m.paused {
            set_paused(m, true, later);
            a.tasks.push_back(Task::MediaEvent { id, kind: "pause" });
        }
    });
}

fn set_src(id: u32, raw: &str) {
    // The URL as the getter answers it: resolved against the page (a blob: URL as it is).
    let src = if raw.is_empty() || raw.starts_with("blob:") {
        raw.to_string()
    } else {
        crate::modules::page().join(raw).map_or_else(|_| raw.to_string(), |u| u.to_string())
    };
    let mut later = Later::default();
    reset(id, &mut later);
    let preload = with(|a| {
        a.media.get_mut(&id).map(|m| {
            m.src = src;
            m.preload != "none"
        })
    });
    later.run();
    if preload == Some(true) {
        begin_load(id);
    }
}

/// Fetches the source (the network threads), then decodes it (the pool) at the engine's rate.
fn begin_load(id: u32) {
    let pending = with(|a| a.media.get(&id).filter(|m| matches!(m.load, Load::Empty) && !m.src.is_empty()).map(|m| (m.src.clone(), m.generation)));
    let Some((src, generation)) = pending else { return };
    let rate = match media_engine(id) {
        Ok((e, _)) => e.sample_rate(),
        Err(e) => return media_failed(id, generation, format!("no audio output ({e})")),
    };
    with(|a| a.media.get_mut(&id).map(|m| m.load = Load::Loading));
    trace(&format!("media {id}: loading {}", crate::net::redact(&src)));
    let started = Instant::now();
    crate::modules::load_media(
        src,
        Box::new(move |bytes| -> Box<dyn FnOnce() + Send> {
            let fetched_ms = started.elapsed().as_secs_f64() * 1000.0;
            Box::new(move || match bytes {
                Err(e) => media_failed(id, generation, e),
                Ok(bytes) => {
                    if !with(|a| a.media.get(&id).is_some_and(|m| m.generation == generation)) {
                        return;
                    }
                    let size = bytes.len();
                    crate::modules::submit_then(Box::new(move || -> Box<dyn FnOnce() + Send> {
                        let started = Instant::now();
                        let decoded = std::panic::catch_unwind(|| audio_decode::decode(&bytes, rate))
                            .unwrap_or_else(|_| Err("Unable to decode audio data: the decoder panicked".into()));
                        let decode_ms = started.elapsed().as_secs_f64() * 1000.0;
                        trace(&format!("media {id}: {size} bytes fetched in {fetched_ms:.0} ms, decoded in {decode_ms:.0} ms"));
                        Box::new(move || media_decoded(id, generation, decoded))
                    }));
                }
            })
        }),
    );
}

/// The source could not be fetched or decoded: an `error`, and play() rejects as Chrome's does for a source it
/// cannot play.
fn media_failed(id: u32, generation: u32, message: String) {
    trace(&format!("media {id}: failed: {}", crate::net::redact(&message)));
    let mut later = Later::default();
    with(|a| {
        if !a.media.get(&id).is_some_and(|m| m.generation == generation) {
            return;
        }
        settle_waiting(a, id, Some(("NotSupportedError", "Failed to load because no supported source was found.")));
        let Some(m) = a.media.get_mut(&id) else { return };
        m.load = Load::Failed(message);
        let was_playing = !m.paused;
        if was_playing {
            set_paused(m, true, &mut later);
        }
        a.tasks.push_back(Task::MediaEvent { id, kind: "error" });
        if was_playing {
            a.tasks.push_back(Task::MediaEvent { id, kind: "pause" });
        }
    });
    later.run();
}

fn media_decoded(id: u32, generation: u32, decoded: Result<audio_decode::Decoded, String>) {
    let d = match decoded {
        Ok(d) if d.channels.first().is_some_and(|c| !c.is_empty()) => d,
        Ok(_) => return media_failed(id, generation, "Unable to decode audio data: no samples".into()),
        Err(e) => return media_failed(id, generation, e),
    };
    with(|a| {
        let Some(m) = a.media.get_mut(&id).filter(|m| m.generation == generation) else { return };
        trace(&format!("media {id}: ready, {} ch x {} frames at {} Hz", d.channels.len(), d.channels[0].len(), d.sample_rate));
        m.load = Load::Ready(Arc::new(ae::BufferData { sample_rate: d.sample_rate, channels: d.channels }));
        let paused = m.paused;
        for kind in ["loadeddata", "canplay", "canplaythrough"] {
            a.tasks.push_back(Task::MediaEvent { id, kind });
        }
        if !paused {
            start_source(a, id);
            a.tasks.push_back(Task::MediaEvent { id, kind: "playing" });
            settle_waiting(a, id, None);
        }
    });
}

/// The engine says the element's source ended: a clip that does not loop has played out (paused, then `ended`, as the
/// spec orders them).
fn media_ended(id: u32, source: ae::NodeId) -> bool {
    let mut later = Later::default();
    let ended = with(|a| {
        let m = a.media.get_mut(&id)?;
        if m.playing.as_ref().is_none_or(|p| p.source != source) {
            return None;
        }
        let p = m.playing.take()?;
        let e = m.engine.clone()?;
        m.position = m.duration().unwrap_or(0.0);
        set_paused(m, true, &mut later);
        let out = (m.obj, m.handlers("pause"), m.handlers("ended"));
        e.release(p.source);
        a.by_engine.remove(&(engine_key(&e), p.source));
        Some(out)
    });
    let Some((obj, pause, ended)) = ended else {
        later.run();
        return false;
    };
    trace(&format!("media {id}: ended"));
    let threw = fire(obj, pause, "pause") || fire(obj, ended, "ended");
    // The element's own hold goes after its events (their target is the element).
    later.run();
    threw
}

fn media_get(id: u32, name: &str) -> Option<Value> {
    let failed = with(|a| a.media.get(&id).and_then(|m| match &m.load {
        Load::Failed(message) => Some(message.clone()),
        _ => None,
    }));
    if name == "error" {
        // A MediaError: MEDIA_ERR_SRC_NOT_SUPPORTED, with the reason.
        return Some(match failed {
            Some(message) => {
                let e = values::new_object();
                if let Value::Object(r) = e {
                    let _ = values::set(r, "code", Value::Number(4.0));
                    let _ = values::set(r, "message", Value::Str(crate::net::redact(&message)));
                }
                e
            }
            None => Value::Null,
        });
    }
    with(|a| {
        let m = a.media.get(&id)?;
        let ready = matches!(m.load, Load::Ready(_));
        Some(match name {
            "src" => Value::Str(m.src.clone()),
            "currentSrc" => Value::Str(if ready { m.src.clone() } else { String::new() }),
            "crossOrigin" => m.cross_origin.clone().map_or(Value::Null, Value::Str),
            "loop" => Value::Bool(m.looping),
            "preload" => Value::Str(m.preload.clone()),
            "volume" => Value::Number(m.volume),
            "muted" => Value::Bool(m.muted),
            "paused" => Value::Bool(m.paused),
            "currentTime" => Value::Number(m.position_now()),
            "duration" => Value::Number(m.duration().unwrap_or(f64::NAN)),
            "ended" => Value::Bool(m.playing.is_none() && !m.looping && m.duration().is_some_and(|d| m.position >= d)),
            "readyState" => Value::Number(if ready { 4.0 } else { 0.0 }),
            "networkState" => Value::Number(match m.load {
                Load::Loading => 2.0,
                Load::Empty if m.src.is_empty() => 0.0,
                Load::Failed(_) => 3.0,
                _ => 1.0,
            }),
            "autoplay" => Value::Bool(false),
            "playbackRate" | "defaultPlaybackRate" => Value::Number(1.0),
            "tagName" | "nodeName" => Value::Str("AUDIO".into()),
            _ => match name.strip_prefix("on") {
                Some(kind) if MEDIA_EVENTS.contains(&kind) => m.ons.iter().find(|(k, _)| *k == kind).map_or(Value::Null, |(_, c)| Value::Closure(*c)),
                _ => return None,
            },
        })
    })
}

fn media_set(id: u32, name: &str, value: &Value) -> Result<(), String> {
    match name {
        "src" => set_src(id, &objects::to_display(value)),
        "crossOrigin" => {
            let v = match value {
                Value::Undefined | Value::Null => None,
                other => Some(if objects::to_display(other) == "use-credentials" { "use-credentials".to_string() } else { "anonymous".to_string() }),
            };
            with(|a| a.media.get_mut(&id).map(|m| m.cross_origin = v));
        }
        "preload" => {
            let v = match objects::to_display(value).as_str() {
                "none" => "none",
                "metadata" => "metadata",
                _ => "auto",
            };
            with(|a| a.media.get_mut(&id).map(|m| m.preload = v.into()));
        }
        "loop" => {
            let on = truthy(value);
            with(|a| {
                if let Some(m) = a.media.get_mut(&id) {
                    m.looping = on;
                    if let (Some(p), Some(e)) = (&m.playing, &m.engine) {
                        e.set(p.source, ae::Attr::Loop(on));
                    }
                }
            });
        }
        "volume" | "muted" => {
            let (volume, muted) = if name == "volume" {
                let v = double_value(value, "volume")?;
                if !(0.0..=1.0).contains(&v) {
                    return Err(throw("IndexSizeError", &format!("Failed to set the 'volume' property on 'HTMLMediaElement': The volume provided ({v}) is outside the range [0, 1].")));
                }
                (Some(v), None)
            } else {
                (None, Some(truthy(value)))
            };
            with(|a| {
                let Some(m) = a.media.get_mut(&id) else { return };
                let before = (m.volume, m.muted);
                m.volume = volume.unwrap_or(m.volume);
                m.muted = muted.unwrap_or(m.muted);
                if before != (m.volume, m.muted) {
                    if let Some(e) = &m.engine {
                        e.param(m.gain, ae::Param::Gain, ae::ParamEvent::Value(m.level()));
                    }
                    a.tasks.push_back(Task::MediaEvent { id, kind: "volumechange" });
                }
            });
        }
        "currentTime" => {
            let v = double_value(value, "currentTime")?.max(0.0);
            with(|a| {
                let playing = a.media.get(&id).is_some_and(|m| m.playing.is_some());
                stop_source(a, id);
                if let Some(m) = a.media.get_mut(&id) {
                    m.position = m.duration().map_or(v, |d| v.min(d));
                }
                if playing {
                    start_source(a, id);
                }
                a.tasks.push_back(Task::MediaEvent { id, kind: "seeked" });
            });
        }
        // Kept as the defaults (no autoplay policy, no rate change on this path).
        "autoplay" | "playbackRate" | "defaultPlaybackRate" => {}
        _ => match name.strip_prefix("on").and_then(|kind| MEDIA_EVENTS.iter().find(|k| **k == kind).copied()) {
            Some(kind) => {
                let closure = closure_of(value);
                if let Some(c) = closure {
                    crate::abi::closure_retain(c);
                }
                let mut later = Later::default();
                with(|a| {
                    if let Some(m) = a.media.get_mut(&id) {
                        if let Some(i) = m.ons.iter().position(|(k, _)| *k == kind) {
                            later.closures.push(m.ons.remove(i).1);
                        }
                        if let Some(c) = closure {
                            m.ons.push((kind, c));
                        }
                    }
                });
                later.run();
            }
            None => return Err(throw("TypeError", &format!("cannot set '{name}' on HTMLAudioElement"))),
        },
    }
    Ok(())
}

fn media_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "play" => {
            let (promise, r) = held_promise();
            let mut later = Later::default();
            let load = with(|a| {
                let m = a.media.get_mut(&id)?;
                let refused = match &m.load {
                    _ if m.src.is_empty() => Some("The element has no supported sources."),
                    Load::Failed(_) => Some("Failed to load because no supported source was found."),
                    _ => None,
                };
                if let Some(message) = refused {
                    a.tasks.push_back(Task::Settle { promise: r, rejected: Some(("NotSupportedError", message.into())) });
                    return None;
                }
                if m.paused {
                    set_paused(m, false, &mut later);
                    a.tasks.push_back(Task::MediaEvent { id, kind: "play" });
                }
                let m = a.media.get_mut(&id)?;
                if matches!(m.load, Load::Ready(_)) {
                    if m.playing.is_none() {
                        start_source(a, id);
                        a.tasks.push_back(Task::MediaEvent { id, kind: "playing" });
                    }
                    a.tasks.push_back(Task::Settle { promise: r, rejected: None });
                    return None;
                }
                m.waiting.push(r);
                Some(matches!(m.load, Load::Empty))
            });
            later.run();
            if load == Some(true) {
                begin_load(id);
            }
            trace(&format!("media {id}: play()"));
            Ok(promise)
        }
        "pause" => {
            let mut later = Later::default();
            with(|a| {
                if !a.media.get(&id).is_some_and(|m| !m.paused) {
                    return;
                }
                stop_source(a, id);
                settle_waiting(a, id, Some(("AbortError", "The play() request was interrupted by a call to pause().")));
                if let Some(m) = a.media.get_mut(&id) {
                    set_paused(m, true, &mut later);
                }
                a.tasks.push_back(Task::MediaEvent { id, kind: "pause" });
            });
            later.run();
            trace(&format!("media {id}: pause()"));
            Ok(Value::Undefined)
        }
        "load" => {
            let mut later = Later::default();
            reset(id, &mut later);
            later.run();
            if with(|a| a.media.get(&id).is_some_and(|m| m.preload != "none")) {
                begin_load(id);
            }
            Ok(Value::Undefined)
        }
        // What the decoder takes (audio-decode): Opus in Ogg, WAV, MP3.
        "canPlayType" => {
            let t = args.first().map(objects::to_display).unwrap_or_default().to_ascii_lowercase();
            let base = t.split(';').next().unwrap_or("").trim().to_string();
            let maybe = matches!(base.as_str(), "audio/ogg" | "audio/opus" | "audio/wav" | "audio/wave" | "audio/x-wav" | "audio/mpeg" | "audio/mp3");
            Ok(Value::Str(if maybe { "maybe".into() } else { String::new() }))
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1)) {
                let kind = objects::to_display(kind);
                let mut later = Later::default();
                with(|a| {
                    if let Some(m) = a.media.get_mut(&id) {
                        listen(&mut m.listeners, name == "addEventListener", &kind, *c, &mut later);
                    }
                });
                later.run();
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

/// The program let go of an element (a paused one: a playing one holds itself).
fn media_freed(id: u32, later: &mut Later) {
    with(|a| {
        stop_source(a, id);
        let Some(mut m) = a.media.remove(&id) else { return };
        later.objects.extend(m.waiting.drain(..));
        later.closures.extend(m.ons.drain(..).map(|(_, c)| c));
        m.listeners.drain(later);
        if let Some(e) = &m.engine {
            e.release(m.gain);
        }
    });
}

// ── objects.rs's entry points ──────────────────────────────────────────

pub fn get(h: Handle, name: &str) -> Result<Option<Value>, String> {
    Ok(match h {
        Handle::Context(id) => context_get(id, name),
        Handle::Node(key) | Handle::Listener(key) => node_get(key, name),
        Handle::Param(key, slot) => param_get(key, usize::from(slot), name),
        Handle::Buffer(id) => buffer_get(id, name),
        Handle::Media(id) => media_get(id, name),
    })
}

pub fn has_method(h: Handle, name: &str) -> bool {
    match h {
        Handle::Context(_) => CONTEXT_METHODS.contains(&name),
        Handle::Node(key) | Handle::Listener(key) => with(|a| a.nodes.get(&key).map(|n| n.kind)).is_some_and(|k| node_methods(k).contains(&name)),
        Handle::Param(..) => PARAM_METHODS.contains(&name),
        Handle::Buffer(_) => BUFFER_METHODS.contains(&name),
        Handle::Media(_) => MEDIA_METHODS.contains(&name),
    }
}

pub fn set(h: Handle, name: &str, value: &Value) -> Result<(), String> {
    match h {
        Handle::Context(id) if name == "onstatechange" => {
            let mut later = Later::default();
            with(|a| {
                if let Some(c) = a.contexts.get_mut(&id) {
                    set_on(&mut c.listeners, value, &mut later);
                }
            });
            later.run();
            Ok(())
        }
        Handle::Node(key) | Handle::Listener(key) => node_set(key, name, value),
        Handle::Param(key, slot) => param_set(key, usize::from(slot), name, value),
        Handle::Media(id) => media_set(id, name, value),
        _ => Err(throw("TypeError", &format!("cannot set '{name}' on {}", interface(h)))),
    }
}

pub fn call(obj: u64, h: Handle, name: &str, args: &[Value]) -> Result<Value, String> {
    match h {
        Handle::Context(id) => context_call(id, name, args),
        Handle::Node(key) | Handle::Listener(key) => node_call(obj, key, name, args),
        Handle::Param(key, slot) => param_call(obj, key, usize::from(slot), name, args),
        Handle::Buffer(id) => buffer_call(id, name, args),
        Handle::Media(id) => media_call(id, name, args),
    }
}

/// The interface an object is (the unanswered trace's name for it).
pub fn interface(h: Handle) -> &'static str {
    match h {
        Handle::Context(_) => "AudioContext",
        Handle::Node(key) => with(|a| a.nodes.get(&key).map_or("AudioNode", |n| n.kind.interface())),
        Handle::Listener(_) => "AudioListener",
        Handle::Param(..) => "AudioParam",
        Handle::Buffer(_) => "AudioBuffer",
        Handle::Media(_) => "HTMLAudioElement",
    }
}

/// `obj instanceof <iface>`.
pub fn instance_of(h: Handle, iface: &str) -> bool {
    match h {
        Handle::Context(_) => matches!(iface, "AudioContext" | "BaseAudioContext" | "EventTarget"),
        Handle::Node(_) => iface == interface(h) || matches!(iface, "AudioNode" | "EventTarget")
            || (iface == "AudioScheduledSourceNode" && matches!(interface(h), "AudioBufferSourceNode" | "OscillatorNode")),
        Handle::Media(_) => matches!(iface, "HTMLAudioElement" | "HTMLMediaElement" | "HTMLElement" | "Element" | "Node" | "EventTarget"),
        _ => iface == interface(h),
    }
}

/// The program let go of an object.
pub fn freed(h: Handle) {
    let mut later = Later::default();
    match h {
        Handle::Context(id) => with(|a| {
            if let Some(c) = a.contexts.remove(&id) {
                // Closed already (a context holds itself until then; close() saw to the engine); its destination and
                // listener go with it.
                let mut c = c;
                c.listeners.drain(&mut later);
                for key in [c.destination, c.listener] {
                    if let Some(n) = a.nodes.get(&key) {
                        later.objects.push(n.obj);
                    }
                }
            }
        }),
        Handle::Node(key) | Handle::Listener(key) => with(|a| {
            let Some(mut n) = a.nodes.remove(&key) else { return };
            a.by_engine.remove(&(engine_key(&n.engine), n.id));
            n.listeners.drain(&mut later);
            later.objects.extend(n.params.iter().map(|s| s.obj).filter(|o| *o != 0));
            later.objects.extend(n.buffer.map(|(o, _)| o));
            if n.kind.engine_kind().is_some() {
                n.engine.release(n.id);
                a.stats.released += 1;
            }
        }),
        // A param's object is held by its node: it goes with it (or the node was gone already).
        Handle::Param(key, slot) => with(|a| {
            if let Some(s) = a.nodes.get_mut(&key).and_then(|n| n.params.get_mut(usize::from(slot))) {
                s.obj = 0;
            }
        }),
        Handle::Buffer(id) => with(|a| {
            if let Some(b) = a.buffers.remove(&id) {
                later.objects.extend(b.arrays.into_iter().filter(|r| *r != 0));
            }
        }),
        Handle::Media(id) => media_freed(id, &mut later),
    }
    later.run();
}

// ── delivery ───────────────────────────────────────────────────────────

/// Tasks wait, or a playing source has `ended` handlers waiting on it (the loop's io_pending).
pub fn pending() -> bool {
    with(|a| {
        !a.tasks.is_empty()
            || a.nodes.values().any(|n| n.held && (n.listeners.on.is_some() || !n.listeners.added.is_empty()))
            || a.media.values().any(|m| m.playing.is_some() && !m.looping && !m.handlers("ended").is_empty())
    })
}

/// Tasks wait to be run now (the loop does not sleep).
pub fn due() -> bool {
    with(|a| !a.tasks.is_empty())
}

/// An event `{ type, target, currentTarget }` fired at `obj` through `handlers`, as one task. True when a handler threw
/// (the exception stays pending; the loop reports it).
fn fire(obj: u64, handlers: Vec<u64>, kind: &str) -> bool {
    if handlers.is_empty() {
        return false;
    }
    let event = values::new_object();
    if let Value::Object(e) = event {
        let _ = values::set(e, "type", Value::Str(kind.into()));
        if obj != 0 {
            let _ = values::set(e, "target", Value::Object(obj));
            let _ = values::set(e, "currentTarget", Value::Object(obj));
        }
    }
    for h in handlers {
        crate::abi::closure_retain(h);
        let threw = crate::abi::call_closure(h, std::slice::from_ref(&event)).is_err();
        crate::abi::closure_release(h);
        if threw {
            return true;
        }
    }
    false
}

/// The engines' events taken, then this thread's due tasks run, each a task of its own (microtasks between them).
/// True when a handler threw.
pub fn run() -> bool {
    // Each engine drained once: the shared one, and any an open context still holds.
    let mut engines: Vec<Rc<ae::Engine>> = SHARED.with(|s| s.borrow().clone()).into_iter().collect();
    with(|a| {
        for c in a.contexts.values().filter(|c| c.state != "closed") {
            if !engines.iter().any(|e| Rc::ptr_eq(e, &c.engine)) {
                engines.push(c.engine.clone());
            }
        }
    });
    for engine in engines {
        let events = engine.take_events();
        if !events.is_empty() {
            let key = engine_key(&engine);
            with(|a| {
                for event in events {
                    #[allow(unreachable_patterns)]
                    match event {
                        ae::Event::Ended(id) => a.tasks.push_back(Task::Ended { engine: key, id }),
                        _ => {}
                    }
                }
            });
        }
    }
    summary();
    loop {
        let Some(task) = with(|a| a.tasks.pop_front()) else { return false };
        let op = objects::Op::enter();
        let threw = deliver(task);
        drop(op);
        if threw {
            return true;
        }
        values::run_jobs();
    }
}

fn deliver(task: Task) -> bool {
    match task {
        Task::Ended { engine, id } => {
            let key = match with(|a| a.by_engine.get(&(engine, id)).copied()) {
                Some(Target::Node(key)) => key,
                Some(Target::Media(m)) => return media_ended(m, id),
                None => return false,
            };
            let Some((key, obj, handlers, held, n)) = with(|a| {
                let node = a.nodes.get_mut(&key)?;
                if std::mem::replace(&mut node.ended, true) {
                    return None;
                }
                let held = std::mem::take(&mut node.held);
                // A closed context's sources (stopped by its close, on an engine that lives on) fire nothing.
                let closed = a.contexts.get(&node.ctx).is_none_or(|c| c.state == "closed");
                let handlers = if closed { Vec::new() } else { node.listeners.handlers("ended", "ended") };
                let out = (key, node.obj, handlers, held);
                a.stats.ended += 1;
                Some((out.0, out.1, out.2, out.3, a.stats.ended))
            }) else {
                return false;
            };
            if sampled(n) {
                trace(&format!("ended {n}: node {key} ({} handlers)", handlers.len()));
            }
            let threw = fire(obj, handlers, "ended");
            // A source ends once: its handlers let go (one that closes over its own source would hold it for good),
            // and the node no longer keeps itself; the program's counts decide now.
            let mut later = Later::default();
            with(|a| {
                if let Some(n) = a.nodes.get_mut(&key) {
                    n.listeners.drain(&mut later);
                }
            });
            if held {
                later.objects.push(obj);
            }
            later.run();
            threw
        }
        Task::MediaEvent { id, kind } => {
            let Some((obj, handlers)) = with(|a| a.media.get(&id).map(|m| (m.obj, m.handlers(kind)))) else { return false };
            fire(obj, handlers, kind)
        }
        Task::StateChange(id) => {
            let Some((obj, handlers)) = with(|a| a.contexts.get(&id).map(|c| (c.obj, c.listeners.handlers("statechange", "statechange")))) else {
                return false;
            };
            fire(obj, handlers, "statechange")
        }
        Task::Settle { promise, rejected } => {
            match rejected {
                None => values::settle(promise, false, &Value::Undefined),
                Some((name, message)) => values::settle(promise, true, &values::new_error(name, &message)),
            }
            objects::release(promise);
            false
        }
    }
}

/// The trace's summary every ten seconds, when anything moved: live nodes by kind, made, released, ended.
fn summary() {
    if !trace_on() {
        return;
    }
    let line = with(|a| {
        let now = Instant::now();
        if a.stats.summary_at.is_some_and(|at| now.duration_since(at).as_secs() < 10) {
            return None;
        }
        a.stats.summary_at = Some(now);
        let seen = (a.stats.created, a.stats.released, a.stats.ended);
        if seen == a.stats.summary_seen && a.stats.created > 0 {
            return None;
        }
        a.stats.summary_seen = seen;
        let mut by_kind: Vec<(&'static str, usize)> = Vec::new();
        for n in a.nodes.values().filter(|n| n.kind.engine_kind().is_some()) {
            match by_kind.iter_mut().find(|(k, _)| *k == n.kind.interface()) {
                Some((_, c)) => *c += 1,
                None => by_kind.push((n.kind.interface(), 1)),
            }
        }
        by_kind.sort();
        let live: usize = by_kind.iter().map(|(_, c)| c).sum();
        let kinds = by_kind.iter().map(|(k, c)| format!("{k} {c}")).collect::<Vec<_>>().join(", ");
        let clocks = a.contexts.iter().map(|(id, c)| format!("context {id} {} t={:.2}", c.state, c.engine.current_time())).collect::<Vec<_>>().join("; ");
        let playing = a.nodes.values().filter(|n| n.held).count();
        Some(format!(
            "{live} nodes live ({kinds}); {playing} playing; made {}, released {}, ended {}; decoded {}, failed {}; buffers {}; {clocks}",
            a.stats.created, a.stats.released, a.stats.ended, a.stats.decoded, a.stats.decode_failures, a.buffers.len()
        ))
    });
    if let Some(line) = line {
        trace(&line);
    }
}

/// The window closed: every context closes (the output device released now), with no events.
pub fn shutdown() {
    let mut later = Later::default();
    let mut engines: Vec<Rc<ae::Engine>> = SHARED.with(|s| s.borrow_mut().take()).into_iter().collect();
    with(|a| {
        let ids: Vec<u32> = a.contexts.keys().copied().collect();
        for id in ids {
            if let Some(c) = a.contexts.get_mut(&id) {
                if c.state != "closed" {
                    engines.push(c.engine.clone());
                    c.state = "closed";
                    trace(&format!("context {id}: closed with the window"));
                }
                if std::mem::take(&mut c.held) {
                    later.objects.push(c.obj);
                }
            }
            release_sources(a, id, &mut later);
        }
        // Media elements stop where they are (paused, as a closing tab leaves them), their engine gone.
        for m in a.media.values_mut() {
            m.playing = None;
            m.paused = true;
            later.objects.extend(m.waiting.drain(..));
            if std::mem::take(&mut m.held) {
                later.objects.push(m.obj);
            }
            m.engine = None;
        }
    });
    for e in engines {
        e.close();
    }
    later.run();
}
