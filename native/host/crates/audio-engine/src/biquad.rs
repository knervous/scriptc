//! BiquadFilterNode: the spec's coefficients (the Audio EQ Cookbook's, with Q in dB for lowpass and highpass), Chrome's
//! limits at 0 Hz, Nyquist and Q = 0, all four params a-rate (coefficients per frame while any of them moves, once a
//! quantum otherwise), and a direct form I filter per channel in f64.

use crate::BiquadType;
use crate::bus::Bus;
use crate::graph::Garbage;
use crate::nodes::Ctx;
use crate::param::{AudioParam, QUANTUM, Rate};

/// Normalized coefficients: b0, b1, b2, a1, a2 (a0 divided out).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coefficients(pub [f64; 5]);

const PASS: Coefficients = Coefficients([1.0, 0.0, 0.0, 0.0, 0.0]);
const ZERO: Coefficients = Coefficients([0.0, 0.0, 0.0, 0.0, 0.0]);

fn gain_only(g: f64) -> Coefficients {
    Coefficients([g, 0.0, 0.0, 0.0, 0.0])
}

fn normalize(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Coefficients {
    let k = 1.0 / a0;
    Coefficients([b0 * k, b1 * k, b2 * k, a1 * k, a2 * k])
}

/// The spec's coefficients for `kind` at `frequency` Hz (with detune applied), `q`, and `gain` dB.
pub fn coefficients(kind: BiquadType, frequency: f64, q: f64, gain: f64, sample_rate: f64) -> Coefficients {
    let nyquist = sample_rate / 2.0;
    let f0 = if frequency.is_nan() { 0.0 } else { frequency.clamp(0.0, nyquist) };
    let a = 10f64.powf(gain / 40.0);
    let inside = f0 > 0.0 && f0 < nyquist;
    let w0 = 2.0 * std::f64::consts::PI * f0 / sample_rate;
    let (sin, cos) = w0.sin_cos();
    match kind {
        BiquadType::Lowpass => {
            if f0 >= nyquist {
                return PASS;
            }
            if f0 <= 0.0 {
                return ZERO;
            }
            let alpha = sin / (2.0 * 10f64.powf(q / 20.0));
            normalize((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        BiquadType::Highpass => {
            if f0 >= nyquist {
                return ZERO;
            }
            if f0 <= 0.0 {
                return PASS;
            }
            let alpha = sin / (2.0 * 10f64.powf(q / 20.0));
            normalize((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        BiquadType::Bandpass => {
            if !inside {
                return ZERO;
            }
            if q <= 0.0 {
                return PASS;
            }
            let alpha = sin / (2.0 * q);
            normalize(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        BiquadType::Lowshelf => {
            if f0 >= nyquist {
                return gain_only(a * a);
            }
            if f0 <= 0.0 {
                return PASS;
            }
            let alpha_s = sin / 2.0 * 2f64.sqrt();
            let k = 2.0 * alpha_s * a.sqrt();
            normalize(
                a * ((a + 1.0) - (a - 1.0) * cos + k),
                2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                a * ((a + 1.0) - (a - 1.0) * cos - k),
                (a + 1.0) + (a - 1.0) * cos + k,
                -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                (a + 1.0) + (a - 1.0) * cos - k,
            )
        }
        BiquadType::Highshelf => {
            if f0 >= nyquist {
                return PASS;
            }
            if f0 <= 0.0 {
                return gain_only(a * a);
            }
            let alpha_s = sin / 2.0 * 2f64.sqrt();
            let k = 2.0 * alpha_s * a.sqrt();
            normalize(
                a * ((a + 1.0) + (a - 1.0) * cos + k),
                -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                a * ((a + 1.0) + (a - 1.0) * cos - k),
                (a + 1.0) - (a - 1.0) * cos + k,
                2.0 * ((a - 1.0) - (a + 1.0) * cos),
                (a + 1.0) - (a - 1.0) * cos - k,
            )
        }
        BiquadType::Peaking => {
            if !inside {
                return PASS;
            }
            if q <= 0.0 {
                return gain_only(a * a);
            }
            let alpha = sin / (2.0 * q);
            normalize(1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a)
        }
        BiquadType::Notch => {
            if !inside {
                return PASS;
            }
            if q <= 0.0 {
                return ZERO;
            }
            let alpha = sin / (2.0 * q);
            normalize(1.0, -2.0 * cos, 1.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        BiquadType::Allpass => {
            if !inside {
                return PASS;
            }
            if q <= 0.0 {
                return gain_only(-1.0);
            }
            let alpha = sin / (2.0 * q);
            normalize(1.0 - alpha, -2.0 * cos, 1.0 + alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
    }
}

impl Coefficients {
    /// The magnitude response at `frequency` Hz (for the examples' checks).
    pub fn magnitude(&self, frequency: f64, sample_rate: f64) -> f64 {
        let [b0, b1, b2, a1, a2] = self.0;
        let w = 2.0 * std::f64::consts::PI * frequency / sample_rate;
        let (s1, c1) = w.sin_cos();
        let (s2, c2) = (2.0 * w).sin_cos();
        let (nr, ni) = (b0 + b1 * c1 + b2 * c2, -(b1 * s1 + b2 * s2));
        let (dr, di) = (1.0 + a1 * c1 + a2 * c2, -(a1 * s1 + a2 * s2));
        ((nr * nr + ni * ni) / (dr * dr + di * di)).sqrt()
    }
}

pub struct Biquad {
    pub kind: BiquadType,
    pub frequency: AudioParam,
    pub detune: AudioParam,
    pub q: AudioParam,
    pub gain: AudioParam,
    /// x1, x2, y1, y2 per channel.
    state: [[f64; 4]; 2],
    /// Channels of the last input heard (what a ringing tail keeps).
    channels: usize,
    /// The tail has died away since the input went silent: output silence without filtering.
    quiet: bool,
}

impl Biquad {
    pub fn new(sample_rate: f32) -> Biquad {
        let nyquist = sample_rate / 2.0;
        Biquad {
            kind: BiquadType::Lowpass,
            frequency: AudioParam::new(350.0, 0.0, nyquist, Rate::A),
            detune: AudioParam::new(0.0, -153600.0, 153600.0, Rate::A),
            q: AudioParam::new(1.0, f32::MIN, f32::MAX, Rate::A),
            gain: AudioParam::new(0.0, f32::MIN, 1541.0, Rate::A),
            state: [[0.0; 4]; 2],
            channels: 1,
            quiet: true,
        }
    }

    pub fn quiet(&self) -> bool {
        self.quiet
    }

    fn at(&self, i: usize, sample_rate: f64) -> Coefficients {
        let f = self.frequency.values[i] as f64 * (self.detune.values[i] as f64 / 1200.0).exp2();
        coefficients(self.kind, f, self.q.values[i] as f64, self.gain.values[i] as f64, sample_rate)
    }

    pub fn process(&mut self, input: &Bus, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) {
        for p in [&mut self.frequency, &mut self.detune, &mut self.q, &mut self.gain] {
            p.compute(ctx.frame0, ctx.sample_rate, trash);
        }
        if input.silent() {
            if self.quiet {
                out.set_silent();
                return;
            }
        } else {
            self.quiet = false;
            if input.channels == 2 && self.channels == 1 {
                // Going stereo: the right channel continues from the left's state, as the mono input up-mixed.
                self.state[1] = self.state[0];
            }
            self.channels = input.channels;
        }
        let channels = self.channels;
        out.channels = channels;
        let constant = self.frequency.constant && self.detune.constant && self.q.constant && self.gain.constant;
        let mut c = self.at(0, ctx.sample_rate);
        for i in 0..QUANTUM {
            if !constant && i > 0 {
                c = self.at(i, ctx.sample_rate);
            }
            let [b0, b1, b2, a1, a2] = c.0;
            for ch in 0..channels {
                let x = if input.silent() { 0.0 } else { input.ch[ch][i] as f64 };
                let s = &mut self.state[ch];
                let y = b0 * x + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3];
                *s = [x, s[0], y, s[2]];
                out.ch[ch][i] = y as f32;
            }
        }
        // A filter driven to infinity or NaN starts again from rest, so it recovers (and can be freed).
        if self.state.iter().flatten().any(|v| !v.is_finite()) {
            self.state = [[0.0; 4]; 2];
        }
        // Flush denormals, and once the input is silent and the tail has decayed below hearing, stop filtering.
        for s in &mut self.state {
            for v in s.iter_mut() {
                if v.abs() < 1e-30 {
                    *v = 0.0;
                }
            }
        }
        if input.silent() && out.peak() < 1e-7 && self.state[..channels].iter().all(|s| s.iter().all(|v| v.abs() < 1e-7)) {
            self.state = [[0.0; 4]; 2];
            self.quiet = true;
        }
    }
}
