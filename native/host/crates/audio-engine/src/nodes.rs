//! The graph's nodes: the state each keeps between quanta, and how each turns its input into its output for one quantum.
//! Gain, the two panners and the listener live here; the larger nodes have their own modules.

use std::f64::consts::FRAC_PI_2;

use crate::biquad::Biquad;
use crate::bus::Bus;
use crate::compressor::Compressor;
use crate::convolver::Convolver;
use crate::graph::Garbage;
use crate::oscillator::Oscillator;
use crate::param::{AudioParam, QUANTUM, Rate};
use crate::source::BufferSource;
use crate::{Attr, DistanceModel, NodeId, NodeKind, Param};

/// What the render thread knows of the quantum it renders.
pub struct Ctx<'a> {
    pub frame0: u64,
    pub sample_rate: f64,
    pub listener: &'a Listener,
}

impl Ctx<'_> {
    pub fn time(&self, i: usize) -> f64 {
        (self.frame0 + i as u64) as f64 / self.sample_rate
    }
}

/// Where a connection lands: the node's input, or one of its params.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Input,
    Param(Param),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edge {
    pub to: NodeId,
    pub target: Target,
}

/// A node as the render thread holds it: made (boxed, with its buffers) on the page thread, so creating one does not
/// allocate on the render thread.
pub struct NodeState {
    pub id: NodeId,
    pub node: Node,
    /// Outgoing connections.
    pub edges: Vec<Edge>,
    /// Connections into this node's input and params, from live nodes.
    pub incoming: u32,
    /// The page released it: it is freed once nothing feeds it and it can make no more sound.
    pub released: bool,
    /// Part of a cycle (no DelayNode here to break one): muted, as the spec says.
    pub muted: bool,
    pub input: Bus,
    pub output: Bus,
}

/// Sizes differ (a compressor carries its look-ahead buffers), but every node is boxed in its `NodeState` anyway.
#[allow(clippy::large_enum_variant)]
pub enum Node {
    Destination,
    Gain(Gain),
    BufferSource(BufferSource),
    Oscillator(Oscillator),
    Biquad(Biquad),
    StereoPanner(StereoPanner),
    Panner(Panner),
    Convolver(Convolver),
    Compressor(Compressor),
}

impl NodeState {
    pub fn new(id: NodeId, kind: NodeKind, sample_rate: f32) -> Box<NodeState> {
        let node = match kind {
            NodeKind::Gain => Node::Gain(Gain { gain: AudioParam::new(1.0, f32::MIN, f32::MAX, Rate::A) }),
            NodeKind::BufferSource => Node::BufferSource(BufferSource::new()),
            NodeKind::Oscillator => Node::Oscillator(Oscillator::new(sample_rate)),
            NodeKind::BiquadFilter => Node::Biquad(Biquad::new(sample_rate)),
            NodeKind::StereoPanner => Node::StereoPanner(StereoPanner { pan: AudioParam::new(0.0, -1.0, 1.0, Rate::A) }),
            NodeKind::Panner => Node::Panner(Panner::new()),
            NodeKind::Convolver => Node::Convolver(Convolver::new()),
            NodeKind::DynamicsCompressor => Node::Compressor(Compressor::new(sample_rate)),
        };
        Self::with(id, node)
    }

    pub fn destination() -> Box<NodeState> {
        Self::with(crate::DESTINATION, Node::Destination)
    }

    fn with(id: NodeId, node: Node) -> Box<NodeState> {
        Box::new(NodeState {
            id,
            node,
            edges: Vec::with_capacity(4),
            incoming: 0,
            released: false,
            muted: false,
            input: Bus::new(),
            output: Bus::new(),
        })
    }

