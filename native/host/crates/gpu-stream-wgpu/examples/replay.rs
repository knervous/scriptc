//! Replays a recorded stream (GPU_STREAM_RECORD=<file> in a run) on a headless device and times its last frames:
//! the executor's CPU time per frame and by op, as GPU_STREAM_PROFILE reports it in a run.
//!
//! `cargo run --release --example replay -- <file> [--frames N] [--latency L] [--passes-only]`
//!
//! - `--frames N`: the frames measured, the recording's last N (default 300); everything before them is replayed
//!   untimed (the scene's load: buffers, textures, pipelines).
//! - `--latency L`: the CPU waits for frame n-L's work on the GPU before frame n (default 2: a swap chain's frame
//!   latency); 0 never waits.
//!
//! Large write payloads were recorded as their length only (profile.rs) and replay as zeros: the CPU's cost is the
//! same.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

use gpu_stream_wgpu::profile::{self, OpTimes, Record};
use gpu_stream_wgpu::{Executor, TicketTable, wgpu};

/// Uncaptured errors in the replay (the first five printed).
static ERRORS: AtomicU32 = AtomicU32::new(0);

fn pct(v: &[f64], p: f64) -> f64 {
    let mut v = v.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if v.is_empty() { 0.0 } else { v[((v.len() - 1) as f64 * p).round() as usize] }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let file = args.first().expect("usage: replay <file> [--frames N] [--latency L]");
    let opt = |name: &str, default: usize| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default);
    let measured = opt("--frames", 300);
    let latency = opt("--latency", 2);

    let t = Instant::now();
    let bytes = std::fs::read(file).expect("read the recording");
    let records = profile::read_recording(&bytes).expect("parse the recording");
    drop(bytes);
    let mut frames = records.iter().filter(|r| matches!(r, Record::Frame)).count();
    // A recording without frame marks: a frame ends where the main surface presented (one PRESENT per frame).
    let by_present = frames == 0;
    if by_present {
        frames = records
            .iter()
            .map(|r| match r {
                Record::Flush { words, .. } => count_presents(words),
                _ => 0,
            })
            .sum();
    }
    let flushes = records.iter().filter(|r| matches!(r, Record::Flush { .. })).count();
    eprintln!("replay: {} records, {frames} frames, {flushes} flushes, read in {:.0} ms", records.len(), t.elapsed().as_secs_f64() * 1e3);
    let from = frames.saturating_sub(measured);

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("adapter");
    let info = adapter.get_info();
    eprintln!("replay: {} ({:?}), flags {:?}", info.name, info.backend, instance_flags());
    let (features, limits) = gpu_stream_wgpu::web_device_asks(&adapter);
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: Some("replay"), required_features: features, required_limits: limits, ..Default::default() })).expect("device");
    device.on_uncaptured_error(Arc::new(|e: wgpu::Error| {
        if ERRORS.fetch_add(1, Ordering::Relaxed) < 5 {
            eprintln!("replay: uncaptured: {e}");
        }
    }));
    let tickets = TicketTable::new();
    if args.iter().any(|a| a == "--thread") {
        threaded(&records, frames, from, device, queue, tickets, by_present, opt("--page-ms", 25) as f64);
        return;
    }
    let mut ex = Executor::from_device(device.clone(), queue.clone(), tickets.clone());
    ex.set_scene(1349, 843);

    let mut frame = 0usize;
    let mut frame_ms: Vec<f64> = Vec::new();
    let mut poll_ms: Vec<f64> = Vec::new();
    let mut wait_ms: Vec<f64> = Vec::new();
    let mut ops = OpTimes::default();
    let mut ring: std::collections::VecDeque<wgpu::SubmissionIndex> = Default::default();
    let mut frame_start = Instant::now();
    let setup = Instant::now();
    let mut presented = 0u64;
    // The stream's shape in the measured frames: draws recorded per bundle (by id), and per frame the passes, the
    // draws in the passes themselves and in the bundles they execute.
    let mut bundle_draws: std::collections::HashMap<u32, u32> = Default::default();
    let mut open_bundle: Option<u32> = None;
    let (mut passes, mut pass_draws, mut bundle_exec_draws, mut bundles_exec) = (0u64, 0u64, 0u64, 0u64);
    for r in &records {
        let timing = frame >= from;
        let ended = match r {
            Record::Flush { words, staging } => {
                let mut i = 0;
                while i + 1 < words.len() {
                    let (o, n) = (words[i], words[i + 1] as usize);
                    let a = &words[i + 2..(i + 2 + n).min(words.len())];
                    use gpu_stream_wgpu::op;
                    let draw = matches!(o, op::DRAW | op::DRAW_INDEXED | op::DRAW_INDIRECT | op::DRAW_INDEXED_INDIRECT);
                    match o {
                        op::CREATE_RENDER_BUNDLE_ENCODER => {
                            open_bundle = a.first().copied();
                            if let Some(id) = open_bundle {
                                bundle_draws.insert(id, 0);
                            }
                        }
                        op::FINISH_RENDER_BUNDLE => open_bundle = None,
                        op::BEGIN_RENDER_PASS if timing => passes += 1,
                        op::EXECUTE_BUNDLES if timing => {
                            for id in a.iter().skip(1).take(a.first().copied().unwrap_or(0) as usize) {
                                bundles_exec += 1;
                                bundle_exec_draws += *bundle_draws.get(id).unwrap_or(&0) as u64;
                            }
                        }
                        _ if draw => match open_bundle {
                            Some(id) => *bundle_draws.entry(id).or_default() += 1,
                            None if timing => pass_draws += 1,
                            None => {}
                        },
                        _ => {}
                    }
                    i += 2 + n;
                }
                if let Err(e) = ex.execute(words, staging) {
                    eprintln!("replay: frame {frame}: {e}");
                    return;
                }
                let now = ex.scene().map_or(0, |s| s.presented);
                let ended = by_present && now != presented;
                presented = now;
                ended
            }
            Record::Surface { what, a, b, c } => {
                match *what {
                profile::SURF_SCENE => ex.set_scene(*a, *b),
                profile::SURF_RESIZE => ex.resize_surface(*a, *b),
                profile::SURF_ADD => {
                    ex.add_scene_surface(*a, *b);
                }
                profile::SURF_SELECT => {
                    ex.select_surface(*a);
                }
                profile::SURF_RESIZE_EXTRA => ex.resize_scene_surface(*a, *b, *c),
                _ => {}
                }
                false
            }
            Record::Frame => !by_present,
        };
        if ended {
            {
                let t = Instant::now();
                ex.poll();
                let polled = t.elapsed().as_secs_f64() * 1e3;
                if timing {
                    frame_ms.push(frame_start.elapsed().as_secs_f64() * 1e3);
                    poll_ms.push(polled);
                    ops.add(&ex.take_profile());
                }
                // A swap chain's latency: frame n waits for frame n-L's work.
                let t = Instant::now();
                if latency > 0 {
                    ring.push_back(queue.submit([]));
                    while ring.len() > latency {
                        let idx = ring.pop_front().unwrap();
                        let _ = device.poll(wgpu::PollType::Wait { submission_index: Some(idx), timeout: None });
                    }
                }
                if timing {
                    wait_ms.push(t.elapsed().as_secs_f64() * 1e3);
                }
                frame += 1;
                if frame == from {
                    let _ = device.poll(wgpu::PollType::wait_indefinitely());
                    eprintln!("replay: setup ({from} frames) {:.0} ms; measuring {} frames", setup.elapsed().as_secs_f64() * 1e3, frames - from);
                    profile::force(true);
                    let _ = ex.take_profile();
                }
                frame_start = Instant::now();
            }
        }
    }
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let n = frame_ms.len().max(1) as f64;
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    println!(
        "frames {} | cpu (execute + poll) mean {:.3} p50 {:.3} p95 {:.3} max {:.3} ms | execute {:.3} ms/f | poll {:.3} | latency wait mean {:.3} p95 {:.3} | uncaptured {}",
        frame_ms.len(), mean(&frame_ms), pct(&frame_ms, 0.5), pct(&frame_ms, 0.95), pct(&frame_ms, 1.0), ops.exec_ns as f64 / 1e6 / n, mean(&poll_ms), mean(&wait_ms), pct(&wait_ms, 0.95), ERRORS.load(Ordering::Relaxed),
    );
    println!(
        "shape per frame: render passes {:.1}, draws in passes {:.0}, bundles executed {:.1} holding {:.0} draws",
        passes as f64 / n, pass_draws as f64 / n, bundles_exec as f64 / n, bundle_exec_draws as f64 / n
    );
    let mut order: Vec<usize> = (0..profile::OPS).filter(|&k| ops.n[k] > 0).collect();
    order.sort_by(|&a, &b| ops.ns[b].cmp(&ops.ns[a]));
    println!("{:<34} {:>10} {:>12} {:>10}", "op", "count/f", "ms/f", "us each");
    for k in order {
        println!("{:<34} {:>10.1} {:>12.4} {:>10.2}", profile::op_name(k as u32), ops.n[k] as f64 / n, ops.ns[k] as f64 / 1e6 / n, ops.ns[k] as f64 / 1e3 / ops.n[k] as f64);
    }
}

