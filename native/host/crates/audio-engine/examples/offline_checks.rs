//! Offline checks of the engine against the spec's numbers, then a small interactive-app-like graph rendered to a WAV.
//!
//! cargo run --release --example offline_checks -- [out.wav]
//!
//! Each check builds its own offline engine at 48 kHz, renders, and prints what it measured beside what the spec says;
//! the process exits non-zero when one fails.

use std::sync::Arc;
use std::time::Instant;

use audio_engine::{
    Attr, BiquadType, BufferData, DESTINATION, DistanceModel, Engine, Event, NodeKind, OscillatorType, Param, ParamEvent, reference,
};

const RATE: f32 = 48000.0;

struct Report {
    failures: u32,
}

impl Report {
    fn check(&mut self, name: &str, ok: bool, detail: String) {
        println!("[{}] {name}: {detail}", if ok { "pass" } else { "FAIL" });
        if !ok {
            self.failures += 1;
        }
    }
}

fn buffer(channels: Vec<Vec<f32>>) -> Arc<BufferData> {
    Arc::new(BufferData { sample_rate: RATE, channels })
}

/// A looping buffer of ones: a DC source.
fn dc(engine: &Engine) -> u32 {
    let src = engine.create(NodeKind::BufferSource);
    engine.set(src, Attr::Buffer(Some(buffer(vec![vec![1.0; 128]]))));
    engine.set(src, Attr::Loop(true));
    engine.start(src, 0.0, 0.0, None);
    src
}

fn left(out: &[f32], frame: usize) -> f32 {
    out[frame * 2]
}

fn right(out: &[f32], frame: usize) -> f32 {
    out[frame * 2 + 1]
}

/// A deterministic white noise in -1..1.
fn noise(frames: usize, seed: u32) -> Vec<f32> {
    let mut s = seed.wrapping_mul(2_654_435_761).max(1);
    (0..frames)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            (s as f32 / u32::MAX as f32) * 2.0 - 1.0
        })
        .collect()
}

fn rms(x: impl Iterator<Item = f32>) -> f64 {
    let (mut sum, mut n) = (0.0f64, 0usize);
    for v in x {
        sum += v as f64 * v as f64;
        n += 1;
    }
    (sum / n.max(1) as f64).sqrt()
}

fn automation(r: &mut Report) {
    let e = Engine::offline(RATE);
    let src = dc(&e);
    let g = e.create(NodeKind::Gain);
    e.connect(src, 0, g, 0);
    e.connect(g, 0, DESTINATION, 0);
    e.param(g, Param::Gain, ParamEvent::SetValueAtTime { value: 0.0, time: 0.0 });
    e.param(g, Param::Gain, ParamEvent::LinearRampToValueAtTime { value: 1.0, time: 0.5 });
    e.param(g, Param::Gain, ParamEvent::SetValueAtTime { value: 0.01, time: 0.75 });
    e.param(g, Param::Gain, ParamEvent::ExponentialRampToValueAtTime { value: 1.0, time: 1.75 });
    e.param(g, Param::Gain, ParamEvent::SetTargetAtTime { target: 0.0, time: 2.0, time_constant: 0.1 });
    let out = e.render(48000 * 3);
    let at = |f: usize| left(&out, f);
    r.check(
        "linear ramp",
        (at(12000) - 0.5).abs() < 1e-6 && (at(23999) - 23999.0 / 24000.0).abs() < 1e-6 && at(24000) == 1.0 && at(24001) == 1.0,
        format!("frame 12000 = {:.7} (0.5), 23999 = {:.7} ({:.7}), reaches {} at frame 24000 (0.5 s)", at(12000), at(23999), 23999.0 / 24000.0, at(24000)),
    );
    // 0.01 -> 1 over a second: 0.1 half way.
    r.check(
        "exponential ramp",
        (at(36000) - 0.01).abs() < 1e-7 && (at(36000 + 24000) - 0.1).abs() < 1e-5 && at(84000) == 1.0,
        format!("frame 36000 = {:.6} (0.01), 60000 = {:.6} (0.1), 84000 = {} (1)", at(36000), at(60000), at(84000)),
    );
    let expect = (-1.0f64).exp() as f32;
    r.check(
        "setTargetAtTime",
        (at(96000 + 4800) - expect).abs() < 1e-5,
        format!("one time constant in: {:.6} (1/e = {:.6})", at(96000 + 4800), expect),
    );
    // cancelAndHold in a ramp holds the value it had reached.
    let e = Engine::offline(RATE);
    let src = dc(&e);
    let g = e.create(NodeKind::Gain);
    e.connect(src, 0, g, 0);
    e.connect(g, 0, DESTINATION, 0);
    e.param(g, Param::Gain, ParamEvent::SetValueAtTime { value: 0.0, time: 0.0 });
    e.param(g, Param::Gain, ParamEvent::LinearRampToValueAtTime { value: 1.0, time: 1.0 });
    e.param(g, Param::Gain, ParamEvent::CancelAndHoldAtTime { time: 0.25 });
    let out = e.render(48000);
    r.check(
        "cancelAndHoldAtTime",
        (left(&out, 12000) - 0.25).abs() < 1e-6 && (left(&out, 40000) - 0.25).abs() < 1e-6,
        format!("held at {:.6} after 0.25 s (0.25)", left(&out, 40000)),
    );
}

