//! Band-limited resampling of a whole clip: a Kaiser-windowed sinc, evaluated as a polyphase table.
//!
//! The filter: 48 zero crossings each side at the lower of the two rates (96 taps when upsampling, 106 for 48 to
//! 44.1 kHz), Kaiser beta 9 (about 90 dB of stopband), and the stopband starting at the lower rate's Nyquist, so
//! nothing aliases; the passband is flat to about 0.44 of the lower rate (19.4 kHz at 44.1 kHz). Chrome's
//! SincResampler is a 32-tap Blackman kernel, so this is at least as clean. The kernel is symmetric and centred, so
//! the output is not delayed.
//!
//! A rational ratio with a small denominator (every pair of common rates: 48 to 44.1 kHz is 147/160) gets one table
//! row per output phase, exactly; any other ratio interpolates between up to 1024 rows.
//!
//! Memory is bounded whatever the rates: the kernel's support stops growing past 16x downsampling (beyond that the
//! filter has fewer zero crossings, but such a ratio is no real file's), the table stays within TABLE_BUDGET, and the
//! output within crate::MAX_SAMPLES, allocated fallibly.

const ZERO_CROSSINGS: f64 = 48.0;
const BETA: f64 = 9.0;
/// The kernel's half-support, in input samples, at most: ZERO_CROSSINGS at 16x downsampling.
const MAX_HALF: usize = 768;
/// The table's size at most, in taps (4 MB): exact phases when they fit, else interpolated rows that do.
const TABLE_BUDGET: usize = 1 << 20;
const MAX_INTERPOLATED_PHASES: usize = 1024;
const MIN_INTERPOLATED_PHASES: usize = 64;
/// Rows are padded to a multiple of this, for the dot product's lanes.
const LANES: usize = 16;

/// The zeroth-order modified Bessel function of the first kind (the Kaiser window's), by its power series.
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..64 {
        term *= q / (k * k) as f64;
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

/// The polyphase table: `phases` rows (plus one when interpolated) of `width` taps.
struct Kernel {
    /// Half the support in input samples: row taps cover input offsets -half+1 ..= half around the output position.
    half: usize,
    width: usize,
    rows: Vec<f32>,
}

/// The kernel's half-support and padded row width for `scale` (the output rate over the input rate, at most 1).
fn support(scale: f64) -> (usize, usize) {
    let half = ((ZERO_CROSSINGS / scale).ceil() as usize).min(MAX_HALF);
    (half, (2 * half).div_ceil(LANES) * LANES)
}

impl Kernel {
    /// `scale` is the output rate over the input rate, at most 1 (the cutoff's fraction of the input's Nyquist).
    fn new(scale: f64, phases: usize, extra_row: bool) -> Kernel {
        let (half, width) = support(scale);
        // Transition width of a Kaiser design (cycles per input sample), centred so the stopband starts at the
        // output's Nyquist.
        let taps = (2 * half) as f64;
        let transition = (BETA / 0.1102 + 8.7 - 8.0) / (2.285 * 2.0 * std::f64::consts::PI * (taps - 1.0));
        let cutoff = (0.5 * scale - transition / 2.0).max(0.05 * scale);
        let i0_beta = bessel_i0(BETA);
        let n_rows = phases + extra_row as usize;
        let mut rows = vec![0f32; n_rows * width];
        let mut row = vec![0f64; 2 * half];
        for p in 0..n_rows {
            let frac = p as f64 / phases as f64;
            for (j, h) in row.iter_mut().enumerate() {
                // Tap j multiplies input sample i0 + j - half + 1, at time t from the output position.
                let t = (j as f64 - half as f64 + 1.0) - frac;
                let w = t / half as f64;
                *h = if w.abs() >= 1.0 {
                    0.0
                } else {
                    let x = 2.0 * cutoff * t;
                    let sinc = if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
                    2.0 * cutoff * sinc * bessel_i0(BETA * (1.0 - w * w).sqrt()) / i0_beta
                };
            }
            // Each row sums to exactly one: no ripple at DC between phases.
            let sum: f64 = row.iter().sum();
            for (out, h) in rows[p * width..].iter_mut().zip(&row) {
                *out = (h / sum) as f32;
            }
        }
        Kernel { half, width, rows }
    }

    fn row(&self, p: usize) -> &[f32] {
        &self.rows[p * self.width..(p + 1) * self.width]
    }
}

/// A dot product in LANES independent sums, which the compiler vectorizes (one running sum would be serial: float
/// addition is not reassociated).
#[inline(always)]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0f32; LANES];
    for (x, y) in a.as_chunks::<LANES>().0.iter().zip(b.as_chunks::<LANES>().0) {
        for k in 0..LANES {
            acc[k] += x[k] * y[k];
        }
    }
    acc.iter().sum()
}

