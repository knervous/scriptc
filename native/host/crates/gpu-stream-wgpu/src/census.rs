//! GPU memory the page holds, by kind: every buffer and texture the executor creates is counted
//! at its allocation size (mips, layers and samples included; drivers pad and align on top) until
//! the core destroys it or reuses its id. Always on: a create costs one map insert.
//!
//! `report()` is one line for the host's periodic stats (the host's memory census); `largest()` names the
//! biggest live textures, the usual answer to "where did the memory go".

use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    /// Sampled textures in a block-compressed format (BC, ETC2, ASTC).
    TexCompressed,
    /// Sampled textures stored uncompressed (RGBA8, R16F...): KTX2 transcoded to RGBA, data textures.
    TexPlain,
    /// Render targets and storage textures (deferred targets, shadow maps, post chains).
    TexTarget,
    /// Depth and stencil.
    TexDepth,
    BufVertex,
    BufUniform,
    BufStorage,
    /// MAP_READ / MAP_WRITE staging.
    BufStaging,
    BufOther,
}

const KINDS: [(Kind, &str); 9] = [
    (Kind::TexCompressed, "tex.bc"),
    (Kind::TexPlain, "tex.plain"),
    (Kind::TexTarget, "tex.target"),
    (Kind::TexDepth, "tex.depth"),
    (Kind::BufVertex, "buf.vtx"),
    (Kind::BufUniform, "buf.uni"),
    (Kind::BufStorage, "buf.sto"),
    (Kind::BufStaging, "buf.map"),
    (Kind::BufOther, "buf.other"),
];

#[derive(Clone, Debug)]
pub struct Entry {
    pub kind: Kind,
    pub bytes: u64,
    /// Textures: `WxHxL fmt mips`.
    pub what: String,
}

#[derive(Default)]
struct Census {
    buffers: HashMap<u32, Entry>,
    textures: HashMap<u32, Entry>,
    peak: u64,
}

static CENSUS: Mutex<Option<Census>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut Census) -> R) -> R {
    f(CENSUS.lock().unwrap().get_or_insert_with(Census::default))
}

fn total(c: &Census) -> u64 {
    c.buffers.values().chain(c.textures.values()).map(|e| e.bytes).sum()
}

pub(crate) fn buffer(id: u32, size: u64, usage: wgpu::BufferUsages) {
    use wgpu::BufferUsages as U;
    let kind = if usage.intersects(U::MAP_READ | U::MAP_WRITE) {
        Kind::BufStaging
    } else if usage.intersects(U::VERTEX | U::INDEX) {
        Kind::BufVertex
    } else if usage.contains(U::STORAGE) {
        Kind::BufStorage
    } else if usage.contains(U::UNIFORM) {
        Kind::BufUniform
    } else {
        Kind::BufOther
    };
    with(|c| {
        c.buffers.insert(id, Entry { kind, bytes: size, what: String::new() });
        c.peak = c.peak.max(total(c));
    });
}

pub(crate) fn texture(id: u32, d: &wgpu::TextureDescriptor) {
    use wgpu::TextureUsages as U;
    let f = d.format;
    let kind = if f.is_depth_stencil_format() {
        Kind::TexDepth
    } else if d.usage.intersects(U::RENDER_ATTACHMENT | U::STORAGE_BINDING) {
        Kind::TexTarget
    } else if f.is_compressed() {
        Kind::TexCompressed
    } else {
        Kind::TexPlain
    };
    let bytes = texture_bytes(d);
    let what = format!("{}x{}x{} {:?} {}mip {}", d.size.width, d.size.height, d.size.depth_or_array_layers, f, d.mip_level_count, d.label.unwrap_or(""));
    with(|c| {
        c.textures.insert(id, Entry { kind, bytes, what });
        c.peak = c.peak.max(total(c));
    });
}

pub(crate) fn drop_buffer(id: u32) {
    with(|c| c.buffers.remove(&id));
}

pub(crate) fn drop_texture(id: u32) {
    with(|c| c.textures.remove(&id));
}