    pub fn param_mut(&mut self, param: Param) -> Option<&mut AudioParam> {
        match (&mut self.node, param) {
            (Node::Gain(n), Param::Gain) => Some(&mut n.gain),
            (Node::BufferSource(n), Param::PlaybackRate) => Some(&mut n.playback_rate),
            (Node::BufferSource(n), Param::Detune) => Some(&mut n.detune),
            (Node::Oscillator(n), Param::Frequency) => Some(&mut n.frequency),
            (Node::Oscillator(n), Param::Detune) => Some(&mut n.detune),
            (Node::Biquad(n), Param::Frequency) => Some(&mut n.frequency),
            (Node::Biquad(n), Param::Detune) => Some(&mut n.detune),
            (Node::Biquad(n), Param::Q) => Some(&mut n.q),
            (Node::Biquad(n), Param::Gain) => Some(&mut n.gain),
            (Node::StereoPanner(n), Param::Pan) => Some(&mut n.pan),
            (Node::Panner(n), Param::PositionX) => Some(&mut n.position[0]),
            (Node::Panner(n), Param::PositionY) => Some(&mut n.position[1]),
            (Node::Panner(n), Param::PositionZ) => Some(&mut n.position[2]),
            (Node::Panner(n), Param::OrientationX) => Some(&mut n.orientation[0]),
            (Node::Panner(n), Param::OrientationY) => Some(&mut n.orientation[1]),
            (Node::Panner(n), Param::OrientationZ) => Some(&mut n.orientation[2]),
            (Node::Compressor(n), Param::Threshold) => Some(&mut n.threshold),
            (Node::Compressor(n), Param::Knee) => Some(&mut n.knee),
            (Node::Compressor(n), Param::Ratio) => Some(&mut n.ratio),
            (Node::Compressor(n), Param::Attack) => Some(&mut n.attack),
            (Node::Compressor(n), Param::Release) => Some(&mut n.release),
            _ => None,
        }
    }

    pub fn set(&mut self, attr: Attr, trash: &mut Vec<Garbage>) {
        match (&mut self.node, attr) {
            (Node::Biquad(n), Attr::BiquadType(t)) => n.kind = t,
            (Node::BufferSource(n), Attr::Buffer(b)) => {
                if let Some(old) = std::mem::replace(&mut n.buffer, b) {
                    trash.push(Garbage::Buffer(old));
                }
            }
            (Node::BufferSource(n), Attr::Loop(v)) => n.looping = v,
            (Node::BufferSource(n), Attr::LoopStart(v)) => n.loop_start = v,
            (Node::BufferSource(n), Attr::LoopEnd(v)) => n.loop_end = v,
            (Node::Panner(n), Attr::DistanceModel(m)) => n.distance_model = m,
            (Node::Panner(n), Attr::RefDistance(v)) => n.ref_distance = v,
            (Node::Panner(n), Attr::MaxDistance(v)) => n.max_distance = v,
            (Node::Panner(n), Attr::RolloffFactor(v)) => n.rolloff = v,
            (Node::Panner(n), Attr::ConeInnerAngle(v)) => n.cone_inner = v,
            (Node::Panner(n), Attr::ConeOuterAngle(v)) => n.cone_outer = v,
            (Node::Panner(n), Attr::ConeOuterGain(v)) => n.cone_outer_gain = v,
            // Attr::Buffer and Attr::Normalize on a convolver, and Attr::OscillatorType, are prepared on the page thread
            // (graph::Cmd::SetConvolver, Cmd::SetWave).
            (_, Attr::Buffer(Some(b))) => trash.push(Garbage::Buffer(b)),
            _ => {}
        }
    }

    /// Renders one quantum from `input` into `output`. True when a source ended in it.
    pub fn process(&mut self, ctx: &Ctx, trash: &mut Vec<Garbage>) -> bool {
        let NodeState { node, input, output, muted, .. } = self;
        let ended = match node {
            Node::Destination => {
                output.set_silent();
                false
            }
            Node::Gain(n) => {
                n.process(input, output, ctx, trash);
                false
            }
            Node::BufferSource(n) => n.process(output, ctx, trash),
            Node::Oscillator(n) => n.process(output, ctx, trash),
            Node::Biquad(n) => {
                n.process(input, output, ctx, trash);
                false
            }
            Node::StereoPanner(n) => {
                n.process(input, output, ctx, trash);
                false
            }
            Node::Panner(n) => {
                n.process(input, output, ctx, trash);
                false
            }
            Node::Convolver(n) => {
                n.process(input, output);
                false
            }
            Node::Compressor(n) => {
                n.process(input, output, ctx, trash);
                false
            }
        };
        if *muted {
            output.set_silent();
        }
        ended
    }