fn lowpass(r: &mut Report) {
    for (cutoff, q, tone) in [(1000.0, 0.0, 4000.0), (1000.0, 0.0, 200.0), (2000.0, 6.0, 2000.0)] {
        let e = Engine::offline(RATE);
        let osc = e.create(NodeKind::Oscillator);
        e.param(osc, Param::Frequency, ParamEvent::Value(tone as f32));
        let f = e.create(NodeKind::BiquadFilter);
        e.set(f, Attr::BiquadType(BiquadType::Lowpass));
        e.param(f, Param::Frequency, ParamEvent::Value(cutoff as f32));
        e.param(f, Param::Q, ParamEvent::Value(q as f32));
        e.connect(osc, 0, f, 0);
        e.connect(f, 0, DESTINATION, 0);
        e.start(osc, 0.0, 0.0, None);
        let out = e.render(48000);
        let measured = rms((24000..48000).map(|i| left(&out, i))) / (0.5f64).sqrt();
        let expected = reference::biquad_magnitude(BiquadType::Lowpass, cutoff, q, 0.0, RATE as f64, tone);
        let db = |x: f64| 20.0 * x.log10();
        r.check(
            &format!("lowpass {cutoff} Hz Q {q} dB on {tone} Hz"),
            (db(measured) - db(expected)).abs() < 0.05,
            format!("{:.3} dB (cookbook {:.3} dB)", db(measured), db(expected)),
        );
    }
}

