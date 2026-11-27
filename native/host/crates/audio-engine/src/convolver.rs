//! ConvolverNode: partitioned FFT convolution with no latency, in two stages so a reverb of a few seconds costs little.
//!
//! The head stage convolves each quantum with the impulse response's first 4096 frames in 128-frame partitions
//! (uniformly partitioned overlap-save: a 256-point FFT of the last two quanta of input, a frequency-domain delay line,
//! a multiply-add per partition, one inverse FFT), its output in the same quantum. The tail stage convolves the rest in
//! 4096-frame partitions, transformed once every 32 quanta when a block of input is complete; its output is due a
//! block later, which is exactly where the response's tail starts, so the sum has no latency either.
//!
//! The kernel (the response's partitions, transformed and normalized) and every buffer are made on the page thread when
//! a buffer is set (`ConvolverState::new`), so the render thread only swaps it in. Channels follow the spec's matrix: a
//! mono input with a mono response gives mono; a stereo input convolves each side with a mono response, or with its own
//! channel of a stereo one (a mono input up-mixed to stereo first); a four-channel response is "true stereo".

use std::sync::Arc;

use realfft::num_complex::Complex;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};

use crate::BufferData;
use crate::bus::Bus;
use crate::param::QUANTUM;

const HEAD_BLOCK: usize = QUANTUM;
const HEAD_PARTS: usize = 32;
const TAIL_BLOCK: usize = 4096;

/// The spec's normalization scale for a response (calculateNormalizationScale).
pub fn normalization_scale(buffer: &BufferData) -> f32 {
    const GAIN_CALIBRATION: f64 = 0.00125;
    const GAIN_CALIBRATION_SAMPLE_RATE: f64 = 44100.0;
    const MIN_POWER: f64 = 0.000125;
    let channels = buffer.channels.len();
    let length = buffer.frames();
    let mut power = 0.0f64;
    for c in &buffer.channels {
        power += c.iter().map(|&x| x as f64 * x as f64).sum::<f64>();
    }
    let mut power = (power / (channels * length) as f64).sqrt();
    if !power.is_finite() || power < MIN_POWER {
        power = MIN_POWER;
    }
    let mut scale = 1.0 / power * GAIN_CALIBRATION;
    if buffer.sample_rate > 0.0 {
        scale *= GAIN_CALIBRATION_SAMPLE_RATE / buffer.sample_rate as f64;
    }
    if channels == 4 {
        scale *= 0.5;
    }
    scale as f32
}

/// One partition size's convolution: the response's partitions transformed, and the input's spectra so far.
struct Stage {
    block: usize,
    bins: usize,
    parts: usize,
    /// Response spectra: [response channel][partition][bin], scaled by the normalization and the inverse FFT's 1/N.
    h: Vec<Complex<f32>>,
    /// Input spectra, a ring per input channel: [input channel][partition][bin].
    fdl: Vec<Complex<f32>>,
    pos: usize,
    /// Per input channel: the previous block of input then the one being filled.
    window: [Vec<f32>; 2],
    fill: usize,
    /// Per output channel: the block of output being played out.
    out: [Vec<f32>; 2],
    forward: Arc<dyn RealToComplex<f32>>,
    inverse: Arc<dyn ComplexToReal<f32>>,
    time: Vec<f32>,
    acc: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
}

