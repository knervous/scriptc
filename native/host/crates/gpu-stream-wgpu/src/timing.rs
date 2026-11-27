//! GPU time per host frame, from timestamp queries (profiling; off unless installed).
//!
//! Every compute and render pass the executor begins (and the host's own composite) takes a
//! pair of slots in this frame's range of one query set. At the frame's end the range is
//! resolved and copied into that frame's readback buffer and mapped; nothing waits on it.
//! A later `collect` (after the host's next polls) reads the frames whose maps completed.
//! Three frames rotate: a frame whose buffer is still mapping when its turn comes again is
//! not timed (the GPU is more than three frames behind; that is itself the answer).
//!
//! Per frame: `busy`, the sum of the passes' own durations, and `span`, first pass begin to
//! last pass end (busy plus the GPU's gaps between passes). Work outside passes (copies,
//! writes) is in neither.
//!
//! Each pass can also be named (`name`: the executor names a pass by what it draws to, and its
//! draws), and the time is summed by name across the frames read (`take_named`): which pass the
//! GPU spends its frame on.
//!
//! Detailed timing (`install(.., true)`, on a device with TIMESTAMP_QUERY_INSIDE_PASSES) also
//! takes marks inside a render pass (`mark`: the executor marks each render bundle and each
//! pipeline its direct draws change to). A pass's time is split at its marks: from each mark to
//! the next (or to the pass's end), under the mark's name, and from the pass's begin to its first
//! mark (the clear and anything drawn before). Summed by (pass, mark) name (`take_named`).
//! Timestamps between draws on one queue time when the GPU reaches them, so overlapping draws
//! blur each segment's edges; over many frames the sums still say where a pass spends its time.
//!
//! Where the device has PIPELINE_STATISTICS_QUERY (wgpu's DX12 backend offers it only in the vendored
//! wgpu-hal with WGPU_DX12_PIPELINE_STATISTICS=1), each segment also counts its vertex shader invocations, primitives out of the clipper and
//! fragment shader invocations: fragments shaded against the pixels the target has is the overdraw a
//! depth prepass or a draw sort could remove, per draw group.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

/// Timestamp slots per frame (two per pass, one per mark).
const PER_FRAME: u32 = 256;
/// With marks: three frames of these fit one query set (wgpu allows at most 4096 queries in one), and each frame's
/// range starts on QUERY_RESOLVE_BUFFER_ALIGNMENT (256 bytes: a multiple of 32 slots).
const PER_FRAME_DETAILED: u32 = 1344;
const FRAMES: usize = 3;
const FREE: u8 = 0;
const MAPPING: u8 = 1;
const READY: u8 = 2;

#[derive(Clone, Copy, Debug, Default)]
pub struct FrameGpu {
    pub busy_ms: f64,
    pub span_ms: f64,
    pub passes: u32,
    /// The longest pass and its index in the frame.
    pub longest_ms: f64,
    pub longest: u32,
    /// Each pass's own time, in the frame's order (the composite last).
    pub pass_ms: [f64; 16],
}

/// What a frame's slots hold, in the order taken: a pass (its begin slot; its end slot follows), or a mark inside the
/// pass taken before it. `stats`: the pipeline statistics query of the segment that starts there (`segment_stats`).
enum Entry {
    Pass { at: u32, name: String, draws: u32, stats: Option<u32> },
    Mark { at: u32, name: String, stats: Option<u32> },
}

struct Slot {
    readback: wgpu::Buffer,
    state: Arc<AtomicU8>,
    used: u32,
    entries: Vec<Entry>,
    /// Pipeline statistics queries taken this frame, and their readback (mapped with the timestamps': `state` is
    /// READY once both are).
    stats_used: u32,
    stats_readback: Option<wgpu::Buffer>,
}

/// A named pass's (or segment's) totals over the frames read: GPU ms, passes (or segments), draws, and with pipeline
/// statistics the vertex shader invocations, clipped primitives and fragment shader invocations.
#[derive(Clone, Debug, Default)]
pub struct Named {
    pub ms: f64,
    pub passes: u32,
    pub draws: u64,
    pub vertices: u64,
    pub primitives: u64,
    pub fragments: u64,
}

