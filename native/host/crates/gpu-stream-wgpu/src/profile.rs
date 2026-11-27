//! The executor's CPU time per frame, by op (GPU_STREAM_PROFILE=1; off and free otherwise), and the recorder of
//! every flushed stream for an offline replay (GPU_STREAM_RECORD=<file>; examples/replay.rs reads it).
//!
//! Profiling: each command's wall time on the executing thread goes to its op's slot; the host calls
//! [`frame_end`] once per frame (the host's frame-end hook) with what it timed itself (the encoder's
//! FFI calls, the poll), and every 2 s one line goes to stderr:
//!
//! `gpu-prof 2.0s 118 frames (59.0 fps; interval p50 16.7 p95 17.9 max 33.4 ms) | page 3.50 ms/f: record 1.10 ms/f
//!  (5400 calls), send 0.00 | execute 2.31 ms/f (p50 2.2 p95 3.1 max 8.0) | poll 0.04 | ops/f: SUBMIT 1x 0.92 ms · ...`
//!
//! `page` is all the `gpu_*` calls' time on the page's thread; `execute (GPU thread)` marks an executor on a thread of
//! its own (the host's), whose time is then off the page's.
//!
//! Recording: each flush's words in full, and its staging bytes except large write payloads (WRITE_BUFFER /
//! WRITE_TEXTURE bytes beyond GPU_STREAM_RECORD_KEEP, 64 KiB by default: replayed as zeros, which costs the CPU the
//! same), with the host's frame ends and surface changes between them.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use crate::op;

/// Op slots (the highest op is 49), and the slots of a SUBMIT's halves.
pub const OPS: usize = 64;
pub const SLOT_FINISH: usize = 60;
pub const SLOT_QUEUE_SUBMIT: usize = 61;
/// A SUBMIT's first part: the belt's writes submitted on their own.
pub const SLOT_UPLOADS: usize = 62;
/// Counts only (no time), printed in their own `replayed/f` part: what executed bundles replayed (pipelines, bind
/// groups, vertex buffers, index buffers, draws, as recorded into each bundle), then DRAW_LIST buckets and rows drawn.
pub const SLOT_REPLAY: usize = 53;
pub const REPLAY_KINDS: usize = 5;
pub const SLOT_LIST_BUCKETS: usize = 58;
pub const SLOT_LIST_ROWS: usize = 59;

/// The replay count kind of a command recorded into a bundle, if it is one.
pub fn replay_kind(o: u32) -> Option<usize> {
    match o {
        op::SET_PIPELINE => Some(0),
        op::SET_BIND_GROUP | op::SET_BIND_GROUP_DYNAMIC => Some(1),
        op::SET_VERTEX_BUFFER => Some(2),
        op::SET_INDEX_BUFFER => Some(3),
        op::DRAW | op::DRAW_INDEXED | op::DRAW_INDIRECT | op::DRAW_INDEXED_INDIRECT => Some(4),
        _ => None,
    }
}