impl Stage {
    /// The stage for the response's frames `from..from + parts * block`.
    fn new(ir: &[Vec<f32>], from: usize, parts: usize, block: usize, scale: f32, planner: &mut RealFftPlanner<f32>) -> Stage {
        let n = 2 * block;
        let bins = block + 1;
        let forward = planner.plan_fft_forward(n);
        let inverse = planner.plan_fft_inverse(n);
        let scratch_len = forward.get_scratch_len().max(inverse.get_scratch_len());
        let mut h = vec![Complex::new(0.0, 0.0); ir.len() * parts * bins];
        let mut time = vec![0.0f32; n];
        let mut scratch = vec![Complex::new(0.0, 0.0); scratch_len];
        let k = scale / n as f32;
        for (c, channel) in ir.iter().enumerate() {
            for p in 0..parts {
                time.fill(0.0);
                let start = from + p * block;
                let end = (start + block).min(channel.len());
                if start < end {
                    for (t, &x) in time.iter_mut().zip(&channel[start..end]) {
                        *t = x * k;
                    }
                }
                let at = (c * parts + p) * bins;
                let _ = forward.process_with_scratch(&mut time, &mut h[at..at + bins], &mut scratch);
            }
        }
        Stage {
            block,
            bins,
            parts,
            h,
            fdl: vec![Complex::new(0.0, 0.0); 2 * parts * bins],
            pos: 0,
            window: [vec![0.0; n], vec![0.0; n]],
            fill: 0,
            out: [vec![0.0; block], vec![0.0; block]],
            forward,
            inverse,
            time,
            acc: vec![Complex::new(0.0, 0.0); bins],
            scratch,
        }
    }

    /// Adds a quantum of input (per input channel; `mono` when the second is a copy of the first). When a block is
    /// complete, transforms it and computes the next block of output along `paths` (input, response, output channel).
    fn push(&mut self, input: [&[f32; QUANTUM]; 2], mono: bool, paths: &[(usize, usize, usize)]) {
        let b = self.block;
        for (window, input) in self.window.iter_mut().zip(input) {
            window[b + self.fill..b + self.fill + QUANTUM].copy_from_slice(input);
        }
        self.fill += QUANTUM;
        if self.fill < b {
            return;
        }
        self.fill = 0;
        let bins = self.bins;
        let parts = self.parts;
        // The new block's spectrum into each input channel's delay line.
        for c in 0..2 {
            let at = (c * parts + self.pos) * bins;
            if c == 1 && mono {
                self.fdl.copy_within(self.pos * bins..(self.pos + 1) * bins, at);
            } else {
                self.time.copy_from_slice(&self.window[c]);
                let _ = self.forward.process_with_scratch(&mut self.time, &mut self.fdl[at..at + bins], &mut self.scratch);
            }
            self.window[c].copy_within(b.., 0);
        }
        // Each output channel: the sum over its paths and partitions, then back to time; the last half is the output.
        for out_c in 0..2 {
            if !paths.iter().any(|p| p.2 == out_c) {
                continue;
            }
            self.acc.fill(Complex::new(0.0, 0.0));
            for &(in_c, ir_c, _) in paths.iter().filter(|p| p.2 == out_c) {
                for p in 0..parts {
                    let slot = (self.pos + parts - p) % parts;
                    let x = &self.fdl[(in_c * parts + slot) * bins..][..bins];
                    let h = &self.h[(ir_c * parts + p) * bins..][..bins];
                    for ((a, x), h) in self.acc.iter_mut().zip(x).zip(h) {
                        *a += x * h;
                    }
                }
            }
            // The inverse transform needs real values at DC and Nyquist (they are, up to rounding).
            self.acc[0].im = 0.0;
            self.acc[bins - 1].im = 0.0;
            let _ = self.inverse.process_with_scratch(&mut self.acc, &mut self.time, &mut self.scratch);
            self.out[out_c].copy_from_slice(&self.time[b..]);
        }
        self.pos = (self.pos + 1) % parts;
    }
}

pub struct ConvolverState {
    ir_channels: usize,
    head: Stage,
    tail: Option<Stage>,
    /// Frames to keep rendering after the input went silent: the response's length and the tail stage's delay.
    ring: usize,
    tail_left: usize,
    channels: usize,
}