/// Pipeline statistics queries per frame: as many as marks can take (three frames in one query set of at most 4096).
/// Each resolves to 3 packed counters of 8 bytes (wgpu's layout), so a frame's range is 126 x 256 bytes
/// (QUERY_RESOLVE_BUFFER_ALIGNMENT); on DX12 (WGPU_DX12_PIPELINE_STATISTICS, the vendored wgpu-hal) to D3D12's own
/// record of 11 counters, so each query is resolved on its own into a 256-byte slot.
const STATS_PER_FRAME: u32 = 1344;
const STATS_PACKED: u64 = 24;
const STATS_D3D12_SLOT: u64 = 256;
/// D3D12_QUERY_DATA_PIPELINE_STATISTICS: VSInvocations, CPrimitives, PSInvocations, as byte offsets.
const D3D12_COUNTERS: [usize; 3] = [16, 48, 56];

struct Stats {
    set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    /// D3D12's record per query (one resolve each), not wgpu's packed counters.
    d3d12: bool,
}

impl Stats {
    fn stride(&self) -> u64 {
        if self.d3d12 { STATS_D3D12_SLOT } else { STATS_PACKED }
    }
}

pub struct Timing {
    set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    slots: Vec<Slot>,
    current: usize,
    per_frame: u32,
    /// The current frame is not timed (its slot is still mapping, or its range is full).
    skipping: bool,
    period_ns: f64,
    pub frames: Vec<FrameGpu>,
    pub untimed: u32,
    /// By name, over the frames read since the last `take_named`, and how many frames that is.
    named: HashMap<String, Named>,
    named_frames: u32,
    /// By (pass, mark) name, over the frames read since the last `take_named`.
    segments: HashMap<String, Named>,
    stats: Option<Stats>,
}

static TIMING: Mutex<Option<Timing>> = Mutex::new(None);
/// Whether timing is installed, and whether with marks, without the lock (the executor asks per pass and per bundle).
static ON: AtomicBool = AtomicBool::new(false);
static DETAILED: AtomicBool = AtomicBool::new(false);

/// Turns timing on for this device (it must have TIMESTAMP_QUERY; marks need TIMESTAMP_QUERY_INSIDE_PASSES, and are
/// left off without it). Answers whether it did.
pub fn install(device: &wgpu::Device, queue: &wgpu::Queue, detailed: bool) -> bool {
    if !device.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
        return false;
    }
    let detailed = detailed && device.features().contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES);
    let per_frame = if detailed { PER_FRAME_DETAILED } else { PER_FRAME };
    let total = per_frame * FRAMES as u32;
    let set = device.create_query_set(&wgpu::QuerySetDescriptor { label: Some("frame timing"), ty: wgpu::QueryType::Timestamp, count: total });
    let resolve = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("frame timing resolve"),
        size: total as u64 * 8,
        usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let with_stats = detailed && device.features().contains(wgpu::Features::PIPELINE_STATISTICS_QUERY);
    let d3d12 = std::env::var("WGPU_DX12_PIPELINE_STATISTICS").as_deref() == Ok("1");
    let stride = if d3d12 { STATS_D3D12_SLOT } else { STATS_PACKED };
    let stats = with_stats.then(|| Stats {
        d3d12,
        set: device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("frame pipeline statistics"),
            ty: wgpu::QueryType::PipelineStatistics(
                wgpu::PipelineStatisticsTypes::VERTEX_SHADER_INVOCATIONS
                    | wgpu::PipelineStatisticsTypes::CLIPPER_PRIMITIVES_OUT
                    | wgpu::PipelineStatisticsTypes::FRAGMENT_SHADER_INVOCATIONS,
            ),
            count: STATS_PER_FRAME * FRAMES as u32,
        }),
        resolve: device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("frame pipeline statistics resolve"),
            size: (STATS_PER_FRAME * FRAMES as u32) as u64 * stride,
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        }),
    });
    let slots = (0..FRAMES)
        .map(|_| Slot {
            readback: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("frame timing readback"),
                size: per_frame as u64 * 8,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            state: Arc::new(AtomicU8::new(FREE)),
            used: 0,
            entries: Vec::new(),
            stats_used: 0,
            stats_readback: with_stats.then(|| {
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("frame pipeline statistics readback"),
                    size: STATS_PER_FRAME as u64 * stride,
                    usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            }),
        })
        .collect();
    let period_ns = queue.get_timestamp_period() as f64;
    *TIMING.lock().unwrap() = Some(Timing {
        set,
        resolve,
        slots,
        current: 0,
        per_frame,
        skipping: false,
        period_ns,
        frames: Vec::new(),
        untimed: 0,
        named: HashMap::new(),
        named_frames: 0,
        segments: HashMap::new(),
        stats,
    });
    DETAILED.store(detailed, Ordering::Release);
    ON.store(true, Ordering::Release);
    true
}