/// The op's name, for reports.
pub fn op_name(o: u32) -> &'static str {
    match o {
        op::CREATE_BUFFER => "CREATE_BUFFER",
        op::WRITE_BUFFER => "WRITE_BUFFER",
        op::CREATE_SHADER => "CREATE_SHADER",
        op::CREATE_COMPUTE_PIPELINE => "CREATE_COMPUTE_PIPELINE",
        op::CREATE_BIND_GROUP => "CREATE_BIND_GROUP",
        op::BEGIN_COMPUTE => "BEGIN_COMPUTE",
        op::SET_PIPELINE => "SET_PIPELINE",
        op::SET_BIND_GROUP => "SET_BIND_GROUP",
        op::DISPATCH => "DISPATCH",
        op::END_COMPUTE => "END_COMPUTE",
        op::COPY_BUFFER => "COPY_BUFFER",
        op::SUBMIT => "SUBMIT",
        op::MAP_READ => "MAP_READ",
        op::WORK_DONE => "WORK_DONE",
        op::PUSH_ERROR_SCOPE => "PUSH_ERROR_SCOPE",
        op::POP_ERROR_SCOPE => "POP_ERROR_SCOPE",
        op::DESTROY => "DESTROY",
        op::CREATE_TEXTURE => "CREATE_TEXTURE",
        op::CREATE_VIEW => "CREATE_VIEW",
        op::CREATE_SAMPLER => "CREATE_SAMPLER",
        op::CREATE_BIND_GROUP_LAYOUT => "CREATE_BIND_GROUP_LAYOUT",
        op::CREATE_PIPELINE_LAYOUT => "CREATE_PIPELINE_LAYOUT",
        op::CREATE_BIND_GROUP_WITH_LAYOUT => "CREATE_BIND_GROUP_WITH_LAYOUT",
        op::CREATE_RENDER_PIPELINE => "CREATE_RENDER_PIPELINE",
        op::BEGIN_RENDER_PASS => "BEGIN_RENDER_PASS",
        op::SET_VIEWPORT => "SET_VIEWPORT",
        op::SET_SCISSOR => "SET_SCISSOR",
        op::SET_VERTEX_BUFFER => "SET_VERTEX_BUFFER",
        op::SET_INDEX_BUFFER => "SET_INDEX_BUFFER",
        op::DRAW => "DRAW",
        op::DRAW_INDEXED => "DRAW_INDEXED",
        op::DRAW_INDIRECT => "DRAW_INDIRECT",
        op::DRAW_INDEXED_INDIRECT => "DRAW_INDEXED_INDIRECT",
        op::END_RENDER_PASS => "END_RENDER_PASS",
        op::SET_STENCIL_REFERENCE => "SET_STENCIL_REFERENCE",
        op::SET_BLEND_CONSTANT => "SET_BLEND_CONSTANT",
        op::WRITE_TEXTURE => "WRITE_TEXTURE",
        op::COPY_BUFFER_TO_TEXTURE => "COPY_BUFFER_TO_TEXTURE",
        op::COPY_TEXTURE_TO_BUFFER => "COPY_TEXTURE_TO_BUFFER",
        op::COPY_TEXTURE_TO_TEXTURE => "COPY_TEXTURE_TO_TEXTURE",
        op::CONFIGURE_SURFACE => "CONFIGURE_SURFACE",
        op::ACQUIRE_SURFACE_TEXTURE => "ACQUIRE_SURFACE_TEXTURE",
        op::PRESENT => "PRESENT",
        op::SET_BIND_GROUP_DYNAMIC => "SET_BIND_GROUP_DYNAMIC",
        op::CREATE_COMPUTE_PIPELINE_WITH_LAYOUT => "CREATE_COMPUTE_PIPELINE_WITH_LAYOUT",
        op::GET_BIND_GROUP_LAYOUT => "GET_BIND_GROUP_LAYOUT",
        op::CREATE_RENDER_BUNDLE_ENCODER => "CREATE_RENDER_BUNDLE_ENCODER",
        op::FINISH_RENDER_BUNDLE => "FINISH_RENDER_BUNDLE",
        op::EXECUTE_BUNDLES => "EXECUTE_BUNDLES",
        60 => "  (SUBMIT: encoder finish)",
        61 => "  (SUBMIT: queue submit)",
        62 => "  (SUBMIT: belt uploads)",
        _ => "?",
    }
}

static FORCED: AtomicBool = AtomicBool::new(false);

/// GPU_STREAM_PROFILE is set (read once), or a bench turned profiling on ([`force`]).
pub fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("GPU_STREAM_PROFILE").is_some_and(|v| v != "0")) || FORCED.load(Ordering::Relaxed)
}

/// Profiling on from code (the replay bench), whatever the environment says.
pub fn force(on: bool) {
    FORCED.store(on, Ordering::Relaxed);
}

/// One frame's (or one flush's) op counts and times, as the executor accumulates them.
#[derive(Clone)]
pub struct OpTimes {
    pub n: [u64; OPS],
    pub ns: [u64; OPS],
    /// `execute` calls and their whole time (decode and dispatch included).
    pub executes: u64,
    pub exec_ns: u64,
}

impl Default for OpTimes {
    fn default() -> Self {
        OpTimes { n: [0; OPS], ns: [0; OPS], executes: 0, exec_ns: 0 }
    }
}

impl OpTimes {
    pub fn add(&mut self, o: &OpTimes) {
        for k in 0..OPS {
            self.n[k] += o.n[k];
            self.ns[k] += o.ns[k];
        }
        self.executes += o.executes;
        self.exec_ns += o.exec_ns;
    }
}

/// What the host timed itself in a frame.
#[derive(Clone, Copy, Default, Debug)]
pub struct HostFrame {
    /// The encoder's FFI calls (`gpu_*`) this frame and their time (the core's recording, outside the executor).
    pub calls: u64,
    pub record_ns: u64,
    /// The device polls after flushes.
    pub poll_ns: u64,
    /// The streams handed to an executor on its own thread (the copy, and any wait for room in its queue).
    pub send_ns: u64,
    /// Everything the `gpu_*` calls took on the page's thread (the recording, the executor when it runs there, the
    /// polls, the hand-offs).
    pub page_ns: u64,
    /// The loop's looks at the GPU's ticket waits (the host's ticket settle) and their time (their device
    /// polls, when the executor is on the page's thread, are in `poll_ns` too).
    pub settles: u64,
    pub settle_ns: u64,
}