fn ended(r: &mut Report) {
    let e = Engine::offline(RATE);
    // A 1000-frame buffer starting at frame 480: its last frame is 1479, in quantum 11 (frames 1408..1535).
    let src = e.create(NodeKind::BufferSource);
    e.set(src, Attr::Buffer(Some(buffer(vec![vec![0.5; 1000]]))));
    e.connect(src, 0, DESTINATION, 0);
    e.start(src, 0.01, 0.0, None);
    // An oscillator stopped at 0.1 s (frame 4800, in quantum 37).
    let osc = e.create(NodeKind::Oscillator);
    e.connect(osc, 0, DESTINATION, 0);
    e.start(osc, 0.0, 0.0, None);
    e.stop(osc, 0.1);
    let mut src_quantum = None;
    let mut osc_quantum = None;
    let mut out = Vec::new();
    for q in 0..48 {
        out.extend(e.render(128));
        for ev in e.take_events() {
            let Event::Ended(id) = ev;
            if id == src {
                src_quantum = Some(q);
            }
            if id == osc {
                osc_quantum = Some(q);
            }
        }
    }
    r.check(
        "buffer source plays out",
        src_quantum == Some(11),
        format!("ended in quantum {src_quantum:?} (11: the last frame, 1479, is in frames 1408..1535)"),
    );
    r.check("oscillator stop", osc_quantum == Some(37), format!("ended in quantum {osc_quantum:?} (37: stop at frame 4800)"));
    let silent_after = (4800..6144).all(|i| left(&out, i) == 0.0);
    let sounding_before = (4700..4800).any(|i| left(&out, i) != 0.0);
    r.check("oscillator silent from its stop frame", silent_after && sounding_before, format!("sounding before 4800: {sounding_before}, silent from 4800: {silent_after}"));

    // Sub-sample start: a ramp buffer (value = frame index) started half a frame after frame 100.
    let e = Engine::offline(RATE);
    let src = e.create(NodeKind::BufferSource);
    e.set(src, Attr::Buffer(Some(buffer(vec![(0..1000).map(|i| i as f32).collect()]))));
    e.connect(src, 0, DESTINATION, 0);
    e.start(src, 100.5 / RATE as f64, 10.0 / RATE as f64, None);
    let out = e.render(256);
    r.check(
        "sub-sample start",
        left(&out, 100) == 0.0 && (left(&out, 101) - 10.5).abs() < 1e-3 && (left(&out, 102) - 11.5).abs() < 1e-3,
        format!("frame 100 = {}, 101 = {:.4} (10.5), 102 = {:.4} (11.5)", left(&out, 100), left(&out, 101), left(&out, 102)),
    );
    // playbackRate 0.5 and a buffer at half the context's rate both read between frames.
    let e = Engine::offline(RATE);
    let src = e.create(NodeKind::BufferSource);
    e.set(src, Attr::Buffer(Some(Arc::new(BufferData { sample_rate: 24000.0, channels: vec![(0..1000).map(|i| i as f32).collect()] }))));
    e.param(src, Param::PlaybackRate, ParamEvent::Value(0.5));
    e.connect(src, 0, DESTINATION, 0);
    e.start(src, 0.0, 0.0, None);
    let out = e.render(256);
    r.check(
        "rate conversion and playbackRate",
        (left(&out, 4) - 1.0).abs() < 1e-6 && (left(&out, 5) - 1.25).abs() < 1e-6,
        format!("frame 4 = {} (1), frame 5 = {} (1.25)", left(&out, 4), left(&out, 5)),
    );
    // A loop between 0.25 and 0.5 of a 1-frame-per-value buffer.
    let e = Engine::offline(RATE);
    let src = e.create(NodeKind::BufferSource);
    e.set(src, Attr::Buffer(Some(buffer(vec![(0..480).map(|i| i as f32).collect()]))));
    e.set(src, Attr::Loop(true));
    e.set(src, Attr::LoopStart(100.0 / RATE as f64));
    e.set(src, Attr::LoopEnd(200.0 / RATE as f64));
    e.connect(src, 0, DESTINATION, 0);
    e.start(src, 0.0, 0.0, None);
    let out = e.render(512);
    r.check(
        "loop points",
        left(&out, 199) == 199.0 && left(&out, 200) == 100.0 && left(&out, 300) == 100.0,
        format!("frame 199 = {}, 200 = {} (loops to 100), 300 = {}", left(&out, 199), left(&out, 200), left(&out, 300)),
    );
}