    /// Whether the node can still make sound with nothing feeding it: a source started and not ended, or a processor
    /// still ringing out its tail.
    pub fn sounding(&self) -> bool {
        match &self.node {
            Node::Destination => true,
            Node::BufferSource(n) => n.sched.sounding(),
            Node::Oscillator(n) => n.sched.sounding(),
            Node::Biquad(n) => !n.quiet(),
            Node::Convolver(n) => !n.quiet(),
            Node::Compressor(n) => !n.quiet(),
            Node::Gain(_) | Node::StereoPanner(_) | Node::Panner(_) => false,
        }
    }
}

/// A source's start and stop: shared by buffer sources and oscillators.
pub struct Schedule {
    pub start: Option<f64>,
    pub stop: f64,
    pub started: bool,
    pub ended: bool,
}

impl Schedule {
    pub const fn new() -> Schedule {
        Schedule { start: None, stop: f64::INFINITY, started: false, ended: false }
    }
    pub fn sounding(&self) -> bool {
        self.start.is_some() && !self.ended
    }
}

// ---- gain ------------------------------------------------------------------------------------------------------------

pub struct Gain {
    pub gain: AudioParam,
}

impl Gain {
    fn process(&mut self, input: &Bus, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) {
        self.gain.compute(ctx.frame0, ctx.sample_rate, trash);
        if input.silent() {
            out.set_silent();
            return;
        }
        let n = input.channels;
        out.channels = n;
        let g = &self.gain;
        for c in 0..n {
            let (src, dst) = (&input.ch[c], &mut out.ch[c]);
            if g.constant {
                let k = g.first();
                for i in 0..QUANTUM {
                    dst[i] = src[i] * k;
                }
            } else {
                for i in 0..QUANTUM {
                    dst[i] = src[i] * g.values[i];
                }
            }
        }
    }
}

// ---- stereo panner ---------------------------------------------------------------------------------------------------

pub struct StereoPanner {
    pub pan: AudioParam,
}

/// The spec's StereoPannerNode for one frame.
fn stereo_pan(pan: f32, l: f32, r: f32, mono: bool) -> (f32, f32) {
    let pan = pan.clamp(-1.0, 1.0) as f64;
    if mono {
        let x = (pan + 1.0) / 2.0;
        let (gl, gr) = ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin());
        return ((l as f64 * gl) as f32, (l as f64 * gr) as f32);
    }
    if pan <= 0.0 {
        let x = pan + 1.0;
        let (gl, gr) = ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin());
        ((l as f64 + r as f64 * gl) as f32, (r as f64 * gr) as f32)
    } else {
        let x = pan;
        let (gl, gr) = ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin());
        ((l as f64 * gl) as f32, (r as f64 + l as f64 * gr) as f32)
    }
}

impl StereoPanner {
    fn process(&mut self, input: &Bus, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) {
        self.pan.compute(ctx.frame0, ctx.sample_rate, trash);
        if input.silent() {
            out.set_silent();
            return;
        }
        let mono = input.channels == 1;
        out.channels = 2;
        for i in 0..QUANTUM {
            let l = input.ch[0][i];
            let r = if mono { l } else { input.ch[1][i] };
            let (a, b) = stereo_pan(self.pan.values[i], l, r, mono);
            out.ch[0][i] = a;
            out.ch[1][i] = b;
        }
    }
}

// ---- the listener ----------------------------------------------------------------------------------------------------

/// The AudioListener: position, forward and up (a-rate, as the spec has them).
pub struct Listener {
    pub params: [AudioParam; 9],
}

