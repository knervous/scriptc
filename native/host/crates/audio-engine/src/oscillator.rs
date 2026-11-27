//! OscillatorNode: the spec's waveforms as band-limited wavetables, Chrome's way (PeriodicWave): each waveform's
//! Fourier series is summed into one table per third of an octave, every table keeping only the partials that stay
//! below Nyquist at the pitches it serves, normalized together so the fullest table peaks at 1. A note reads the two
//! tables around its pitch and crossfades them, so a sweep changes no partial abruptly and nothing aliases.

use std::sync::{Arc, Mutex};

use realfft::RealFftPlanner;
use realfft::num_complex::Complex;

use crate::OscillatorType;
use crate::bus::Bus;
use crate::graph::Garbage;
use crate::nodes::{Ctx, Schedule};
use crate::param::{AudioParam, QUANTUM, Rate};

/// Cents between adjacent tables (three per octave, as Chrome).
const CENTS_PER_RANGE: f64 = 1200.0 / 3.0;

pub struct WaveTables {
    size: usize,
    /// Each `size + 1` long (the first sample repeated at the end, for interpolation); the first has every partial up
    /// to size / 2, each next one a third of an octave fewer.
    tables: Vec<Vec<f32>>,
    /// The fundamental at which the first table's highest partial reaches Nyquist.
    lowest: f64,
}

/// Built tables, kept for every oscillator of a type at a rate (a few hundred kilobytes each).
static CACHE: Mutex<Vec<(OscillatorType, u32, Arc<WaveTables>)>> = Mutex::new(Vec::new());

impl WaveTables {
    /// The tables for `kind` at `sample_rate`, built on first use (on the page thread: creating an oscillator or setting
    /// its type).
    pub fn get(kind: OscillatorType, sample_rate: f32) -> Arc<WaveTables> {
        let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, _, t)) = cache.iter().find(|(k, r, _)| *k == kind && *r == sample_rate.to_bits()) {
            return t.clone();
        }
        let tables = Arc::new(Self::build(kind, sample_rate));
        cache.push((kind, sample_rate.to_bits(), tables.clone()));
        tables
    }

    fn build(kind: OscillatorType, sample_rate: f32) -> WaveTables {
        // Chrome's table sizes for the rate.
        let size: usize = if sample_rate <= 24000.0 {
            2048
        } else if sample_rate <= 88200.0 {
            4096
        } else {
            16384
        };
        let half = size / 2;
        let ranges = if kind == OscillatorType::Sine { 1 } else { (3.0 * (size as f64).log2()).ceil() as usize };
        let coefficient = |k: usize| -> f64 {
            let kf = k as f64;
            let pi = std::f64::consts::PI;
            match kind {
                OscillatorType::Sine => {
                    if k == 1 {
                        1.0
                    } else {
                        0.0
                    }
                }
                OscillatorType::Square => 2.0 / (kf * pi) * (1.0 - if k.is_multiple_of(2) { 1.0 } else { -1.0 }),
                OscillatorType::Sawtooth => (if k % 2 == 1 { 1.0 } else { -1.0 }) * 2.0 / (kf * pi),
                OscillatorType::Triangle => 8.0 * (kf * pi / 2.0).sin() / (pi * kf).powi(2),
            }
        };
        let mut planner = RealFftPlanner::<f32>::new();
        let inverse = planner.plan_fft_inverse(size);
        let mut spectrum = inverse.make_input_vec();
        let mut scratch = inverse.make_scratch_vec();
        let mut tables = Vec::with_capacity(ranges);
        let mut normalization = 1.0f32;
        for range in 0..ranges {
            let partials = ((half as f64) * (-(range as f64) * CENTS_PER_RANGE / 1200.0).exp2()) as usize;
            let partials = partials.clamp(1, half - 1);
            spectrum.iter_mut().for_each(|c| *c = Complex::new(0.0, 0.0));
            for (k, bin) in spectrum.iter_mut().enumerate().take(partials + 1).skip(1) {
                // The inverse transform sums X_k e^{iθ} over the whole (Hermitian) spectrum: X_k = -i b_k / 2 gives
                // b_k sin(kθ).
                *bin = Complex::new(0.0, (-coefficient(k) / 2.0) as f32);
            }
            let mut table = vec![0.0f32; size];
            if inverse.process_with_scratch(&mut spectrum, &mut table, &mut scratch).is_err() {
                table.fill(0.0);
            }
            if range == 0 {
                let peak = table.iter().fold(0.0f32, |p, x| p.max(x.abs()));
                if peak > 0.0 {
                    normalization = 1.0 / peak;
                }
            }
            table.iter_mut().for_each(|x| *x *= normalization);
            table.push(table[0]);
            tables.push(table);
        }
        WaveTables { size, tables, lowest: sample_rate as f64 / size as f64 }
    }

    /// The two tables for a fundamental of `frequency` Hz and the crossfade between them (Chrome's
    /// WaveDataForFundamentalFrequency: the table one range above the pitch, so no partial passes Nyquist).
    fn select(&self, frequency: f64) -> (usize, usize, f32) {
        let n = self.tables.len();
        if n == 1 {
            return (0, 0, 0.0);
        }
        let f = frequency.abs();
        let ratio = if f > 0.0 { f / self.lowest } else { 0.5 };
        let range = (1.0 + ratio.log2() * 1200.0 / CENTS_PER_RANGE).clamp(0.0, (n - 1) as f64);
        let i1 = range as usize;
        let i2 = (i1 + 1).min(n - 1);
        (i1, i2, (range - i1 as f64) as f32)
    }

    fn sample(&self, (i1, i2, factor): (usize, usize, f32), phase: f64) -> f32 {
        let pos = phase * self.size as f64;
        let i = (pos as usize).min(self.size - 1);
        let frac = (pos - i as f64) as f32;
        let read = |t: &Vec<f32>| t[i] + (t[i + 1] - t[i]) * frac;
        let a = read(&self.tables[i1]);
        if factor == 0.0 {
            return a;
        }
        let b = read(&self.tables[i2]);
        a + (b - a) * factor
    }
}