fn compressor(r: &mut Report) {
    // A master limiter on a sine 12 dB over full scale.
    let e = Engine::offline(RATE);
    let osc = e.create(NodeKind::Oscillator);
    e.param(osc, Param::Frequency, ParamEvent::Value(220.0));
    let hot = e.create(NodeKind::Gain);
    e.param(hot, Param::Gain, ParamEvent::Value(4.0));
    let c = e.create(NodeKind::DynamicsCompressor);
    e.param(c, Param::Threshold, ParamEvent::Value(-3.0));
    e.param(c, Param::Knee, ParamEvent::Value(0.0));
    e.param(c, Param::Ratio, ParamEvent::Value(20.0));
    e.param(c, Param::Attack, ParamEvent::Value(0.003));
    e.param(c, Param::Release, ParamEvent::Value(0.15));
    e.connect(osc, 0, hot, 0);
    e.connect(hot, 0, c, 0);
    e.connect(c, 0, DESTINATION, 0);
    e.start(osc, 0.0, 0.0, None);
    let out = e.render(48000);
    let peak = |a: usize, b: usize| (a..b).map(|i| left(&out, i).abs()).fold(0.0f32, f32::max);
    let db = |x: f32| 20.0 * x.log10();
    let (attack, steady) = (peak(0, 4800), peak(24000, 48000));
    r.check(
        "limiter holds +12 dBFS under 0 dBFS",
        steady < 1.0,
        format!("input peak +12.04 dBFS; output peak {:.2} dBFS steady, {:.2} dBFS in the first 100 ms (attack)", db(steady), db(attack)),
    );
    // The defaults (-24 dB, knee 30, 12:1) on a -6 dBFS sine: some gain reduction, made up partly.
    let e = Engine::offline(RATE);
    let osc = e.create(NodeKind::Oscillator);
    let g = e.create(NodeKind::Gain);
    e.param(g, Param::Gain, ParamEvent::Value(0.5));
    let c = e.create(NodeKind::DynamicsCompressor);
    e.connect(osc, 0, g, 0);
    e.connect(g, 0, c, 0);
    e.connect(c, 0, DESTINATION, 0);
    e.start(osc, 0.0, 0.0, None);
    let out = e.render(48000);
    let steady = (24000..48000).map(|i| left(&out, i).abs()).fold(0.0f32, f32::max);
    let (curve, makeup) = reference::compressor_curve(-24.0, 30.0, 12.0, 0.5);
    let expected = curve * makeup;
    r.check(
        "compressor defaults on -6 dBFS (static curve)",
        (db(steady) - db(expected)).abs() < 1.0,
        format!("output peak {:.2} dBFS; the curve gives {:.2} dB, +{:.2} dB makeup = {:.2} dBFS", db(steady), db(curve), db(makeup), db(expected)),
    );
    let (curve, makeup) = reference::compressor_curve(-3.0, 0.0, 20.0, 4.0);
    println!("       (limiter's curve at +12.04 dBFS: {:.2} dB, makeup +{:.2} dB = {:.2} dBFS)", db(curve), db(makeup), db(curve * makeup));
}

