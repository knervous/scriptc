//! DynamicsCompressorNode, as Chrome's DynamicsCompressorKernel computes it: a 6 ms look-ahead (the input is delayed
//! while the gain is computed from the undelayed peak), a static curve linear to the threshold, then an exponential
//! knee whose slope meets 1/ratio at threshold + knee, then the ratio; attack and an adaptive release (faster the deeper
//! the compression) on the gain envelope, every 32 frames; the sine warp of the gain; and the spec's makeup gain
//! (Chrome's: (1 / the curve's output at 0 dBFS) ^ 0.6). Its params are k-rate.

use crate::bus::Bus;
use crate::graph::Garbage;
use crate::nodes::Ctx;
use crate::param::{AudioParam, QUANTUM, Rate};

const DIVISION: usize = 32;
const MAX_PRE_DELAY: usize = 1024;
const MASK: usize = MAX_PRE_DELAY - 1;
const PRE_DELAY_SECONDS: f64 = 0.006;
const RELEASE_ZONES: [f32; 4] = [0.09, 0.16, 0.42, 0.98];
const SAT_RELEASE_SECONDS: f32 = 0.0025;
const FRAC_PI_2: f32 = std::f32::consts::FRAC_PI_2;

fn db_to_linear(db: f32) -> f32 {
    10f32.powf(0.05 * db)
}
fn linear_to_db(x: f32) -> f32 {
    if x <= 0.0 { -1000.0 } else { 20.0 * x.log10() }
}

/// The static curve for the current threshold, knee and ratio (recomputed only when they change).
struct Curve {
    db_threshold: f32,
    db_knee: f32,
    ratio: f32,
    linear_threshold: f32,
    slope: f32,
    knee_threshold: f32,
    knee_threshold_db: f32,
    y_knee_threshold_db: f32,
    k: f32,
}

impl Curve {
    fn new() -> Curve {
        Curve {
            db_threshold: f32::NAN,
            db_knee: f32::NAN,
            ratio: f32::NAN,
            linear_threshold: 0.0,
            slope: 1.0,
            knee_threshold: 0.0,
            knee_threshold_db: 0.0,
            y_knee_threshold_db: 0.0,
            k: 1.0,
        }
    }

    fn knee_curve(&self, x: f32, k: f32) -> f32 {
        if x < self.linear_threshold {
            return x;
        }
        self.linear_threshold + (1.0 - (-k * (x - self.linear_threshold)).exp()) / k
    }

    fn saturate(&self, x: f32, k: f32) -> f32 {
        if x < self.knee_threshold {
            self.knee_curve(x, k)
        } else {
            let x_db = linear_to_db(x);
            let y_db = self.y_knee_threshold_db + self.slope * (x_db - self.knee_threshold_db);
            db_to_linear(y_db)
        }
    }

    fn slope_at(&self, x: f32, k: f32) -> f32 {
        if x < self.linear_threshold {
            return 1.0;
        }
        let x2 = x * 1.001;
        let (x_db, x2_db) = (linear_to_db(x), linear_to_db(x2));
        let (y_db, y2_db) = (linear_to_db(self.knee_curve(x, k)), linear_to_db(self.knee_curve(x2, k)));
        (y2_db - y_db) / (x2_db - x_db)
    }

    fn k_at_slope(&self, desired_slope: f32) -> f32 {
        let x = db_to_linear(self.db_threshold + self.db_knee);
        let (mut min_k, mut max_k, mut k) = (0.1f32, 10000.0f32, 5.0f32);
        for _ in 0..15 {
            if self.slope_at(x, k) < desired_slope {
                max_k = k;
            } else {
                min_k = k;
            }
            k = (min_k * max_k).sqrt();
        }
        k
    }

    fn update(&mut self, db_threshold: f32, db_knee: f32, ratio: f32) -> f32 {
        if db_threshold != self.db_threshold || db_knee != self.db_knee || ratio != self.ratio {
            self.db_threshold = db_threshold;
            self.linear_threshold = db_to_linear(db_threshold);
            self.db_knee = db_knee;
            self.ratio = ratio;
            self.slope = 1.0 / ratio;
            let k = self.k_at_slope(1.0 / ratio);
            self.knee_threshold_db = db_threshold + db_knee;
            self.knee_threshold = db_to_linear(self.knee_threshold_db);
            self.y_knee_threshold_db = linear_to_db(self.knee_curve(self.knee_threshold, k));
            self.k = k;
        }
        self.k
    }
}