pub struct Oscillator {
    pub tables: Arc<WaveTables>,
    pub frequency: AudioParam,
    pub detune: AudioParam,
    pub sched: Schedule,
    /// The fraction of a period reached.
    phase: f64,
}

impl Oscillator {
    pub fn new(sample_rate: f32) -> Oscillator {
        let nyquist = sample_rate / 2.0;
        Oscillator {
            tables: WaveTables::get(OscillatorType::Sine, sample_rate),
            frequency: AudioParam::new(440.0, -nyquist, nyquist, Rate::A),
            detune: AudioParam::new(0.0, -153600.0, 153600.0, Rate::A),
            sched: Schedule::new(),
            phase: 0.0,
        }
    }

    pub fn set_tables(&mut self, tables: Arc<WaveTables>, trash: &mut Vec<Garbage>) {
        trash.push(Garbage::Tables(std::mem::replace(&mut self.tables, tables)));
    }

    fn computed(&self, i: usize, nyquist: f64) -> f64 {
        let f = self.frequency.values[i] as f64 * (self.detune.values[i] as f64 / 1200.0).exp2();
        if f.is_finite() { f.clamp(-nyquist, nyquist) } else { 0.0 }
    }

    /// Renders one quantum (mono); true when the oscillator stopped in it.
    pub fn process(&mut self, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) -> bool {
        self.frequency.compute(ctx.frame0, ctx.sample_rate, trash);
        self.detune.compute(ctx.frame0, ctx.sample_rate, trash);
        out.set_silent();
        let Some(when) = self.sched.start else { return false };
        if self.sched.ended {
            return false;
        }
        let stop = self.sched.stop;
        let t_end = ctx.time(QUANTUM);
        if t_end <= when && t_end < stop {
            return false;
        }
        let nyquist = ctx.sample_rate / 2.0;
        let constant = self.frequency.constant && self.detune.constant;
        let mut f = self.computed(0, nyquist);
        let mut select = self.tables.select(f);
        out.zeroed(1);
        let mut finished = false;
        for i in 0..QUANTUM {
            let t = ctx.time(i);
            if t < when {
                continue;
            }
            if t >= stop {
                finished = true;
                break;
            }
            if !constant {
                f = self.computed(i, nyquist);
                select = self.tables.select(f);
            }
            if !self.sched.started {
                // A start between two frames begins that far into the period.
                self.phase = ((t - when) * f).rem_euclid(1.0);
                self.sched.started = true;
            }
            out.ch[0][i] = self.tables.sample(select, self.phase);
            self.phase += f / ctx.sample_rate;
            self.phase -= self.phase.floor();
        }
        if finished || t_end >= stop {
            self.sched.ended = true;
            return true;
        }
        false
    }
}