impl ConvolverState {
    /// The kernel for `buffer` (made on the page thread): resampled linearly if its rate is not the context's, and
    /// normalized when `normalize` (read now, as the spec has it: when the buffer is set).
    pub fn new(buffer: &BufferData, normalize: bool, sample_rate: f32) -> Option<Box<ConvolverState>> {
        if buffer.frames() == 0 || buffer.channels.is_empty() {
            return None;
        }
        let scale = if normalize { normalization_scale(buffer) } else { 1.0 };
        let ir_channels = match buffer.channels.len() {
            4 => 4,
            1 => 1,
            _ => 2,
        };
        let mut ir: Vec<Vec<f32>> = buffer.channels[..ir_channels].to_vec();
        if buffer.sample_rate > 0.0 && buffer.sample_rate != sample_rate {
            ir = ir.iter().map(|c| resample(c, buffer.sample_rate as f64, sample_rate as f64)).collect();
        }
        let length = ir.iter().map(Vec::len).max().unwrap_or(0);
        let mut planner = RealFftPlanner::<f32>::new();
        let head_parts = length.div_ceil(HEAD_BLOCK).clamp(1, HEAD_PARTS);
        let head = Stage::new(&ir, 0, head_parts, HEAD_BLOCK, scale, &mut planner);
        let head_len = HEAD_PARTS * HEAD_BLOCK;
        let tail = (length > head_len).then(|| {
            let parts = (length - head_len).div_ceil(TAIL_BLOCK);
            Stage::new(&ir, head_len, parts, TAIL_BLOCK, scale, &mut planner)
        });
        let ring = length + 2 * TAIL_BLOCK + 2 * QUANTUM;
        Some(Box::new(ConvolverState { ir_channels, head, tail, ring, tail_left: 0, channels: 1 }))
    }

    fn process(&mut self, input: &Bus, out: &mut Bus) {
        const ZERO: [f32; QUANTUM] = [0.0; QUANTUM];
        if input.silent() {
            if self.tail_left == 0 {
                out.set_silent();
                return;
            }
            self.tail_left = self.tail_left.saturating_sub(QUANTUM);
        } else {
            self.tail_left = self.ring;
            self.channels = input.channels;
        }
        let mono = self.channels == 1;
        let paths: &[(usize, usize, usize)] = match (self.ir_channels, mono) {
            (1, true) => &[(0, 0, 0)],
            (1, false) => &[(0, 0, 0), (1, 0, 1)],
            (4, _) => &[(0, 0, 0), (0, 1, 1), (1, 2, 0), (1, 3, 1)],
            _ => &[(0, 0, 0), (1, 1, 1)],
        };
        let out_channels = if self.ir_channels == 1 && mono { 1 } else { 2 };
        let (l, r) = if input.silent() {
            (&ZERO, &ZERO)
        } else if mono {
            (&input.ch[0], &input.ch[0])
        } else {
            (&input.ch[0], &input.ch[1])
        };
        // The tail stage's block in progress was computed a block ago: play its part for this quantum first.
        out.zeroed(out_channels);
        if let Some(tail) = &mut self.tail {
            let at = tail.fill;
            for c in 0..out_channels {
                out.ch[c].copy_from_slice(&tail.out[c][at..at + QUANTUM]);
            }
            tail.push([l, r], mono, paths);
        }
        self.head.push([l, r], mono, paths);
        for c in 0..out_channels {
            for (o, h) in out.ch[c].iter_mut().zip(&self.head.out[c]) {
                *o += h;
            }
        }
    }
}

fn resample(data: &[f32], from: f64, to: f64) -> Vec<f32> {
    let frames = ((data.len() as f64) * to / from).round().max(1.0) as usize;
    (0..frames)
        .map(|i| {
            let pos = i as f64 * from / to;
            let i0 = (pos as usize).min(data.len() - 1);
            let i1 = (i0 + 1).min(data.len() - 1);
            let frac = (pos - i0 as f64) as f32;
            data[i0] + (data[i1] - data[i0]) * frac
        })
        .collect()
}

pub struct Convolver {
    pub state: Option<Box<ConvolverState>>,
}

impl Convolver {
    pub fn new() -> Convolver {
        Convolver { state: None }
    }

    pub fn quiet(&self) -> bool {
        self.state.as_ref().is_none_or(|s| s.tail_left == 0)
    }

    pub fn process(&mut self, input: &Bus, out: &mut Bus) {
        match &mut self.state {
            Some(s) => s.process(input, out),
            None => out.set_silent(),
        }
    }
}