/// The static curve's output for a level `x` (linear) and the makeup gain, both linear (the examples' reference).
pub fn static_curve(db_threshold: f32, db_knee: f32, ratio: f32, x: f32) -> (f32, f32) {
    let mut curve = Curve::new();
    let k = curve.update(db_threshold, db_knee, ratio);
    (curve.saturate(x, k), (1.0 / curve.saturate(1.0, k)).powf(0.6))
}

pub struct Compressor {
    pub threshold: AudioParam,
    pub knee: AudioParam,
    pub ratio: AudioParam,
    pub attack: AudioParam,
    pub release: AudioParam,
    curve: Curve,
    pre_delay: [[f32; MAX_PRE_DELAY]; 2],
    read: usize,
    write: usize,
    detector_average: f32,
    compressor_gain: f32,
    max_attack_compression_diff_db: f32,
    channels: usize,
    /// Frames still to process after the input went silent: the look-ahead to flush and the gain to recover.
    tail_left: f64,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Compressor {
        let pre_delay_frames = ((PRE_DELAY_SECONDS * sample_rate as f64) as usize).min(MAX_PRE_DELAY - 1);
        Compressor {
            threshold: AudioParam::new(-24.0, -100.0, 0.0, Rate::K),
            knee: AudioParam::new(30.0, 0.0, 40.0, Rate::K),
            ratio: AudioParam::new(12.0, 1.0, 20.0, Rate::K),
            attack: AudioParam::new(0.003, 0.0, 1.0, Rate::K),
            release: AudioParam::new(0.25, 0.0, 1.0, Rate::K),
            curve: Curve::new(),
            pre_delay: [[0.0; MAX_PRE_DELAY]; 2],
            read: 0,
            write: pre_delay_frames,
            detector_average: 0.0,
            compressor_gain: 1.0,
            max_attack_compression_diff_db: -1.0,
            channels: 1,
            tail_left: 0.0,
        }
    }

    pub fn quiet(&self) -> bool {
        self.tail_left <= 0.0
    }