struct Window {
    started: Instant,
    last_frame: Option<Instant>,
    intervals: Vec<f64>,
    exec: Vec<f64>,
    ops: OpTimes,
    host: HostFrame,
    frames: u64,
}

static WINDOW: Mutex<Option<Window>> = Mutex::new(None);

fn pct(v: &mut [f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() - 1) as f64 * p).round() as usize]
}

/// The host's frame ended: `ops` the executor's work this frame (`Executor::take_profile`), `host` the host's own.
/// Prints the window's line every 2 s.
pub fn frame_end(ops: &OpTimes, host: HostFrame) {
    let now = Instant::now();
    let mut guard = WINDOW.lock().unwrap_or_else(|e| e.into_inner());
    let w = guard.get_or_insert_with(|| Window { started: now, last_frame: None, intervals: Vec::new(), exec: Vec::new(), ops: OpTimes::default(), host: HostFrame::default(), frames: 0 });
    if let Some(last) = w.last_frame {
        w.intervals.push(now.duration_since(last).as_secs_f64() * 1e3);
    }
    w.last_frame = Some(now);
    w.exec.push(ops.exec_ns as f64 / 1e6);
    w.ops.add(ops);
    w.host.calls += host.calls;
    w.host.record_ns += host.record_ns;
    w.host.poll_ns += host.poll_ns;
    w.host.send_ns += host.send_ns;
    w.host.page_ns += host.page_ns;
    w.host.settles += host.settles;
    w.host.settle_ns += host.settle_ns;
    w.frames += 1;
    // The GPU timestamps of frames whose readback completed: collected every frame, so their slots rotate.
    if crate::timing::installed() {
        crate::timing::collect();
    }
    let span = now.duration_since(w.started).as_secs_f64();
    if span < 2.0 {
        return;
    }
    let f = w.frames.max(1) as f64;
    let ms = |ns: u64| ns as f64 / 1e6 / f;
    let mut order: Vec<usize> = (0..OPS).filter(|&k| w.ops.n[k] > 0 && !(SLOT_REPLAY..=SLOT_LIST_ROWS).contains(&k)).collect();
    order.sort_by(|&a, &b| w.ops.ns[b].cmp(&w.ops.ns[a]));
    let ops_text: Vec<String> = order.iter().take(14).map(|&k| format!("{} {:.0}x {:.3}", op_name(k as u32), w.ops.n[k] as f64 / f, ms(w.ops.ns[k]))).collect();
    let mut intervals = std::mem::take(&mut w.intervals);
    let mut exec = std::mem::take(&mut w.exec);
    let gpu = gpu_line();
    let c = |k: usize| w.ops.n[k] as f64 / f;
    let replay = format!(
        " | replayed/f: pipelines {:.1} groups {:.1} vbufs {:.1} ibufs {:.1} draws {:.1} lists: buckets {:.1} rows {:.1}",
        c(SLOT_REPLAY),
        c(SLOT_REPLAY + 1),
        c(SLOT_REPLAY + 2),
        c(SLOT_REPLAY + 3),
        c(SLOT_REPLAY + 4),
        c(SLOT_LIST_BUCKETS),
        c(SLOT_LIST_ROWS)
    );
    eprintln!(
        "gpu-prof {span:.1}s {} frames ({:.1} fps; interval p50 {:.1} p95 {:.1} max {:.1} ms) | page {:.2} ms/f: record {:.2} ms/f ({:.0} calls), send {:.2} | execute{} {:.2} ms/f (p50 {:.2} p95 {:.2} max {:.2}) | poll {:.3} (ticket settles {:.1}/f {:.3} ms/f){gpu}{replay} | ops/f (count, ms): {}",
        w.frames,
        w.frames as f64 / span,
        pct(&mut intervals, 0.5),
        pct(&mut intervals, 0.95),
        pct(&mut intervals, 1.0),
        ms(w.host.page_ns),
        ms(w.host.record_ns),
        w.host.calls as f64 / f,
        ms(w.host.send_ns),
        if w.host.send_ns > 0 { " (GPU thread)" } else { "" },
        ms(w.ops.exec_ns),
        pct(&mut exec, 0.5),
        pct(&mut exec, 0.95),
        pct(&mut exec, 1.0),
        ms(w.host.poll_ns),
        w.host.settles as f64 / f,
        ms(w.host.settle_ns),
        ops_text.join(" · "),
    );
    let last = w.last_frame;
    *w = Window { started: now, last_frame: last, intervals: Vec::new(), exec: Vec::new(), ops: OpTimes::default(), host: HostFrame::default(), frames: 0 };
}