/// `--thread`: the executor on a thread of its own, as a host may run it on Windows: this thread copies each
/// flush into a bounded queue (depth 2) and goes on, then spends `--page-ms` (default 25) per frame on its own work (a
/// spin: the page's script, layout and paint). Reported: this thread's time per frame in the hand-off (the copies and
/// any wait for room: what stays on the page's thread of the executor's work), the executor thread's execute time per
/// frame, and the wall time per frame. The executor thread polls after each stream, and waits for frame n-2's work
/// after frame n, as a swap chain's latency would.
#[allow(clippy::too_many_arguments)]
fn threaded(records: &[Record], frames: usize, from: usize, device: wgpu::Device, queue: wgpu::Queue, tickets: Arc<TicketTable>, by_present: bool, page_ms: f64) {
    enum Job {
        Flush(Vec<u32>, Vec<u8>),
        Surface(u32, u32, u32, u32),
        Frame(bool),
    }
    let (send, receive) = std::sync::mpsc::sync_channel::<Job>(2);
    let (spare_send, spare) = std::sync::mpsc::channel::<(Vec<u32>, Vec<u8>)>();
    let (exec_send, exec_ms) = std::sync::mpsc::channel::<f64>();
    let worker = std::thread::spawn(move || {
        let mut ex = Executor::from_device(device.clone(), queue.clone(), tickets);
        ex.set_scene(1349, 843);
        ex.set_scene_buffers(3);
        let mut ring: std::collections::VecDeque<wgpu::SubmissionIndex> = Default::default();
        let mut frame_exec = 0.0;
        let mut presented = 0;
        while let Ok(job) = receive.recv() {
            match job {
                Job::Flush(words, staging) => {
                    let t = Instant::now();
                    if let Err(e) = ex.execute(&words, &staging) {
                        eprintln!("replay: {e}");
                        return;
                    }
                    ex.poll();
                    frame_exec += t.elapsed().as_secs_f64() * 1e3;
                    let _ = spare_send.send((words, staging));
                    let now = ex.scene().map_or(0, |s| s.presented);
                    if by_present && now != presented {
                        presented = now;
                        let _ = exec_send.send(std::mem::take(&mut frame_exec));
                        ring.push_back(queue.submit([]));
                        while ring.len() > 2 {
                            let idx = ring.pop_front().unwrap();
                            let _ = device.poll(wgpu::PollType::Wait { submission_index: Some(idx), timeout: None });
                        }
                    }
                }
                Job::Surface(what, a, b, c) => match what {
                    profile::SURF_SCENE => ex.set_scene(a, b),
                    profile::SURF_RESIZE => ex.resize_surface(a, b),
                    profile::SURF_ADD => {
                        ex.add_scene_surface(a, b);
                    }
                    profile::SURF_SELECT => {
                        ex.select_surface(a);
                    }
                    profile::SURF_RESIZE_EXTRA => ex.resize_scene_surface(a, b, c),
                    _ => {}
                },
                Job::Frame(measured) => {
                    if !by_present {
                        let _ = exec_send.send(std::mem::take(&mut frame_exec));
                    }
                    if !measured {
                        let _ = device.poll(wgpu::PollType::wait_indefinitely());
                    }
                }
            }
        }
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
    });
    let mut frame = 0usize;
    let mut send_ms: Vec<f64> = Vec::new();
    let mut frame_send = 0.0;
    let start = Instant::now();
    let mut measured_from: Option<Instant> = None;
    for r in records {
        let ended = match r {
            Record::Flush { words, staging } => {
                let t = Instant::now();
                let (mut w, mut s) = spare.try_recv().unwrap_or_default();
                w.clear();
                w.extend_from_slice(words);
                s.clear();
                s.extend_from_slice(staging);
                let _ = send.send(Job::Flush(w, s));
                frame_send += t.elapsed().as_secs_f64() * 1e3;
                by_present && count_presents(words) > 0
            }
            Record::Surface { what, a, b, c } => {
                let _ = send.send(Job::Surface(*what, *a, *b, *c));
                false
            }
            Record::Frame => !by_present,
        };
        if ended {
            if frame >= from {
                send_ms.push(std::mem::take(&mut frame_send));
                // The page's own work this frame.
                let t = Instant::now();
                while t.elapsed().as_secs_f64() * 1e3 < page_ms {
                    std::hint::spin_loop();
                }
            } else {
                frame_send = 0.0;
            }
            frame += 1;
            if !by_present {
                let _ = send.send(Job::Frame(frame > from));
            }
            if frame == from {
                measured_from = Some(Instant::now());
                eprintln!("replay --thread: setup ({from} frames) {:.0} ms; measuring {} frames", start.elapsed().as_secs_f64() * 1e3, frames - from);
            }
        }
    }
    drop(send);
    let _ = worker.join();
    let wall = measured_from.map_or(0.0, |t| t.elapsed().as_secs_f64() * 1e3);
    let exec: Vec<f64> = exec_ms.try_iter().collect();
    let exec = &exec[exec.len().saturating_sub(send_ms.len())..];
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    println!(
        "threaded (page work {page_ms} ms/f): frames {} | page thread (copy + send) mean {:.3} p50 {:.3} p95 {:.3} max {:.3} ms/f | executor thread (execute + poll) mean {:.3} p50 {:.3} p95 {:.3} ms/f | wall {:.2} ms/f | uncaptured {}",
        send_ms.len(), mean(&send_ms), pct(&send_ms, 0.5), pct(&send_ms, 0.95), pct(&send_ms, 1.0), mean(exec), pct(exec, 0.5), pct(exec, 0.95), wall / send_ms.len().max(1) as f64,
        ERRORS.load(Ordering::Relaxed)
    );
}

/// PRESENTs in a stream (the main surface's, approximately: views select other surfaces between).
fn count_presents(words: &[u32]) -> usize {
    let (mut i, mut n) = (0, 0);
    while i + 1 < words.len() {
        if words[i] == gpu_stream_wgpu::op::PRESENT {
            n += 1;
        }
        i += 2 + words[i + 1] as usize;
    }
    n
}

fn instance_flags() -> wgpu::InstanceFlags {
    wgpu::InstanceDescriptor::new_without_display_handle_from_env().flags
}