pub fn installed() -> bool {
    ON.load(Ordering::Acquire)
}

/// Whether marks are taken inside passes.
pub fn detailed() -> bool {
    DETAILED.load(Ordering::Acquire)
}

/// The query set and the begin/end slots for a pass about to begin, when this frame is timed.
pub fn pass() -> Option<(wgpu::QuerySet, u32, u32)> {
    let mut guard = TIMING.lock().unwrap();
    let t = guard.as_mut()?;
    let per_frame = t.per_frame;
    let slot = &mut t.slots[t.current];
    if t.skipping || slot.state.load(Ordering::Acquire) != FREE || slot.used + 2 > per_frame {
        t.skipping = true;
        return None;
    }
    let at = slot.used;
    slot.used += 2;
    slot.entries.push(Entry::Pass { at, name: String::new(), draws: 0, stats: None });
    let base = t.current as u32 * per_frame + at;
    Some((t.set.clone(), base, base + 1))
}

/// The query set and slot for a mark inside the timed pass now open, named `name` (what follows it, up to the next
/// mark or the pass's end). None when the frame is not timed, marks are off, or the frame's range is full.
pub fn mark(name: impl FnOnce() -> String) -> Option<(wgpu::QuerySet, u32)> {
    if !detailed() {
        return None;
    }
    let mut guard = TIMING.lock().unwrap();
    let t = guard.as_mut()?;
    let per_frame = t.per_frame;
    let slot = &mut t.slots[t.current];
    // Room is kept for the passes still to come this frame (their pairs): marks give up first.
    if t.skipping || slot.state.load(Ordering::Acquire) != FREE || slot.used + 1 + 64 > per_frame {
        return None;
    }
    let at = slot.used;
    slot.used += 1;
    slot.entries.push(Entry::Mark { at, name: name(), stats: None });
    Some((t.set.clone(), t.current as u32 * per_frame + at))
}

/// A pipeline statistics query for the segment that starts at the pass or mark just taken (`pass`, `mark`), when the
/// device counts them: the executor begins it there and ends it at the next mark or the pass's end.
pub fn segment_stats() -> Option<(wgpu::QuerySet, u32)> {
    let mut guard = TIMING.lock().unwrap();
    let t = guard.as_mut()?;
    let set = t.stats.as_ref()?.set.clone();
    let current = t.current;
    let slot = &mut t.slots[current];
    if t.skipping || slot.stats_used + 1 > STATS_PER_FRAME {
        return None;
    }
    let q = slot.stats_used;
    match slot.entries.last_mut() {
        Some(Entry::Pass { stats, .. }) | Some(Entry::Mark { stats, .. }) if stats.is_none() => *stats = Some(q),
        _ => return None,
    }
    slot.stats_used += 1;
    Some((set, current as u32 * STATS_PER_FRAME + q))
}

/// Names the pass whose begin slot is `begin` (what `pass` gave) and counts its draws.
pub fn name(begin: u32, name: String, draws: u32) {
    let mut guard = TIMING.lock().unwrap();
    let Some(t) = guard.as_mut() else { return };
    let per_frame = t.per_frame;
    let slot = &mut t.slots[(begin / per_frame) as usize % FRAMES];
    let want = begin % per_frame;
    for entry in slot.entries.iter_mut().rev() {
        if let Entry::Pass { at, name: n, draws: d, .. } = entry {
            if *at == want {
                *n = name;
                *d = draws;
                return;
            }
        }
    }
}