fn convolver(r: &mut Report) {
    // A mono response long enough to use both stages (head 4096 frames, tail in 4096-frame partitions).
    for (ir_len, input_len) in [(1000usize, 3000usize), (11000, 20000)] {
        let e = Engine::offline(RATE);
        let ir: Vec<f32> = noise(ir_len, 7).iter().enumerate().map(|(i, x)| x * (-(i as f32) / 3000.0).exp()).collect();
        let input = noise(input_len, 3);
        let src = e.create(NodeKind::BufferSource);
        e.set(src, Attr::Buffer(Some(buffer(vec![input.clone()]))));
        let conv = e.create(NodeKind::Convolver);
        e.set(conv, Attr::Normalize(false));
        e.set(conv, Attr::Buffer(Some(buffer(vec![ir.clone()]))));
        e.connect(src, 0, conv, 0);
        e.connect(conv, 0, DESTINATION, 0);
        e.start(src, 0.0, 0.0, None);
        let frames = (input_len + ir_len).div_ceil(128) * 128 + 128;
        let out = e.render(frames);
        let mut max_err = 0.0f64;
        let mut max_ref = 0.0f64;
        for n in 0..input_len + ir_len - 1 {
            let mut y = 0.0f64;
            for (k, &h) in ir.iter().enumerate() {
                if n >= k && n - k < input_len {
                    y += h as f64 * input[n - k] as f64;
                }
            }
            max_ref = max_ref.max(y.abs());
            max_err = max_err.max((y - left(&out, n) as f64).abs()).max((y - right(&out, n) as f64).abs());
        }
        r.check(
            &format!("convolver = naive convolution ({ir_len}-frame response)"),
            max_err < 1e-4 * max_ref.max(1.0),
            format!("max |error| {max_err:.2e} against a peak of {max_ref:.2}"),
        );
    }
    // Stereo response on a mono input: left through channel 0, right through channel 1; normalized per spec.
    let e = Engine::offline(RATE);
    let ir = buffer(vec![vec![0.0, 1.0, 0.0, 0.0], vec![0.0, 0.0, 0.0, -0.5]]);
    let scale = reference::convolver_scale(&ir);
    let src = e.create(NodeKind::BufferSource);
    let mut impulse = vec![0.0; 16];
    impulse[0] = 1.0;
    e.set(src, Attr::Buffer(Some(buffer(vec![impulse]))));
    let conv = e.create(NodeKind::Convolver);
    e.set(conv, Attr::Buffer(Some(ir)));
    e.connect(src, 0, conv, 0);
    e.connect(conv, 0, DESTINATION, 0);
    e.start(src, 0.0, 0.0, None);
    let out = e.render(256);
    r.check(
        "convolver stereo response, normalized",
        (left(&out, 1) - scale).abs() < 1e-4 * scale && (right(&out, 3) + 0.5 * scale).abs() < 1e-4 * scale && right(&out, 1).abs() < 1e-4,
        format!("L[1] = {:.5}, R[3] = {:.5} (scale {:.5}: {:.5} and {:.5})", left(&out, 1), right(&out, 3), scale, scale, -0.5 * scale),
    );
}

fn panner(r: &mut Report) {
    for (x, z, name) in [(1.0, 0.0, "+90 (right)"), (-1.0, 0.0, "-90 (left)"), (0.0, -1.0, "0 (ahead)"), (10.0, 0.0, "+90 at 10 m")] {
        let e = Engine::offline(RATE);
        let src = dc(&e);
        let p = e.create(NodeKind::Panner);
        e.set(p, Attr::DistanceModel(DistanceModel::Inverse));
        e.param(p, Param::PositionX, ParamEvent::Value(x));
        e.param(p, Param::PositionZ, ParamEvent::Value(z));
        e.connect(src, 0, p, 0);
        e.connect(p, 0, DESTINATION, 0);
        let out = e.render(256);
        let azimuth = reference::azimuth([x as f64, 0.0, z as f64], [0.0; 3], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]);
        let (gl, gr) = reference::equal_power_gains(azimuth);
        let distance = ((x * x + z * z) as f64).sqrt();
        let d = (1.0 / (1.0 + (distance.max(1.0) - 1.0))) as f32;
        let (l, rr) = (left(&out, 200), right(&out, 200));
        r.check(
            &format!("panner {name}"),
            (l - gl * d).abs() < 1e-5 && (rr - gr * d).abs() < 1e-5,
            format!("azimuth {azimuth:.1}, L {l:.5} R {rr:.5} (spec {:.5} {:.5})", gl * d, gr * d),
        );
    }
    // The stereo panner on a mono input at pan -1, 0, +1.
    for pan in [-1.0f32, 0.0, 1.0] {
        let e = Engine::offline(RATE);
        let src = dc(&e);
        let p = e.create(NodeKind::StereoPanner);
        e.param(p, Param::Pan, ParamEvent::Value(pan));
        e.connect(src, 0, p, 0);
        e.connect(p, 0, DESTINATION, 0);
        let out = e.render(256);
        let x = (pan as f64 + 1.0) / 2.0 * std::f64::consts::FRAC_PI_2;
        let (l, rr) = (left(&out, 200), right(&out, 200));
        r.check(
            &format!("stereo panner {pan}"),
            (l as f64 - x.cos()).abs() < 1e-6 && (rr as f64 - x.sin()).abs() < 1e-6,
            format!("L {l:.5} R {rr:.5}"),
        );
    }
}