/// The GPU's own time per frame from timestamp queries (timing.rs), when installed.
fn gpu_line() -> String {
    if !crate::timing::installed() {
        return String::new();
    }
    crate::timing::collect();
    let (frames, untimed) = crate::timing::take();
    if frames.is_empty() {
        return format!(" | gpu untimed {untimed}");
    }
    let n = frames.len() as f64;
    let mut busy: Vec<f64> = frames.iter().map(|f| f.busy_ms).collect();
    let span = frames.iter().map(|f| f.span_ms).sum::<f64>() / n;
    let passes = frames.iter().map(|f| f.passes as f64).sum::<f64>() / n;
    let mean = busy.iter().sum::<f64>() / n;
    // Where that time goes: the passes by name (the executor's: what each draws to), most first, per frame.
    let (named, named_frames, segments) = crate::timing::take_named();
    let per = named_frames.max(1) as f64;
    let by_pass: Vec<String> = named
        .iter()
        .take(16)
        .map(|(name, t)| {
            let shaded = if t.fragments > 0 { format!(", {:.0}k fragments", t.fragments as f64 / per / 1e3) } else { String::new() };
            format!("{name} {:.2} ms ({:.1} passes, {:.0} draws{shaded})", t.ms / per, t.passes as f64 / per, t.draws as f64 / per)
        })
        .collect();
    // the host's GPU timing (level 2): inside the passes, by what each segment drew (a bundle's or a pipeline's draws).
    let by_segment: Vec<String> =
        segments
            .iter()
            .take(40)
            .map(|(name, t)| {
                let counts = if t.fragments + t.vertices > 0 {
                    format!(", {:.0}k fragments, {:.0}k vertices, {:.0}k primitives", t.fragments as f64 / per / 1e3, t.vertices as f64 / per / 1e3, t.primitives as f64 / per / 1e3)
                } else {
                    String::new()
                };
                format!("{name} {:.3} ms ({:.1}x{counts})", t.ms / per, t.passes as f64 / per)
            })
            .collect();
    format!(
        " | gpu busy {mean:.2} ms/f (p95 {:.2} max {:.2}) span {span:.2} passes {passes:.0} untimed {untimed} | gpu by pass/f: {}{}",
        pct(&mut busy, 0.95),
        pct(&mut busy, 1.0),
        by_pass.join(" · "),
        if by_segment.is_empty() { String::new() } else { format!(" | gpu by segment/f: {}", by_segment.join(" · ")) }
    )
}

// ---- the recorder ---------------------------------------------------------------------------------------------------

/// Record tags.
pub const TAG_FLUSH: u32 = 0x4853_4c46; // "FLSH"
pub const TAG_FRAME: u32 = 0x4d41_5246; // "FRAM"
pub const TAG_SURFACE: u32 = 0x4652_5553; // "SURF"
pub const MAGIC: u32 = 0x5254_5347; // "GSTR"

/// Surface events (TAG_SURFACE's first word).
pub const SURF_SCENE: u32 = 1;
pub const SURF_RESIZE: u32 = 2;
pub const SURF_ADD: u32 = 3;
pub const SURF_SELECT: u32 = 4;
pub const SURF_RESIZE_EXTRA: u32 = 5;

struct Recorder {
    out: std::io::BufWriter<std::fs::File>,
    keep: usize,
}

static RECORDER: Mutex<Option<Recorder>> = Mutex::new(None);

/// GPU_STREAM_RECORD names a file (read once; the file is made at the first record).
pub fn recording() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("GPU_STREAM_RECORD").is_some())
}

fn with_recorder(f: impl FnOnce(&mut Recorder) -> std::io::Result<()>) {
    let mut guard = RECORDER.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        let Some(path) = std::env::var_os("GPU_STREAM_RECORD") else { return };
        let keep = std::env::var("GPU_STREAM_RECORD_KEEP").ok().and_then(|v| v.parse().ok()).unwrap_or(64 << 10);
        match std::fs::File::create(&path) {
            Ok(file) => {
                let mut out = std::io::BufWriter::with_capacity(1 << 20, file);
                let _ = out.write_all(&MAGIC.to_le_bytes());
                *guard = Some(Recorder { out, keep });
            }
            Err(e) => {
                eprintln!("gpu-stream: GPU_STREAM_RECORD {}: {e}", std::path::Path::new(&path).display());
                return;
            }
        }
    }
    if let Some(r) = guard.as_mut() {
        if let Err(e) = f(r) {
            eprintln!("gpu-stream: recording stopped: {e}");
            *guard = None;
        }
    }
}