/// The host's frame is over: resolve its timestamps toward its readback and map it.
pub fn end_frame(device: &wgpu::Device, queue: &wgpu::Queue) {
    let mut guard = TIMING.lock().unwrap();
    let Some(t) = guard.as_mut() else { return };
    let current = t.current;
    let used = t.slots[current].used;
    if t.skipping || used == 0 {
        if t.skipping {
            t.untimed += 1;
        }
        // A skipped frame's slots (if it took any before skipping) are dropped with it.
        if t.slots[current].state.load(Ordering::Acquire) == FREE {
            t.slots[current].used = 0;
            t.slots[current].stats_used = 0;
            t.slots[current].entries.clear();
        }
    } else {
        let base = current as u32 * t.per_frame;
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("frame timing") });
        encoder.resolve_query_set(&t.set, base..base + used, &t.resolve, base as u64 * 8);
        encoder.copy_buffer_to_buffer(&t.resolve, base as u64 * 8, &t.slots[current].readback, 0, used as u64 * 8);
        let stats_used = t.slots[current].stats_used;
        let stride = t.stats.as_ref().map_or(STATS_PACKED, Stats::stride);
        let stats_bytes = stats_used as u64 * stride;
        if let (Some(stats), Some(readback)) = (t.stats.as_ref(), t.slots[current].stats_readback.as_ref()) {
            if stats_used > 0 {
                let sbase = current as u32 * STATS_PER_FRAME;
                if stats.d3d12 {
                    for q in sbase..sbase + stats_used {
                        encoder.resolve_query_set(&stats.set, q..q + 1, &stats.resolve, q as u64 * stride);
                    }
                } else {
                    encoder.resolve_query_set(&stats.set, sbase..sbase + stats_used, &stats.resolve, sbase as u64 * stride);
                }
                encoder.copy_buffer_to_buffer(&stats.resolve, sbase as u64 * stride, readback, 0, stats_bytes);
            }
        }
        queue.submit([encoder.finish()]);
        let state = t.slots[current].state.clone();
        state.store(MAPPING, Ordering::Release);
        // READY once every map this frame made has completed (the timestamps', and the statistics' when taken).
        let stats_map = stats_used > 0 && t.slots[current].stats_readback.is_some();
        let remaining = Arc::new(std::sync::atomic::AtomicU32::new(if stats_map { 2 } else { 1 }));
        let failed = Arc::new(AtomicBool::new(false));
        let done = move |ok: bool| {
            if !ok {
                failed.store(true, Ordering::Release);
            }
            if remaining.fetch_sub(1, Ordering::AcqRel) == 1 {
                state.store(if failed.load(Ordering::Acquire) { FREE } else { READY }, Ordering::Release);
            }
        };
        let done2 = done.clone();
        t.slots[current].readback.slice(..used as u64 * 8).map_async(wgpu::MapMode::Read, move |r| done(r.is_ok()));
        if stats_map {
            t.slots[current].stats_readback.as_ref().unwrap().slice(..stats_bytes).map_async(wgpu::MapMode::Read, move |r| done2(r.is_ok()));
        }
    }
    t.current = (current + 1) % FRAMES;
    t.skipping = false;
}