fn oscillators(r: &mut Report) {
    for kind in [OscillatorType::Sine, OscillatorType::Square, OscillatorType::Sawtooth, OscillatorType::Triangle] {
        let e = Engine::offline(RATE);
        let osc = e.create(NodeKind::Oscillator);
        e.set(osc, Attr::OscillatorType(kind));
        e.param(osc, Param::Frequency, ParamEvent::Value(3000.0));
        e.connect(osc, 0, DESTINATION, 0);
        e.start(osc, 0.0, 0.0, None);
        let out = e.render(48000);
        // Band-limited: the energy above Nyquist folded back would show as non-harmonic content. Measure the peak
        // and the energy that a 3 kHz harmonic series cannot account for (a DFT at a few inharmonic frequencies).
        let peak = (0..48000).map(|i| left(&out, i).abs()).fold(0.0f32, f32::max);
        let alias = [1000.0, 5000.0, 7000.0, 11000.0, 13000.0].iter().map(|&f| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for i in 0..48000 {
                let a = 2.0 * std::f64::consts::PI * f * i as f64 / RATE as f64;
                re += left(&out, i) as f64 * a.cos();
                im += left(&out, i) as f64 * a.sin();
            }
            (re * re + im * im).sqrt() / 24000.0
        });
        let worst = alias.fold(0.0f64, f64::max);
        r.check(
            &format!("{kind:?} at 3 kHz band-limited"),
            peak <= 1.0001 && worst < 1e-3,
            format!("peak {peak:.4}, worst inharmonic bin {:.1} dB", 20.0 * worst.max(1e-12).log10()),
        );
    }
}

fn release(r: &mut Report) {
    let e = Engine::offline(RATE);
    let bus = e.create(NodeKind::Gain);
    e.connect(bus, 0, DESTINATION, 0);
    let clip = buffer(vec![noise(2400, 5)]);
    for i in 0..1000 {
        // A sound effect as a page typically makes one: a source, an envelope, a level, all released at once.
        let src = e.create(NodeKind::BufferSource);
        e.set(src, Attr::Buffer(Some(clip.clone())));
        let env = e.create(NodeKind::Gain);
        let level = e.create(NodeKind::Gain);
        e.connect(src, 0, env, 0);
        e.connect(env, 0, level, 0);
        e.connect(level, 0, bus, 0);
        e.start(src, i as f64 * 0.002, 0.0, None);
        e.release(src);
        e.release(env);
        e.release(level);
    }
    let before = e.live_nodes();
    e.render(128 * 4);
    let during = e.live_nodes();
    e.render(48000 * 3);
    let _ = e.take_events();
    let after = e.live_nodes();
    r.check("released nodes are freed", after == 1, format!("{before} nodes made, {during} live early on, {after} left after all ended (the bus)"));
}

