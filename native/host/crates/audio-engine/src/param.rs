//! AudioParam: the automation timeline (the spec's event list and its value computation), the param's nominal range,
//! and the a-rate input other nodes connect to it.
//!
//! The timeline is evaluated forward one quantum at a time on the render thread. Events are kept sorted by time (a
//! ramp's time is its end); the first event is the one in effect once its time has come, and events before it are
//! dropped as time passes them, so the list stays as short as what is still scheduled. A ramp always has an event
//! before it to start from: one scheduled with nothing before it gets an implicit setValueAtTime at the time it was
//! scheduled, at the value then current, as the spec says.

use crate::ParamEvent;
use crate::graph::Garbage;

pub const QUANTUM: usize = 128;

/// a-rate params take a value per frame, k-rate ones a value per quantum (the value at the quantum's first frame).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rate {
    A,
    K,
}

enum Kind {
    Set(f32),
    Linear(f32),
    Exponential(f32),
    /// setTargetAtTime: `start` is the value it starts from, known once the event before it has given way.
    Target { target: f32, tau: f64, start: Option<f32> },
    /// setValueCurveAtTime (followed in the list by the implicit setValueAtTime of its last value at its end).
    Curve { values: Vec<f32>, duration: f64 },
}

impl Kind {
    fn is_ramp(&self) -> bool {
        matches!(self, Kind::Linear(_) | Kind::Exponential(_))
    }
    fn same_type(&self, other: &Kind) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

struct Ev {
    time: f64,
    kind: Kind,
}

fn curve_at(values: &[f32], start: f64, duration: f64, t: f64) -> f32 {
    let n = values.len();
    if n == 0 {
        return 0.0;
    }
    if t >= start + duration || n == 1 || duration <= 0.0 {
        return values[n - 1];
    }
    // The spec's k = floor((N - 1) / duration * (t - start)), interpolated linearly to the next value.
    let pos = ((n - 1) as f64 / duration * (t - start)).max(0.0);
    let k = pos.floor() as usize;
    if k + 1 >= n {
        return values[n - 1];
    }
    let frac = (pos - k as f64) as f32;
    values[k] + (values[k + 1] - values[k]) * frac
}

fn ramp_at(exponential: bool, t0: f64, v0: f32, t1: f64, v1: f32, t: f64) -> f32 {
    if t >= t1 || t1 <= t0 {
        return v1;
    }
    let x = (t - t0) / (t1 - t0);
    if exponential {
        // The spec holds V0 until T1 when the two values differ in sign or V0 is zero.
        if v0 == 0.0 || (v0 < 0.0) != (v1 < 0.0) {
            return v0;
        }
        (v0 as f64 * (v1 as f64 / v0 as f64).powf(x)) as f32
    } else {
        (v0 as f64 + (v1 as f64 - v0 as f64) * x) as f32
    }
}

fn target_at(target: f32, tau: f64, start_time: f64, start: f32, t: f64) -> f32 {
    if tau <= 0.0 {
        return target;
    }
    (target as f64 + (start as f64 - target as f64) * (-(t - start_time) / tau).exp()) as f32
}

pub struct Timeline {
    /// The intrinsic value: the timeline's value at the last frame computed (before connected inputs are added).
    pub value: f32,
    events: Vec<Ev>,
}

impl Timeline {
    fn new(value: f32) -> Timeline {
        // Sized for typical sound-effect envelopes (a few events at a time), so scheduling does not allocate on the render thread.
        Timeline { value, events: Vec::with_capacity(16) }
    }

    /// One AudioParam call, made at context time `now` (the quantum being rendered).
    pub fn apply(&mut self, event: ParamEvent, now: f64, trash: &mut Vec<Garbage>) {
        match event {
            // The `.value` setter: Chrome's setValueAtTime(v, currentTime).
            ParamEvent::Value(v) => self.insert(now, Kind::Set(v), trash),
            ParamEvent::SetValueAtTime { value, time } => self.insert(time, Kind::Set(value), trash),
            ParamEvent::LinearRampToValueAtTime { value, time } => self.insert_ramp(time, Kind::Linear(value), now, trash),
            ParamEvent::ExponentialRampToValueAtTime { value, time } => self.insert_ramp(time, Kind::Exponential(value), now, trash),
            ParamEvent::SetTargetAtTime { target, time, time_constant } => {
                self.insert(time, Kind::Target { target, tau: time_constant, start: None }, trash)
            }
            ParamEvent::SetValueCurveAtTime { values, time, duration } => {
                let Some(&last) = values.last() else { return };
                self.insert(time, Kind::Curve { values, duration }, trash);
                self.insert(time + duration, Kind::Set(last), trash);
            }
            ParamEvent::CancelScheduledValues { time } => {
                self.remove_from(|e| e.time >= time, trash);
            }
            ParamEvent::CancelAndHoldAtTime { time } => {
                let held = self.eval(self.events.len(), time);
                let next_is_ramp = self.events.iter().find(|e| e.time > time).is_some_and(|e| e.kind.is_ramp());
                let ramp_exponential = self.events.iter().find(|e| e.time > time).is_some_and(|e| matches!(e.kind, Kind::Exponential(_)));
                self.remove_from(|e| e.time > time, trash);
                if next_is_ramp {
                    // A ramp in progress at the cancel time ends there, at the value it had reached.
                    let kind = if ramp_exponential { Kind::Exponential(held) } else { Kind::Linear(held) };
                    self.insert(time, kind, trash);
                } else {
                    // A setTarget or a curve in progress holds its value from the cancel time on.
                    self.insert(time, Kind::Set(held), trash);
                }
            }
        }
    }

