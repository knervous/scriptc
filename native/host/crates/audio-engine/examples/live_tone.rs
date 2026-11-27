//! On the real device: a 1-second 440 Hz tone, then a short noise burst through a panner swept left to right.
//!
//! cargo run --release --example live_tone
//!
//! Nothing here can listen, so it prints what shows the output running: the context's rate and latency, the frames the
//! render thread wrote to the endpoint and the buffers it filled, the context's clock against the wall clock, and the
//! sources' ended events with the context time they arrived at.

use std::sync::Arc;
use std::time::{Duration, Instant};

use audio_engine::{Attr, BufferData, DESTINATION, Engine, Event, NodeKind, Param, ParamEvent, State};

fn main() {
    let t0 = Instant::now();
    let engine = Engine::new();
    let opened = t0.elapsed();
    let rate = engine.sample_rate();
    println!("opened in {:.1} ms: {rate} Hz, output latency {:.2} ms, {:?}", opened.as_secs_f64() * 1000.0, engine.output_latency() * 1000.0, engine.state());

    let start = engine.current_time() + 0.05;
    // The tone: 440 Hz, a second, with 5 ms fades so it does not click.
    let osc = engine.create(NodeKind::Oscillator);
    let env = engine.create(NodeKind::Gain);
    engine.param(osc, Param::Frequency, ParamEvent::Value(440.0));
    engine.param(env, Param::Gain, ParamEvent::SetValueAtTime { value: 0.0, time: start });
    engine.param(env, Param::Gain, ParamEvent::LinearRampToValueAtTime { value: 0.2, time: start + 0.005 });
    engine.param(env, Param::Gain, ParamEvent::SetValueAtTime { value: 0.2, time: start + 0.995 });
    engine.param(env, Param::Gain, ParamEvent::LinearRampToValueAtTime { value: 0.0, time: start + 1.0 });
    engine.connect(osc, 0, env, 0);
    engine.connect(env, 0, DESTINATION, 0);
    engine.start(osc, start, 0.0, None);
    engine.stop(osc, start + 1.0);

    // The burst: 0.6 s of noise, panned from 5 m left to 5 m right while it plays.
    let burst_at = start + 1.2;
    let mut s = 0x1234_5678u32;
    let noise: Vec<f32> = (0..(0.6 * rate) as usize)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            ((s as f32 / u32::MAX as f32) * 2.0 - 1.0) * 0.3
        })
        .collect();
    let src = engine.create(NodeKind::BufferSource);
    engine.set(src, Attr::Buffer(Some(Arc::new(BufferData { sample_rate: rate, channels: vec![noise] }))));
    let pan = engine.create(NodeKind::Panner);
    engine.param(pan, Param::PositionZ, ParamEvent::Value(-1.0));
    engine.param(pan, Param::PositionX, ParamEvent::SetValueAtTime { value: -5.0, time: burst_at });
    engine.param(pan, Param::PositionX, ParamEvent::LinearRampToValueAtTime { value: 5.0, time: burst_at + 0.6 });
    engine.connect(src, 0, pan, 0);
    engine.connect(pan, 0, DESTINATION, 0);
    engine.start(src, burst_at, 0.0, None);
    for n in [osc, env, src, pan] {
        engine.release(n);
    }

    let wall0 = Instant::now();
    let ctx0 = engine.current_time();
    let (frames0, periods0) = engine.device_counters();
    let mut ended = Vec::new();
    while wall0.elapsed() < Duration::from_millis(2500) {
        std::thread::sleep(Duration::from_millis(250));
        for ev in engine.take_events() {
            let Event::Ended(id) = ev;
            let name = if id == osc { "tone" } else if id == src { "burst" } else { "?" };
            ended.push((name, engine.current_time()));
        }
        let (frames, periods) = engine.device_counters();
        println!(
            "wall {:.3} s  context {:.3} s  device frames {:>7}  buffers {:>4}  live nodes {}",
            wall0.elapsed().as_secs_f64(),
            engine.current_time() - ctx0,
            frames - frames0,
            periods - periods0,
            engine.live_nodes()
        );
    }
    let wall = wall0.elapsed().as_secs_f64();
    let ctx = engine.current_time() - ctx0;
    let (frames, periods) = engine.device_counters();
    let (frames, periods) = (frames - frames0, periods - periods0);
    for (name, at) in &ended {
        println!("ended: {name} (heard by the page at context time {at:.3} s)");
    }
    println!(
        "context clock {:.4} s per wall second; {} frames to the device ({:.4} s per wall second), {} buffers ({:.1} frames each, one every {:.2} ms)",
        ctx / wall,
        frames,
        frames as f64 / rate as f64 / wall,
        periods,
        frames as f64 / periods.max(1) as f64,
        wall * 1000.0 / periods.max(1) as f64
    );
    engine.suspend();
    let paused = engine.current_time();
    std::thread::sleep(Duration::from_millis(200));
    println!("suspended: {:?}, clock moved {:.4} s in 200 ms", engine.state(), engine.current_time() - paused);
    engine.resume();
    std::thread::sleep(Duration::from_millis(200));
    println!("resumed: {:?}, clock moved {:.4} s in 200 ms", engine.state(), engine.current_time() - paused);
    let t = Instant::now();
    engine.close();
    println!("closed in {:.1} ms: {:?}", t.elapsed().as_secs_f64() * 1000.0, engine.state());
    assert_eq!(engine.state(), State::Closed);
}