/// How the output's positions map onto the input.
#[derive(Clone, Copy)]
enum Step {
    /// Output n sits at input n * m / l, phase (n * m) mod l: one table row per phase.
    Exact { m: u64, l: u64 },
    /// Output n sits at input n * step, between two of the `phases` + 1 interpolated rows.
    Interpolated { step: f64, phases: usize },
}

/// One channel: `padded` is the input with `half` zeros before it and at least `width` after.
#[inline(always)]
fn run(kernel: &Kernel, step: Step, padded: &[f32], out: &mut [f32]) {
    let width = kernel.width;
    match step {
        Step::Exact { m, l } => {
            let (whole, part) = ((m / l) as usize, (m % l) as usize);
            let (mut i0, mut p) = (0usize, 0usize);
            for y in out.iter_mut() {
                *y = dot(kernel.row(p), &padded[i0 + 1..i0 + 1 + width]);
                i0 += whole;
                p += part;
                if p >= l as usize {
                    p -= l as usize;
                    i0 += 1;
                }
            }
        }
        Step::Interpolated { step, phases } => {
            for (n, y) in out.iter_mut().enumerate() {
                let x = n as f64 * step;
                let i0 = x.floor() as usize;
                let f = (x - i0 as f64) * phases as f64;
                let p = (f as usize).min(phases - 1);
                let w = (f - p as f64) as f32;
                let window = &padded[i0 + 1..i0 + 1 + width];
                let (a, b) = (dot(kernel.row(p), window), dot(kernel.row(p + 1), window));
                *y = a + (b - a) * w;
            }
        }
    }
}

/// `run` compiled for AVX2 (eight lanes a register, against SSE's four): not the x86-64-v2 baseline, so chosen at
/// run time.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
fn run_avx2(kernel: &Kernel, step: Step, padded: &[f32], out: &mut [f32]) {
    run(kernel, step, padded, out)
}

/// A zeroed vector of `n` samples, or an error where a failed allocation would abort.
fn zeros(n: usize) -> Result<Vec<f32>, String> {
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| format!("out of memory resampling ({n} samples)"))?;
    v.resize(n, 0.0);
    Ok(v)
}

/// Resamples each channel from `from` Hz to `to` Hz. The output has ceil(len * to / from) frames.
pub fn resample(channels: &[Vec<f32>], from: u32, to: f64) -> Result<Vec<Vec<f32>>, String> {
    let len = channels.first().map_or(0, Vec::len);
    let scale = (to / from as f64).min(1.0);
    let (_, width) = support(scale);
    // The ratio as integers: `to` is an integer rate almost always (an AudioContext's rate is a float, but a whole
    // number in practice).
    let exact = (to.fract() == 0.0 && to <= u32::MAX as f64).then(|| {
        let to = to as u64;
        let g = gcd(from as u64, to);
        (from as u64 / g, to / g)
    });
    let step = match exact {
        Some((m, l)) if (l as usize).saturating_mul(width) <= TABLE_BUDGET => Step::Exact { m, l },
        _ => Step::Interpolated {
            step: from as f64 / to,
            phases: (TABLE_BUDGET / width).clamp(MIN_INTERPOLATED_PHASES, MAX_INTERPOLATED_PHASES),
        },
    };
    let (out_len, kernel) = match step {
        Step::Exact { m, l } => (((len as u64 * l).div_ceil(m)) as usize, Kernel::new(scale, l as usize, false)),
        Step::Interpolated { phases, .. } => ((len as f64 * to / from as f64).ceil() as usize, Kernel::new(scale, phases, true)),
    };
    if out_len.saturating_mul(channels.len()) > crate::MAX_SAMPLES {
        return Err(format!("resampled to {out_len} frames of {} channels, more than {} samples", channels.len(), crate::MAX_SAMPLES));
    }
    #[cfg(target_arch = "x86_64")]
    let avx2 = std::arch::is_x86_feature_detected!("avx2");

    channels
        .iter()
        .map(|input| {
            // Zeros before and after, so every window is a plain slice: padded[i0 + 1 ..] starts at input i0 - half + 1.
            let mut padded = zeros(kernel.half + len + kernel.width + 1)?;
            padded[kernel.half..kernel.half + len].copy_from_slice(input);
            let mut out = zeros(out_len)?;
            #[cfg(target_arch = "x86_64")]
            if avx2 {
                // SAFETY: the CPU has AVX2 (checked above).
                unsafe { run_avx2(&kernel, step, &padded, &mut out) };
                return Ok(out);
            }
            run(&kernel, step, &padded, &mut out);
            Ok(out)
        })
        .collect()
}