fn put(out: &mut impl Write, words: &[u32]) -> std::io::Result<()> {
    for w in words {
        out.write_all(&w.to_le_bytes())?;
    }
    Ok(())
}

/// The staging ranges a replay needs: everything but large write payloads.
fn kept_ranges(words: &[u32], staging_len: usize, keep: usize) -> Vec<(usize, usize)> {
    let mut skip: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i + 1 < words.len() {
        let (o, n) = (words[i], words[i + 1] as usize);
        let a = &words[(i + 2).min(words.len())..(i + 2 + n).min(words.len())];
        let payload = match o {
            op::WRITE_BUFFER if a.len() >= 4 => Some((a[2] as usize, a[3] as usize)),
            op::WRITE_TEXTURE if a.len() >= 8 => Some((a[6] as usize, a[7] as usize)),
            _ => None,
        };
        if let Some((off, len)) = payload.filter(|&(_, len)| len > keep) {
            skip.push((off, (off + len).min(staging_len)));
        }
        i += 2 + n;
    }
    skip.sort();
    let mut out = Vec::new();
    let mut at = 0;
    for (s, e) in skip {
        if s > at {
            out.push((at, s));
        }
        at = at.max(e);
    }
    if at < staging_len {
        out.push((at, staging_len));
    }
    out
}

/// One flushed stream.
pub(crate) fn record_flush(words: &[u32], staging: &[u8]) {
    with_recorder(|r| {
        let ranges = kept_ranges(words, staging.len(), r.keep);
        put(&mut r.out, &[TAG_FLUSH, words.len() as u32])?;
        put(&mut r.out, words)?;
        put(&mut r.out, &[staging.len() as u32, ranges.len() as u32])?;
        for (s, e) in ranges {
            put(&mut r.out, &[s as u32, (e - s) as u32])?;
            r.out.write_all(&staging[s..e])?;
        }
        Ok(())
    });
}

/// A surface change (`SURF_*` and its arguments).
pub(crate) fn record_surface(what: u32, a: u32, b: u32, c: u32) {
    if recording() {
        with_recorder(|r| put(&mut r.out, &[TAG_SURFACE, what, a, b, c]));
    }
}

/// The host's frame ended (call once per frame; nothing unless recording).
pub fn record_frame() {
    if recording() {
        with_recorder(|r| {
            put(&mut r.out, &[TAG_FRAME])?;
            r.out.flush()
        });
    }
}

/// One record as read back.
pub enum Record {
    Flush { words: Vec<u32>, staging: Vec<u8> },
    Frame,
    Surface { what: u32, a: u32, b: u32, c: u32 },
}

/// Reads a recording (the replay bench).
pub fn read_recording(bytes: &[u8]) -> Result<Vec<Record>, String> {
    let mut p = 0usize;
    let mut u = || -> Result<u32, String> {
        let v = bytes.get(p..p + 4).ok_or("recording truncated")?;
        p += 4;
        Ok(u32::from_le_bytes([v[0], v[1], v[2], v[3]]))
    };
    if u()? != MAGIC {
        return Err("not a gpu-stream recording".into());
    }
    drop(u);
    let mut out = Vec::new();
    let word = |p: &mut usize| -> Result<u32, String> {
        let v = bytes.get(*p..*p + 4).ok_or("recording truncated")?;
        *p += 4;
        Ok(u32::from_le_bytes([v[0], v[1], v[2], v[3]]))
    };
    while p < bytes.len() {
        match word(&mut p)? {
            TAG_FLUSH => {
                let n = word(&mut p)? as usize;
                let mut words = Vec::with_capacity(n);
                for _ in 0..n {
                    words.push(word(&mut p)?);
                }
                let len = word(&mut p)? as usize;
                let ranges = word(&mut p)?;
                let mut staging = vec![0u8; len];
                for _ in 0..ranges {
                    let (s, l) = (word(&mut p)? as usize, word(&mut p)? as usize);
                    let src = bytes.get(p..p + l).ok_or("recording truncated")?;
                    staging.get_mut(s..s + l).ok_or("range outside staging")?.copy_from_slice(src);
                    p += l;
                }
                out.push(Record::Flush { words, staging });
            }
            TAG_FRAME => out.push(Record::Frame),
            TAG_SURFACE => {
                let (what, a, b, c) = (word(&mut p)?, word(&mut p)?, word(&mut p)?, word(&mut p)?);
                out.push(Record::Surface { what, a, b, c });
            }
            t => return Err(format!("unknown record tag {t:#x} at {}", p - 4)),
        }
    }
    Ok(out)
}