/// A small interactive-app-like graph, rendered to a WAV: master -> limiter -> destination, an effects bus through a glue
/// compressor, a 2.5 s stereo reverb send, noise bursts swept through a panner and filtered, triangle blips, a looping bed.
fn game_graph(path: &str, r: &mut Report) {
    let e = Engine::offline(RATE);
    let comp = |e: &Engine, t: f32, k: f32, ratio: f32, a: f32, rel: f32| {
        let c = e.create(NodeKind::DynamicsCompressor);
        e.param(c, Param::Threshold, ParamEvent::Value(t));
        e.param(c, Param::Knee, ParamEvent::Value(k));
        e.param(c, Param::Ratio, ParamEvent::Value(ratio));
        e.param(c, Param::Attack, ParamEvent::Value(a));
        e.param(c, Param::Release, ParamEvent::Value(rel));
        c
    };
    let master = e.create(NodeKind::Gain);
    let limiter = comp(&e, -3.0, 0.0, 20.0, 0.003, 0.15);
    e.connect(master, 0, limiter, 0);
    e.connect(limiter, 0, DESTINATION, 0);
    let sfx = e.create(NodeKind::Gain);
    let glue = comp(&e, -12.0, 6.0, 2.0, 0.025, 0.25);
    e.connect(sfx, 0, glue, 0);
    e.connect(glue, 0, master, 0);
    // Reverb: a decaying stereo noise response, 2.5 s, normalized.
    let len = (2.5 * RATE) as usize;
    let ir: Vec<Vec<f32>> = (0..2)
        .map(|c| noise(len, 11 + c).iter().enumerate().map(|(i, x)| x * (-(i as f32) * 6.9 / len as f32).exp()).collect())
        .collect();
    let conv = e.create(NodeKind::Convolver);
    e.set(conv, Attr::Buffer(Some(buffer(ir))));
    let ret = e.create(NodeKind::Gain);
    e.param(ret, Param::Gain, ParamEvent::Value(0.5));
    e.connect(conv, 0, ret, 0);
    e.connect(ret, 0, master, 0);
    // Listener at the origin facing -z; bursts swept left to right.
    let burst = buffer(vec![noise(9600, 21)]);
    for k in 0..6 {
        let at = 0.2 + k as f64 * 0.5;
        let src = e.create(NodeKind::BufferSource);
        e.set(src, Attr::Buffer(Some(burst.clone())));
        let filt = e.create(NodeKind::BiquadFilter);
        e.param(filt, Param::Frequency, ParamEvent::Value(1500.0 + 1000.0 * k as f32));
        let env = e.create(NodeKind::Gain);
        e.param(env, Param::Gain, ParamEvent::SetValueAtTime { value: 0.0, time: at });
        e.param(env, Param::Gain, ParamEvent::LinearRampToValueAtTime { value: 0.8, time: at + 0.01 });
        e.param(env, Param::Gain, ParamEvent::SetTargetAtTime { target: 0.0, time: at + 0.05, time_constant: 0.04 });
        let pan = e.create(NodeKind::Panner);
        e.param(pan, Param::PositionX, ParamEvent::SetValueAtTime { value: -4.0, time: at });
        e.param(pan, Param::PositionX, ParamEvent::LinearRampToValueAtTime { value: 4.0, time: at + 0.2 });
        e.param(pan, Param::PositionZ, ParamEvent::Value(-1.0));
        let send = e.create(NodeKind::Gain);
        e.param(send, Param::Gain, ParamEvent::Value(0.3));
        e.connect(src, 0, filt, 0);
        e.connect(filt, 0, env, 0);
        e.connect(env, 0, pan, 0);
        e.connect(pan, 0, sfx, 0);
        e.connect(pan, 0, send, 0);
        e.connect(send, 0, conv, 0);
        e.start(src, at, 0.0, None);
        for n in [src, filt, env, pan, send] {
            e.release(n);
        }
        // A triangle blip a little after each burst.
        let osc = e.create(NodeKind::Oscillator);
        e.set(osc, Attr::OscillatorType(OscillatorType::Triangle));
        e.param(osc, Param::Frequency, ParamEvent::SetValueAtTime { value: 440.0, time: at + 0.25 });
        e.param(osc, Param::Frequency, ParamEvent::ExponentialRampToValueAtTime { value: 880.0, time: at + 0.4 });
        let oenv = e.create(NodeKind::Gain);
        e.param(oenv, Param::Gain, ParamEvent::SetValueAtTime { value: 0.0, time: at + 0.25 });
        e.param(oenv, Param::Gain, ParamEvent::LinearRampToValueAtTime { value: 0.3, time: at + 0.26 });
        e.param(oenv, Param::Gain, ParamEvent::ExponentialRampToValueAtTime { value: 0.001, time: at + 0.4 });
        let sp = e.create(NodeKind::StereoPanner);
        e.param(sp, Param::Pan, ParamEvent::Value(if k % 2 == 0 { -0.5 } else { 0.5 }));
        e.connect(osc, 0, oenv, 0);
        e.connect(oenv, 0, sp, 0);
        e.connect(sp, 0, sfx, 0);
        e.start(osc, at + 0.25, 0.0, None);
        e.stop(osc, at + 0.41);
        for n in [osc, oenv, sp] {
            e.release(n);
        }
    }
    // A looping bed under it all: a quiet low sine in a 1-second buffer, looped.
    let bed = e.create(NodeKind::BufferSource);
    let tone: Vec<f32> = (0..48000).map(|i| 0.15 * (2.0 * std::f32::consts::PI * 110.0 * i as f32 / RATE).sin()).collect();
    e.set(bed, Attr::Buffer(Some(buffer(vec![tone.clone(), tone]))));
    e.set(bed, Attr::Loop(true));
    let bed_gain = e.create(NodeKind::Gain);
    e.connect(bed, 0, bed_gain, 0);
    e.connect(bed_gain, 0, master, 0);
    e.start(bed, 0.0, 0.0, None);

    let seconds = 5.0f64;
    let frames = (seconds * RATE as f64) as usize / 128 * 128;
    let t = Instant::now();
    let out = e.render(frames);
    let took = t.elapsed().as_secs_f64();
    let ended = e.take_events().len();
    let peak = out.iter().fold(0.0f32, |p, x| p.max(x.abs()));
    write_wav(path, &out);
    r.check(
        "game-like graph",
        peak < 1.0 && ended == 12 && out.iter().all(|x| x.is_finite()),
        format!(
            "{seconds} s rendered in {:.0} ms ({:.0}x real time, 2.5 s stereo reverb included), peak {:.2} dBFS, {ended} ended events (12), {} live nodes after; wrote {path}",
            took * 1000.0,
            seconds / took,
            20.0 * peak.log10(),
            e.live_nodes()
        ),
    );
}