impl Listener {
    pub fn new() -> Listener {
        let p = |v: f32| AudioParam::new(v, f32::MIN, f32::MAX, Rate::A);
        Listener { params: [p(0.0), p(0.0), p(0.0), p(0.0), p(0.0), p(-1.0), p(0.0), p(1.0), p(0.0)] }
    }

    pub fn param_mut(&mut self, param: Param) -> Option<&mut AudioParam> {
        let i = match param {
            Param::ListenerPositionX => 0,
            Param::ListenerPositionY => 1,
            Param::ListenerPositionZ => 2,
            Param::ListenerForwardX => 3,
            Param::ListenerForwardY => 4,
            Param::ListenerForwardZ => 5,
            Param::ListenerUpX => 6,
            Param::ListenerUpY => 7,
            Param::ListenerUpZ => 8,
            _ => return None,
        };
        Some(&mut self.params[i])
    }

    pub fn compute(&mut self, frame0: u64, sample_rate: f64, trash: &mut Vec<Garbage>) {
        for p in &mut self.params {
            p.compute(frame0, sample_rate, trash);
        }
    }

    fn constant(&self) -> bool {
        self.params.iter().all(|p| p.constant)
    }

    fn at(&self, i: usize) -> ([f64; 3], [f64; 3], [f64; 3]) {
        let v = |k: usize| self.params[k].values[i] as f64;
        ([v(0), v(1), v(2)], [v(3), v(4), v(5)], [v(6), v(7), v(8)])
    }
}

// ---- panner ----------------------------------------------------------------------------------------------------------