/// A texture's bytes at rest: each mip's blocks times the block size, times layers and samples.
pub fn texture_bytes(d: &wgpu::TextureDescriptor) -> u64 {
    let f = d.format;
    let block = f.block_copy_size(None).map(u64::from).unwrap_or_else(|| {
        // Combined depth-stencil formats have no single block size.
        let depth = f.block_copy_size(Some(wgpu::TextureAspect::DepthOnly)).unwrap_or(4);
        let stencil = f.block_copy_size(Some(wgpu::TextureAspect::StencilOnly)).unwrap_or(0);
        u64::from(depth + stencil)
    });
    let (bw, bh) = f.block_dimensions();
    let three_d = d.dimension == wgpu::TextureDimension::D3;
    let mut sum = 0u64;
    for level in 0..d.mip_level_count.max(1) {
        let w = (d.size.width >> level).max(1).div_ceil(bw) as u64;
        let h = (d.size.height >> level).max(1).div_ceil(bh) as u64;
        let z = if three_d { (d.size.depth_or_array_layers >> level).max(1) } else { d.size.depth_or_array_layers.max(1) } as u64;
        sum += w * h * z * block;
    }
    sum * u64::from(d.sample_count.max(1))
}

fn mb(b: u64) -> f64 {
    b as f64 / 1048576.0
}

/// `gpu mem 812 MB (peak 900): tex.bc 410/1203 · tex.target 220/31 · ...` (MB/count, largest kinds first).
pub fn report() -> String {
    with(|c| {
        let mut by: HashMap<Kind, (u64, u32)> = HashMap::new();
        for e in c.buffers.values().chain(c.textures.values()) {
            let s = by.entry(e.kind).or_default();
            s.0 += e.bytes;
            s.1 += 1;
        }
        let mut rows: Vec<(Kind, u64, u32)> = by.into_iter().map(|(k, (b, n))| (k, b, n)).collect();
        rows.sort_by(|a, b| b.1.cmp(&a.1));
        let name = |k: Kind| KINDS.iter().find(|(x, _)| *x == k).map_or("?", |(_, n)| n);
        let parts: Vec<String> = rows.iter().map(|(k, b, n)| format!("{} {:.0}/{n}", name(*k), mb(*b))).collect();
        format!("gpu mem {:.0} MB (peak {:.0}): {}", mb(total(c)), mb(c.peak), parts.join(" · "))
    })
}

/// Live textures' bytes and count by kind and format, largest first (`tex.bc Bc7RgbaUnormSrgb 300 MB/412 · ...`).
pub fn by_format() -> String {
    with(|c| {
        let mut by: HashMap<(Kind, String), (u64, u32)> = HashMap::new();
        for e in c.textures.values() {
            let format = e.what.split(' ').nth(1).unwrap_or("?").to_string();
            let s = by.entry((e.kind, format)).or_default();
            s.0 += e.bytes;
            s.1 += 1;
        }
        let mut rows: Vec<_> = by.into_iter().collect();
        rows.sort_by(|a, b| b.1.0.cmp(&a.1.0));
        let name = |k: Kind| KINDS.iter().find(|(x, _)| *x == k).map_or("?", |(_, n)| n);
        rows.iter().map(|((k, f), (b, n))| format!("{} {f} {:.0} MB/{n}", name(*k), mb(*b))).collect::<Vec<_>>().join(" · ")
    })
}

/// The `n` largest live textures, biggest first.
pub fn largest(n: usize) -> Vec<Entry> {
    with(|c| {
        let mut all: Vec<Entry> = c.textures.values().cloned().collect();
        all.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        all.truncate(n);
        all
    })
}

/// The `n` largest live textures of one kind, biggest first (the host's memory census by kind: which uncompressed textures a scene holds).
pub fn largest_of(kind: Kind, n: usize) -> Vec<Entry> {
    with(|c| {
        let mut all: Vec<Entry> = c.textures.values().filter(|e| e.kind == kind).cloned().collect();
        all.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        all.truncate(n);
        all
    })
}

/// Live bytes of one kind (for budgets).
pub fn bytes(kind: Kind) -> u64 {
    with(|c| c.buffers.values().chain(c.textures.values()).filter(|e| e.kind == kind).map(|e| e.bytes).sum())
}