fn write_wav(path: &str, interleaved: &[f32]) {
    let data_bytes = (interleaved.len() * 4) as u32;
    let mut w = Vec::with_capacity(44 + data_bytes as usize);
    w.extend(b"RIFF");
    w.extend((36 + data_bytes).to_le_bytes());
    w.extend(b"WAVEfmt ");
    w.extend(16u32.to_le_bytes());
    w.extend(3u16.to_le_bytes()); // IEEE float
    w.extend(2u16.to_le_bytes());
    w.extend((RATE as u32).to_le_bytes());
    w.extend((RATE as u32 * 8).to_le_bytes());
    w.extend(8u16.to_le_bytes());
    w.extend(32u16.to_le_bytes());
    w.extend(b"data");
    w.extend(data_bytes.to_le_bytes());
    for x in interleaved {
        w.extend(x.to_le_bytes());
    }
    std::fs::write(path, w).expect("writing the WAV");
}

fn main() {
    // The binding may keep the engine anywhere: it is Send and Sync.
    fn shareable<T: Send + Sync>() {}
    shareable::<Engine>();
    let path = std::env::args().nth(1).unwrap_or_else(|| "game-graph.wav".into());
    let mut r = Report { failures: 0 };
    automation(&mut r);
    lowpass(&mut r);
    ended(&mut r);
    compressor(&mut r);
    convolver(&mut r);
    panner(&mut r);
    oscillators(&mut r);
    release(&mut r);
    game_graph(&path, &mut r);
    println!("{} failed", r.failures);
    if r.failures > 0 {
        std::process::exit(1);
    }
}