    fn remove_from(&mut self, mut remove: impl FnMut(&Ev) -> bool, trash: &mut Vec<Garbage>) {
        let mut i = 0;
        while i < self.events.len() {
            if remove(&self.events[i]) {
                let ev = self.events.remove(i);
                if let Kind::Curve { values, .. } = ev.kind {
                    trash.push(Garbage::Curve(values));
                }
            } else {
                i += 1;
            }
        }
    }

    fn insert_ramp(&mut self, time: f64, kind: Kind, now: f64, trash: &mut Vec<Garbage>) {
        let at = self.events.partition_point(|e| e.time <= time);
        if at == 0 {
            // Nothing before the ramp: it starts from the current value, at the time it was scheduled.
            self.insert(now.min(time), Kind::Set(self.value), trash);
        }
        self.insert(time, kind, trash);
    }

    fn insert(&mut self, time: f64, kind: Kind, trash: &mut Vec<Garbage>) {
        if !time.is_finite() {
            return;
        }
        // An event of the same type at the same time replaces it (Chrome); otherwise it goes after the events at its
        // time and before the later ones.
        if let Some(i) = self.events.iter().position(|e| e.time == time && e.kind.same_type(&kind)) {
            let old = std::mem::replace(&mut self.events[i].kind, kind);
            if let Kind::Curve { values, .. } = old {
                trash.push(Garbage::Curve(values));
            }
            return;
        }
        let at = self.events.partition_point(|e| e.time <= time);
        self.events.insert(at, Ev { time, kind });
    }

    /// The value at `t` of the first `n` events, without changing anything (for cancelAndHoldAtTime).
    fn eval(&self, n: usize, t: f64) -> f32 {
        let events = &self.events[..n];
        let k = events.partition_point(|e| e.time <= t);
        if k == 0 {
            return self.value;
        }
        let e0 = &events[k - 1];
        if k < n && events[k].kind.is_ramp() {
            let (t0, v0) = (e0.time, self.end_value(k - 1));
            let (exponential, v1) = match events[k].kind {
                Kind::Exponential(v) => (true, v),
                Kind::Linear(v) => (false, v),
                _ => unreachable!(),
            };
            return ramp_at(exponential, t0, v0, events[k].time, v1, t);
        }
        match &e0.kind {
            Kind::Set(v) | Kind::Linear(v) | Kind::Exponential(v) => *v,
            Kind::Target { target, tau, start } => {
                let start = start.unwrap_or_else(|| self.eval(k - 1, e0.time));
                target_at(*target, *tau, e0.time, start, t)
            }
            Kind::Curve { values, duration } => curve_at(values, e0.time, *duration, t),
        }
    }

    /// The value event `i` leaves at its own time, for a ramp after it to start from.
    fn end_value(&self, i: usize) -> f32 {
        let e = &self.events[i];
        match &e.kind {
            Kind::Set(v) | Kind::Linear(v) | Kind::Exponential(v) => *v,
            Kind::Target { start, .. } => start.unwrap_or_else(|| self.eval(i, e.time)),
            Kind::Curve { values, .. } => values.last().copied().unwrap_or(0.0),
        }
    }

    /// The value of the event in effect (`events[0]`, its time come) at `t`, with no ramp after it.
    fn own_value(&self, t: f64) -> f32 {
        let e0 = &self.events[0];
        match &e0.kind {
            Kind::Set(v) | Kind::Linear(v) | Kind::Exponential(v) => *v,
            Kind::Target { target, tau, start } => target_at(*target, *tau, e0.time, start.unwrap_or(self.value), t),
            Kind::Curve { values, duration } => curve_at(values, e0.time, *duration, t),
        }
    }

    /// Drops the events whose successor's time has come by `t`, handing a setTarget the value it starts from.
    fn advance(&mut self, t: f64, trash: &mut Vec<Garbage>) {
        while self.events.len() >= 2 && self.events[1].time <= t {
            let t1 = self.events[1].time;
            if matches!(self.events[1].kind, Kind::Target { start: None, .. }) {
                let v = self.own_value(t1);
                if let Kind::Target { start, .. } = &mut self.events[1].kind {
                    *start = Some(v);
                }
            }
            let ev = self.events.remove(0);
            if let Kind::Curve { values, .. } = ev.kind {
                trash.push(Garbage::Curve(values));
            }
        }
    }