    pub fn process(&mut self, input: &Bus, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) {
        for p in [&mut self.threshold, &mut self.knee, &mut self.ratio, &mut self.attack, &mut self.release] {
            p.compute(ctx.frame0, ctx.sample_rate, trash);
        }
        let sample_rate = ctx.sample_rate as f32;
        let release_time = self.release.first();
        if input.silent() {
            if self.tail_left <= 0.0 {
                out.set_silent();
                return;
            }
            self.tail_left -= QUANTUM as f64;
        } else {
            self.tail_left = PRE_DELAY_SECONDS * ctx.sample_rate + 2.0 * release_time as f64 * ctx.sample_rate + QUANTUM as f64;
            if input.channels == 2 && self.channels == 1 {
                self.pre_delay[1] = self.pre_delay[0];
            }
            self.channels = input.channels;
        }
        let channels = self.channels;
        out.channels = channels;

        let k = self.curve.update(self.threshold.first(), self.knee.first(), self.ratio.first());
        let full_range_gain = self.curve.saturate(1.0, k);
        let full_range_makeup_gain = (1.0 / full_range_gain).powf(0.6);
        let master_linear_gain = full_range_makeup_gain;
        let attack_frames = self.attack.first().max(0.001) * sample_rate;
        let release_frames = sample_rate * release_time;
        let sat_release_frames = SAT_RELEASE_SECONDS * sample_rate;

        // The adaptive release: a 4th order polynomial through the four zones' release times (Chrome's fit).
        let [y1, y2, y3, y4] = RELEASE_ZONES.map(|z| (z * release_frames) as f64);
        let ka = 0.999_999_999_999_999_8 * y1 + 1.843_221_968_432_392_3e-16 * y2 - 1.937_339_435_167_642_3e-16 * y3
            + 8.824_516_011_816_245e-18 * y4;
        let kb = -1.578_832_035_284_588_8 * y1 + 2.330_583_703_207_428_6 * y2 - 0.914_119_420_484_042_9 * y3
            + 0.162_367_752_561_203_2 * y4;
        let kc = 0.533_414_286_910_642_4 * y1 - 1.272_736_789_213_631 * y2 + 0.925_885_604_220_751_2 * y3
            - 0.186_563_101_917_762_26 * y4;
        let kd = 0.087_834_631_382_072_34 * y1 - 0.169_416_296_792_562_2 * y2 + 0.085_880_579_515_952_72 * y3
            - 0.004_298_914_105_462_83 * y4;
        let ke = -0.042_416_883_008_123_074 * y1 + 0.111_569_382_798_760_2 * y2 - 0.097_646_763_252_658_72 * y3
            + 0.028_494_263_462_021_576 * y4;

        let mut frame = 0;
        for _ in 0..QUANTUM / DIVISION {
            if !self.detector_average.is_finite() {
                self.detector_average = 1.0;
            }
            let desired_gain = self.detector_average;
            // Pre-warped so the sine warp below lands on the desired gain.
            let scaled_desired_gain = desired_gain.clamp(-1.0, 1.0).asin() / FRAC_PI_2;
            let is_releasing = scaled_desired_gain > self.compressor_gain;
            let mut compression_diff_db = linear_to_db(self.compressor_gain / scaled_desired_gain);
            let envelope_rate = if is_releasing {
                self.max_attack_compression_diff_db = -1.0;
                if !compression_diff_db.is_finite() {
                    compression_diff_db = -1.0;
                }
                // Higher compression releases faster: -12..0 dB mapped to 0..3 along the polynomial.
                let x = 0.25 * (compression_diff_db.clamp(-12.0, 0.0) + 12.0);
                let x = x as f64;
                let release_frames = (ka + kb * x + kc * x * x + kd * x * x * x + ke * x * x * x * x) as f32;
                let db_per_frame = 5.0 / release_frames;
                db_to_linear(db_per_frame)
            } else {
                if !compression_diff_db.is_finite() {
                    compression_diff_db = 1.0;
                }
                if self.max_attack_compression_diff_db == -1.0 || self.max_attack_compression_diff_db < compression_diff_db {
                    self.max_attack_compression_diff_db = compression_diff_db;
                }
                let eff_atten_diff_db = self.max_attack_compression_diff_db.max(0.5);
                let x = 0.25 / eff_atten_diff_db;
                1.0 - x.powf(1.0 / attack_frames)
            };

            for _ in 0..DIVISION {
                let mut compressor_input = 0.0f32;
                for c in 0..channels {
                    let x = if input.silent() { 0.0 } else { input.ch[c][frame] };
                    self.pre_delay[c][self.write] = x;
                    compressor_input = compressor_input.max(x.abs());
                }
                let abs_input = compressor_input;
                let shaped_input = self.curve.saturate(abs_input, k);
                let attenuation = if abs_input <= 0.0001 { 1.0 } else { shaped_input / abs_input };
                let attenuation_db = (-linear_to_db(attenuation)).max(2.0);
                let db_per_frame = attenuation_db / sat_release_frames;
                let sat_release_rate = db_to_linear(db_per_frame) - 1.0;
                let rate = if attenuation > self.detector_average { sat_release_rate } else { 1.0 };
                self.detector_average += (attenuation - self.detector_average) * rate;
                self.detector_average = self.detector_average.min(1.0);
                if !self.detector_average.is_finite() {
                    self.detector_average = 1.0;
                }
                if envelope_rate < 1.0 {
                    self.compressor_gain += (scaled_desired_gain - self.compressor_gain) * envelope_rate;
                } else {
                    self.compressor_gain = (self.compressor_gain * envelope_rate).min(1.0);
                }
                let post_warp_compressor_gain = (FRAC_PI_2 * self.compressor_gain).sin();
                let total_gain = master_linear_gain * post_warp_compressor_gain;
                for c in 0..channels {
                    out.ch[c][frame] = self.pre_delay[c][self.read] * total_gain;
                }
                frame += 1;
                self.read = (self.read + 1) & MASK;
                self.write = (self.write + 1) & MASK;
            }
        }
    }
}