/// Reads the frames whose maps completed (the host polled since) into `frames`.
pub fn collect() {
    let mut guard = TIMING.lock().unwrap();
    let Some(t) = guard.as_mut() else { return };
    let period = t.period_ns;
    for i in 0..FRAMES {
        let slot = &mut t.slots[i];
        if slot.state.load(Ordering::Acquire) != READY {
            continue;
        }
        let used = slot.used as u64;
        let stamps: Vec<u64> = slot
            .readback
            .slice(..used * 8)
            .get_mapped_range()
            .map(|view| view.chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect())
            .unwrap_or_default();
        slot.readback.unmap();
        // Each statistics query's counters: vertex shader invocations, clipped primitives, fragment shader invocations.
        let (stride, offsets) = match t.stats.as_ref() {
            Some(s) if s.d3d12 => (STATS_D3D12_SLOT, D3D12_COUNTERS),
            _ => (STATS_PACKED, [0, 8, 16]),
        };
        let counters: Vec<[u64; 3]> = match slot.stats_readback.as_ref() {
            Some(readback) if slot.stats_used > 0 => {
                let bytes = slot.stats_used as u64 * stride;
                let v = readback
                    .slice(..bytes)
                    .get_mapped_range()
                    .map(|view| {
                        view.chunks_exact(stride as usize)
                            .map(|c| offsets.map(|o| u64::from_le_bytes(c[o..o + 8].try_into().unwrap())))
                            .collect()
                    })
                    .unwrap_or_default();
                readback.unmap();
                v
            }
            _ => Vec::new(),
        };
        slot.used = 0;
        slot.stats_used = 0;
        let entries = std::mem::take(&mut slot.entries);
        slot.state.store(FREE, Ordering::Release);
        let ms = |ticks: u64| ticks as f64 * period / 1e6;
        let stamp = |at: u32| stamps.get(at as usize).copied().unwrap_or(0);
        let mut f = FrameGpu::default();
        let (mut first, mut last) = (u64::MAX, 0u64);
        let mut n = 0usize;
        let mut k = 0usize;
        while k < entries.len() {
            let Entry::Pass { at, name, draws, stats: pass_stats } = &entries[k] else {
                k += 1;
                continue;
            };
            // The marks taken inside this pass follow it.
            let mut end_marks = k + 1;
            while end_marks < entries.len() && matches!(entries[end_marks], Entry::Mark { .. }) {
                end_marks += 1;
            }
            let (b, e) = (stamp(*at), stamp(*at + 1));
            // A pass the GPU never ran (or a driver that wrote nothing) reads 0.
            if b != 0 && e >= b {
                let d = ms(e - b);
                if n < f.pass_ms.len() {
                    f.pass_ms[n] = d;
                }
                f.busy_ms += d;
                f.passes += 1;
                if d > f.longest_ms {
                    f.longest_ms = d;
                    f.longest = n as u32;
                }
                first = first.min(b);
                last = last.max(e);
                let label = if name.is_empty() { "unnamed" } else { name.as_str() };
                let entry = t.named.entry(label.to_string()).or_default();
                entry.ms += d;
                entry.passes += 1;
                entry.draws += *draws as u64;
                // The pass split at its marks: begin to the first mark, then each mark to the next (or the end).
                if end_marks > k + 1 {
                    let counted = |q: &Option<u32>| q.and_then(|q| counters.get(q as usize).copied());
                    let mut pass_counts = [0u64; 3];
                    let mut add = |segment: &str, from: u64, to: u64, c: Option<[u64; 3]>| {
                        if from != 0 && to >= from {
                            let s = t.segments.entry(format!("{label} :: {segment}")).or_default();
                            s.ms += ms(to - from);
                            s.passes += 1;
                            if let Some(c) = c {
                                s.vertices += c[0];
                                s.primitives += c[1];
                                s.fragments += c[2];
                                for i in 0..3 {
                                    pass_counts[i] += c[i];
                                }
                            }
                        }
                    };
                    let mut prev = ("(pass begin)", b, counted(pass_stats));
                    for m in &entries[k + 1..end_marks] {
                        if let Entry::Mark { at, name, stats } = m {
                            let s = stamp(*at);
                            add(prev.0, prev.1, s, prev.2);
                            prev = (name.as_str(), s, counted(stats));
                        }
                    }
                    add(prev.0, prev.1, e, prev.2);
                    let entry = t.named.entry(label.to_string()).or_default();
                    entry.vertices += pass_counts[0];
                    entry.primitives += pass_counts[1];
                    entry.fragments += pass_counts[2];
                }
                n += 1;
            }
            k = end_marks;
        }
        if f.passes > 0 {
            f.span_ms = ms(last - first);
            t.frames.push(f);
            t.named_frames += 1;
        }
    }
}

/// The frames read since the last take, and how many frames went untimed.
pub fn take() -> (Vec<FrameGpu>, u32) {
    let mut guard = TIMING.lock().unwrap();
    let Some(t) = guard.as_mut() else { return (Vec::new(), 0) };
    (std::mem::take(&mut t.frames), std::mem::take(&mut t.untimed))
}

/// The named passes' totals since the last take, most GPU time first, and over how many frames. With marks, the
/// segments' totals too (the third), most first; their frames are the same.
pub fn take_named() -> (Vec<(String, Named)>, u32, Vec<(String, Named)>) {
    let mut guard = TIMING.lock().unwrap();
    let Some(t) = guard.as_mut() else { return (Vec::new(), 0, Vec::new()) };
    let mut list: Vec<(String, Named)> = std::mem::take(&mut t.named).into_iter().collect();
    list.sort_by(|a, b| b.1.ms.total_cmp(&a.1.ms));
    let mut segments: Vec<(String, Named)> = std::mem::take(&mut t.segments).into_iter().collect();
    segments.sort_by(|a, b| b.1.ms.total_cmp(&a.1.ms));
    (list, std::mem::take(&mut t.named_frames), segments)
}