    /// The value at `t` once `advance(t)` has run.
    fn step(&mut self, t: f64) -> f32 {
        let Some(e0) = self.events.first() else { return self.value };
        if e0.time > t {
            return self.value;
        }
        if let Kind::Target { start: start @ None, .. } = &mut self.events[0].kind {
            *start = Some(self.value);
        }
        if self.events.len() >= 2 && self.events[1].kind.is_ramp() {
            if matches!(self.events[0].kind, Kind::Target { .. }) {
                // Chrome: a setTarget followed by a ramp runs until now, and the ramp starts from where it got to.
                let v = self.own_value(t);
                self.events[0] = Ev { time: t, kind: Kind::Set(v) };
            }
            let t0 = self.events[0].time;
            let v0 = match &self.events[0].kind {
                Kind::Set(v) | Kind::Linear(v) | Kind::Exponential(v) => *v,
                Kind::Curve { values, .. } => values.last().copied().unwrap_or(0.0),
                Kind::Target { .. } => unreachable!(),
            };
            let (exponential, v1) = match self.events[1].kind {
                Kind::Exponential(v) => (true, v),
                Kind::Linear(v) => (false, v),
                _ => unreachable!(),
            };
            return ramp_at(exponential, t0, v0, self.events[1].time, v1, t);
        }
        self.own_value(t)
    }

    /// Whether nothing can change the value from `t` until `t_end`: no event pending before then and the one in effect
    /// holds a constant.
    fn steady(&self, t: f64, t_end: f64) -> bool {
        match self.events.len() {
            0 => true,
            1 => {
                let e0 = &self.events[0];
                if e0.time > t {
                    e0.time >= t_end
                } else {
                    match &e0.kind {
                        Kind::Set(_) | Kind::Linear(_) | Kind::Exponential(_) => true,
                        Kind::Curve { duration, .. } => e0.time + duration <= t,
                        Kind::Target { .. } => false,
                    }
                }
            }
            _ => {
                let (e0, e1) = (&self.events[0], &self.events[1]);
                if e0.time > t {
                    return e0.time >= t_end;
                }
                if e1.time < t_end || e1.kind.is_ramp() {
                    return false;
                }
                matches!(e0.kind, Kind::Set(_) | Kind::Linear(_) | Kind::Exponential(_))
            }
        }
    }
}

/// A param's mono a-rate input: what connected nodes sent it this quantum (mixed down to mono).
pub struct ParamInput {
    pub buf: [f32; QUANTUM],
    /// The quantum it was written in (its first frame + 1; 0 for never): stale inputs are silent.
    pub stamp: u64,
    pub connections: u32,
}

pub struct AudioParam {
    pub timeline: Timeline,
    pub rate: Rate,
    pub min: f32,
    pub max: f32,
    /// The computed value per frame of the current quantum (all equal when `constant`).
    pub values: [f32; QUANTUM],
    pub constant: bool,
    pub input: Option<Box<ParamInput>>,
}

impl AudioParam {
    pub fn new(default: f32, min: f32, max: f32, rate: Rate) -> AudioParam {
        AudioParam { timeline: Timeline::new(default), rate, min, max, values: [default; QUANTUM], constant: true, input: None }
    }

    /// The computed values for the quantum starting at frame `frame0`: the timeline plus the connected input, clamped
    /// to the nominal range.
    pub fn compute(&mut self, frame0: u64, sample_rate: f64, trash: &mut Vec<Garbage>) {
        let dt = 1.0 / sample_rate;
        let t0 = frame0 as f64 * dt;
        let t_end = (frame0 + QUANTUM as u64) as f64 * dt;
        let tl = &mut self.timeline;
        tl.advance(t0, trash);
        let input = self.input.as_deref().filter(|i| i.stamp == frame0 + 1);
        if self.rate == Rate::K || tl.steady(t0, t_end) {
            let mut v = tl.step(t0);
            tl.value = v;
            if let Some(input) = input {
                if self.rate == Rate::A {
                    for (out, x) in self.values.iter_mut().zip(input.buf.iter()) {
                        let sum = v + x;
                        *out = if sum.is_nan() { 0.0 } else { sum.clamp(self.min, self.max) };
                    }
                    self.constant = false;
                    return;
                }
                v += input.buf[0];
            }
            let v = if v.is_nan() { 0.0 } else { v.clamp(self.min, self.max) };
            if !self.constant || self.values[0] != v {
                self.values = [v; QUANTUM];
            }
            self.constant = true;
            return;
        }
        let mut first = f32::NAN;
        let mut constant = true;
        for i in 0..QUANTUM {
            let t = (frame0 + i as u64) as f64 * dt;
            tl.advance(t, trash);
            let mut v = tl.step(t);
            tl.value = v;
            if let Some(input) = input {
                v += input.buf[i];
            }
            let v = if v.is_nan() { 0.0 } else { v.clamp(self.min, self.max) };
            if i == 0 {
                first = v;
            } else if v != first {
                constant = false;
            }
            self.values[i] = v;
        }
        self.constant = constant;
    }

    /// The value at the quantum's first frame (k-rate use, or a constant a-rate quantum).
    pub fn first(&self) -> f32 {
        self.values[0]
    }
}
