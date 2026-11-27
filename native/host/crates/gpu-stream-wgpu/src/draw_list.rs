//! DRAW_LIST (gpu-stream-format `op::CREATE_DRAW_LIST` .. `op::DRAW_LIST`, `DRAW_LIST_BUCKET_WORDS`): a list of buckets, each a pipeline, its bind groups and vertex and index buffers, and a
//! contiguous range of standard indexed-indirect rows (5 u32: indexCount, instanceCount, firstIndex, baseVertex,
//! firstInstance) in an args buffer, with an optional u32 count. Natively a bucket is ONE
//! `multi_draw_indexed_indirect_count` recorded straight into the render pass (wgpu 30 cannot multi-draw inside a
//! bundle): one ExecuteIndirect for the whole range on D3D12, instead of a replayed draw and its state per row. The web's
//! executor runs the same list as a render bundle of one drawIndexedIndirect per row.
//!
//! The executor knows only handles it already owns: no meshes, materials or culling. The list is replaced whole by
//! SET_DRAW_LIST (when its buckets change, not per frame); the rows and counts are ordinary buffer contents the page (or
//! a compute pass of its) writes. After DRAW_LIST the pass's pipeline, bind groups and buffers are undefined, as after
//! executeBundles.

use crate::{ExecError, Executor, get, keep, pick, tables};

/// A bucket's size in the SET_DRAW_LIST bytes: 32 little-endian u32:
/// [0] pipeline, [1] group count (<= 4), [2..6] group ids by index (0: none), [6] vertex buffer count (<= 8),
/// [7..23] per slot (buffer id, byte offset), [23] index buffer, [24] its byte offset, [25] index format (0 uint16,
/// 1 uint32), [26] args buffer, [27] the bucket's first row's byte offset, [28] max rows, [29] count buffer (0: none),
/// [30] its byte offset, [31] flags (0).
pub const BUCKET_WORDS: usize = 32;
/// One indexed-indirect row (DrawIndexedIndirectArgs).
pub const ROW_BYTES: u64 = 20;

/// One bucket: state set once, then its rows drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Bucket {
    pub pipeline: u32,
    /// Bind groups by index (0: none set at that index).
    pub groups: [u32; 4],
    pub group_count: u32,
    /// Vertex buffers by slot: (buffer id, byte offset).
    pub vertex: [(u32, u32); 8],
    pub vertex_count: u32,
    /// Index buffer id, byte offset, format (0 uint16, 1 uint32).
    pub index: (u32, u32, u32),
    /// Args buffer id and the byte offset of the bucket's first row.
    pub args: (u32, u32),
    pub max_rows: u32,
    /// Count buffer id (0: none, all `max_rows` drawn) and its byte offset.
    pub count: (u32, u32),
    pub flags: u32,
}

/// The buckets of a SET_DRAW_LIST's bytes (`n` of them).
pub fn parse(bytes: &[u8], n: usize) -> Result<Vec<Bucket>, ExecError> {
    if bytes.len() < n * BUCKET_WORDS * 4 {
        return Err(ExecError::Truncated);
    }
    let word = |b: usize, k: usize| {
        let at = (b * BUCKET_WORDS + k) * 4;
        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    };
    let mut out = Vec::with_capacity(n);
    for b in 0..n {
        let w = |k| word(b, k);
        let bucket = Bucket {
            pipeline: w(0),
            group_count: w(1),
            groups: [w(2), w(3), w(4), w(5)],
            vertex_count: w(6),
            vertex: std::array::from_fn(|k| (w(7 + 2 * k), w(8 + 2 * k))),
            index: (w(23), w(24), w(25)),
            args: (w(26), w(27)),
            max_rows: w(28),
            count: (w(29), w(30)),
            flags: w(31),
        };
        if bucket.group_count > 4 || bucket.vertex_count > 8 || bucket.index.2 > 1 || bucket.args.1 % 4 != 0 || bucket.count.1 % 4 != 0 {
            return Err(ExecError::State("bad draw-list bucket"));
        }
        out.push(bucket);
    }
    Ok(out)
}