type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn mag(a: V3) -> f64 {
    dot(a, a).sqrt()
}
fn norm(a: V3) -> V3 {
    let m = mag(a);
    if m == 0.0 { a } else { [a[0] / m, a[1] / m, a[2] / m] }
}
fn scale(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

pub struct Panner {
    pub position: [AudioParam; 3],
    pub orientation: [AudioParam; 3],
    pub distance_model: DistanceModel,
    pub ref_distance: f64,
    pub max_distance: f64,
    pub rolloff: f64,
    pub cone_inner: f64,
    pub cone_outer: f64,
    pub cone_outer_gain: f64,
}

impl Panner {
    fn new() -> Panner {
        let p = |v: f32| AudioParam::new(v, f32::MIN, f32::MAX, Rate::A);
        Panner {
            position: [p(0.0), p(0.0), p(0.0)],
            orientation: [p(1.0), p(0.0), p(0.0)],
            distance_model: DistanceModel::Inverse,
            ref_distance: 1.0,
            max_distance: 10000.0,
            rolloff: 1.0,
            cone_inner: 360.0,
            cone_outer: 360.0,
            cone_outer_gain: 0.0,
        }
    }

    /// The spec's azimuth (degrees) of `source` as the listener hears it.
    pub fn azimuth(source: V3, listener: V3, forward: V3, up: V3) -> f64 {
        let source_listener = sub(source, listener);
        if mag(source_listener) == 0.0 {
            return 0.0;
        }
        let source_listener = norm(source_listener);
        let right = cross(forward, up);
        if mag(right) == 0.0 {
            // Forward and up are parallel: no orientation to pan by.
            return 0.0;
        }
        let right = norm(right);
        let forward = norm(forward);
        let up = cross(right, forward);
        let up_projection = dot(source_listener, up);
        let projected = norm(sub(source_listener, scale(up, up_projection)));
        let mut azimuth = 180.0 * dot(projected, right).clamp(-1.0, 1.0).acos() / std::f64::consts::PI;
        if dot(projected, forward) < 0.0 {
            azimuth = 360.0 - azimuth;
        }
        if (0.0..=270.0).contains(&azimuth) { 90.0 - azimuth } else { 450.0 - azimuth }
    }

    pub fn distance_gain(&self, distance: f64) -> f64 {
        let (r, m, f) = (self.ref_distance, self.max_distance, self.rolloff);
        let g = match self.distance_model {
            DistanceModel::Linear => {
                let f = f.clamp(0.0, 1.0);
                if m <= r {
                    if distance > r { 1.0 - f } else { 1.0 }
                } else {
                    1.0 - f * (distance.min(m).max(r) - r) / (m - r)
                }
            }
            DistanceModel::Inverse => r / (r + f * (distance.max(r) - r)),
            DistanceModel::Exponential => (distance.max(r) / r).powf(-f),
        };
        if g.is_finite() { g } else { 0.0 }
    }

    pub fn cone_gain(&self, source: V3, orientation: V3, listener: V3) -> f64 {
        if mag(orientation) == 0.0 || (self.cone_inner == 360.0 && self.cone_outer == 360.0) {
            return 1.0;
        }
        let to_listener = norm(sub(listener, source));
        let angle = 180.0 * dot(to_listener, norm(orientation)).clamp(-1.0, 1.0).acos() / std::f64::consts::PI;
        let abs_angle = angle.abs();
        let inner = self.cone_inner.abs() / 2.0;
        let outer = self.cone_outer.abs() / 2.0;
        if abs_angle <= inner {
            1.0
        } else if abs_angle >= outer {
            self.cone_outer_gain
        } else {
            let x = (abs_angle - inner) / (outer - inner);
            (1.0 - x) + self.cone_outer_gain * x
        }
    }

    /// (azimuth, distance and cone gain) at frame `i`.
    fn frame(&self, listener: &Listener, i: usize) -> (f64, f64) {
        let (lp, lf, lu) = listener.at(i);
        let v = |p: &[AudioParam; 3]| [p[0].values[i] as f64, p[1].values[i] as f64, p[2].values[i] as f64];
        let (sp, so) = (v(&self.position), v(&self.orientation));
        let azimuth = Self::azimuth(sp, lp, lf, lu);
        let gain = self.distance_gain(mag(sub(sp, lp))) * self.cone_gain(sp, so, lp);
        (azimuth, gain)
    }

    fn process(&mut self, input: &Bus, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) {
        for p in self.position.iter_mut().chain(self.orientation.iter_mut()) {
            p.compute(ctx.frame0, ctx.sample_rate, trash);
        }
        if input.silent() {
            out.set_silent();
            return;
        }
        let mono = input.channels == 1;
        out.channels = 2;
        let constant = ctx.listener.constant() && self.position.iter().chain(self.orientation.iter()).all(|p| p.constant);
        let mut state = self.frame(ctx.listener, 0);
        for i in 0..QUANTUM {
            if !constant && i > 0 {
                state = self.frame(ctx.listener, i);
            }
            let (azimuth, gain) = state;
            let l = input.ch[0][i];
            let r = if mono { l } else { input.ch[1][i] };
            let (a, b) = equal_power(azimuth, l, r, mono);
            out.ch[0][i] = (a as f64 * gain) as f32;
            out.ch[1][i] = (b as f64 * gain) as f32;
        }
    }
}

/// The spec's equal-power panning of one frame at `azimuth` degrees.
pub fn equal_power(azimuth: f64, l: f32, r: f32, mono: bool) -> (f32, f32) {
    let mut azimuth = azimuth.clamp(-180.0, 180.0);
    if azimuth < -90.0 {
        azimuth = -180.0 - azimuth;
    } else if azimuth > 90.0 {
        azimuth = 180.0 - azimuth;
    }
    let (l, r) = (l as f64, r as f64);
    if mono {
        let x = (azimuth + 90.0) / 180.0;
        let (gl, gr) = ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin());
        return ((l * gl) as f32, (l * gr) as f32);
    }
    if azimuth <= 0.0 {
        let x = (azimuth + 90.0) / 90.0;
        let (gl, gr) = ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin());
        ((l + r * gl) as f32, (r * gr) as f32)
    } else {
        let x = azimuth / 90.0;
        let (gl, gr) = ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin());
        ((l * gl) as f32, (r + l * gr) as f32)
    }
}