/// GPU_STREAM_MDI_MIN_ROWS: buckets with fewer rows draw row by row (0 by default: always one multi-draw).
fn mdi_min_rows() -> u32 {
    static MIN: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *MIN.get_or_init(|| std::env::var("GPU_STREAM_MDI_MIN_ROWS").ok().and_then(|v| v.parse().ok()).unwrap_or(0))
}

impl Executor {
    /// DRAW_LIST: every bucket of list `id` into the open render pass.
    pub(crate) fn draw_list(&mut self, id: u32) -> Result<(), ExecError> {
        if self.benc.is_some() {
            return Err(ExecError::State("DRAW_LIST inside a render bundle"));
        }
        let buckets = get(&self.draw_lists, id, "draw list")?.clone();
        let count_draws = self.device.features().contains(wgpu::Features::MULTI_DRAW_INDIRECT_COUNT);
        for b in &buckets {
            if b.max_rows == 0 {
                continue;
            }
            // A pipeline still compiling on the compile threads is waited for, as SET_PIPELINE does.
            self.settle(true, b.pipeline);
            let pipeline = get(&self.render_pipelines, b.pipeline, "render pipeline")?.clone();
            let mut groups = Vec::with_capacity(b.group_count as usize);
            for (i, &g) in b.groups.iter().take(b.group_count as usize).enumerate() {
                if g != 0 {
                    groups.push((i as u32, get(&self.groups, g, "bind group")?.clone()));
                }
            }
            // An offset past its buffer is refused here (wgpu's slice would panic on it).
            let within = |buffer: &wgpu::Buffer, offset: u32| if (offset as u64) < buffer.size() { Ok(()) } else { Err(ExecError::State("draw-list offset past its buffer")) };
            let mut vertex = Vec::with_capacity(b.vertex_count as usize);
            for (slot, &(buffer, offset)) in b.vertex.iter().take(b.vertex_count as usize).enumerate() {
                let buffer = keep(get(&self.buffers, buffer, "buffer")?);
                within(buffer, offset)?;
                vertex.push((slot as u32, buffer, offset as u64));
            }
            let index = keep(get(&self.buffers, b.index.0, "buffer")?);
            within(index, b.index.1)?;
            let format: wgpu::IndexFormat = pick(tables::INDEX_FORMATS, b.index.2)?;
            let args = keep(get(&self.buffers, b.args.0, "buffer")?);
            let count = if b.count.0 != 0 { Some(keep(get(&self.buffers, b.count.0, "buffer")?)) } else { None };
            if crate::profile::enabled() {
                self.prof.n[crate::profile::SLOT_LIST_BUCKETS] += 1;
                self.prof.n[crate::profile::SLOT_LIST_ROWS] += b.max_rows as u64;
            }
            let pass = self.rpass()?;
            pass.set_pipeline(&pipeline);
            for (i, g) in &groups {
                pass.set_bind_group(*i, g, &[]);
            }
            for (slot, buffer, offset) in &vertex {
                pass.set_vertex_buffer(*slot, buffer.slice(*offset..));
            }
            pass.set_index_buffer(index.slice(b.index.1 as u64..), format);
            // GPU_STREAM_MDI_MIN_ROWS: a bucket under that many rows drawn row by row instead (its rows past the count draw
            // nothing). Measured no better (examples/drawlist.rs: 5-row buckets 2.1-2.2 ms row by row against 1.5-1.7 ms
            // as multi-draws, 2500 rows), so off by default; small buckets belong in a bundle on the page's side.
            if b.max_rows < mdi_min_rows() {
                for row in 0..b.max_rows as u64 {
                    pass.draw_indexed_indirect(args, b.args.1 as u64 + row * ROW_BYTES);
                }
                self.stats.draw_list_buckets += 1;
                continue;
            }
            match count {
                Some(c) if count_draws => pass.multi_draw_indexed_indirect_count(args, b.args.1 as u64, c, b.count.1 as u64, b.max_rows),
                // No count on this device: every row (those past the count carry instanceCount 0, by the layout's rule).
                _ => pass.multi_draw_indexed_indirect(args, b.args.1 as u64, b.max_rows),
            }
            self.stats.draw_list_buckets += 1;
        }
        Ok(())
    }
}
