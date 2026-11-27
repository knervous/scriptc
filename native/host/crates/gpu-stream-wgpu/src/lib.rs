//! An executor for a WebGPU command stream (gpu-stream-format), on wgpu.
//!
//! An encoder (the "core": whatever records a program's WebGPU calls, on this thread or in a wasm module's memory)
//! writes every WebGPU call as `[op, n, args...]` words plus a staging arena of upload bytes;
//! `Executor::execute` decodes one flushed stream and replays it against a wgpu
//! device, in order, with a browser executor's semantics:
//!
//! - Handle tables (buffers, shaders, pipelines, bind groups, ...) are indexed by
//!   the core's integer ids. `DESTROY` destroys (buffers, textures) and releases.
//! - Writes are made from the staging bytes, in pieces of at most 4 MiB.
//! - The command encoder is created lazily; `SUBMIT` finishes it (or submits
//!   nothing when none is open) and submits.
//! - A ticket is completed with its data stored first and its state last
//!   (`CoreLink::complete`), so a reader that sees DONE or FAILED sees the data.
//! - A failed call (unknown op, dead handle, malformed stream) aborts the
//!   stream, marks the core lost (first message wins) and returns the error.
//!   A lost device marks the core lost too.
//!
//! JS-only things and their native equivalents:
//!
//! - Promises (`mapAsync`, `onSubmittedWorkDone`, `popErrorScope`) complete
//!   inside `Executor::poll` (`Device::poll`), the native equivalent of the JS
//!   event loop turning. Nothing completes until the host polls.
//! - The ticket table, limits and lost word are reached through `CoreLink`
//!   (`TicketTable` in process; `MemoryLink` over a wasm core's memory).
//! - WebGPU validation errors never throw: they surface through error scopes,
//!   or as uncaptured errors (counted in `UNCAPTURED_ERRORS`, printed).
//! - Enums cross as indices into the core's tables (`tables`), mapped to wgpu
//!   values by their WebGPU names (`parse`).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::future::Future;
use std::num::NonZeroU64;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

pub use wgpu;

mod memory_link;
pub use memory_link::{Layout, MemoryLink};
pub mod census;
pub mod draw_list;
pub mod profile;
pub mod tables;
pub mod timing;

// The stream's format (opcodes, ticket states, the ticket table's size, the message bound): gpu-stream-format, the
// definition its encoders write by.
pub use gpu_stream_format::{MESSAGE_BYTES, TICKET_DONE, TICKET_FAILED, TICKET_FREE, TICKET_PENDING, TICKETS, op};
pub use gpu_stream_format as format;
/// Writes go in pieces of at most 4 MiB (as the Dawn executor's).
pub const WRITE_CHUNK_BYTES: usize = 4 << 20;

/// What the executor needs from the core's side of the shared state: the
/// ticket table and the lost word. Implementations must store a ticket's data
/// before its state (the JS executor's `Atomics.store` after the data).
pub trait CoreLink: Send + Sync {
    /// Bytes the ticket's region can hold (an error scope's message is cut to this).
    fn ticket_cap(&self, t: u32) -> usize;
    /// Store `data`, the status (0 ok, else failed) and the length, then the state.
    fn complete(&self, t: u32, status: u32, data: &[u8]);
    fn is_lost(&self) -> bool;
    /// Mark the core lost with a message (already cut to `MESSAGE_BYTES`).
    fn mark_lost(&self, message: &[u8]);
}

struct Slot {
    state: AtomicU32,
    status: AtomicU32,
    len: AtomicU32,
    cap: AtomicU32,
    data: Mutex<Vec<u8>>,
}

/// An in-process ticket table and lost word: the same slot words the core
/// shares with the JS executor (state, status, len), plus the data region.
pub struct TicketTable {
    slots: Vec<Slot>,
    lost: AtomicU32,
    lost_message: Mutex<Vec<u8>>,
}

impl TicketTable {
    pub fn new() -> Arc<TicketTable> {
        Arc::new(TicketTable {
            slots: (0..TICKETS)
                .map(|_| Slot {
                    state: AtomicU32::new(TICKET_FREE),
                    status: AtomicU32::new(0),
                    len: AtomicU32::new(0),
                    cap: AtomicU32::new(MESSAGE_BYTES as u32),
                    data: Mutex::new(Vec::new()),
                })
                .collect(),
            lost: AtomicU32::new(0),
            lost_message: Mutex::new(Vec::new()),
        })
    }
    /// The core's side of taking a ticket: pending, with `cap` bytes for a message.
    pub fn arm(&self, t: u32, cap: usize) {
        let s = &self.slots[t as usize];
        s.status.store(0, Ordering::Relaxed);
        s.len.store(0, Ordering::Relaxed);
        s.cap.store(cap as u32, Ordering::Relaxed);
        s.data.lock().unwrap().clear();
        s.state.store(TICKET_PENDING, Ordering::SeqCst);
    }
    pub fn state(&self, t: u32) -> u32 {
        self.slots.get(t as usize).map_or(TICKET_FREE, |s| s.state.load(Ordering::SeqCst))
    }
    pub fn status(&self, t: u32) -> u32 {
        self.slots.get(t as usize).map_or(0, |s| s.status.load(Ordering::Relaxed))
    }
    /// Bytes of the result (0 until done).
    pub fn len(&self, t: u32) -> usize {
        if self.state(t) < TICKET_DONE {
            return 0;
        }
        self.slots[t as usize].len.load(Ordering::Relaxed) as usize
    }
    /// The result's bytes, once done.
    pub fn read(&self, t: u32) -> Option<Vec<u8>> {
        if self.state(t) < TICKET_DONE {
            return None;
        }
        let data = self.slots[t as usize].data.lock().unwrap();
        Some(data[..self.len(t).min(data.len())].to_vec())
    }
    pub fn release(&self, t: u32) {
        let s = &self.slots[t as usize];
        s.data.lock().unwrap().clear();
        s.state.store(TICKET_FREE, Ordering::SeqCst);
    }
    pub fn lost(&self) -> bool {
        self.lost.load(Ordering::SeqCst) != 0
    }
    pub fn lost_message(&self) -> String {
        String::from_utf8_lossy(&self.lost_message.lock().unwrap()).into_owned()
    }
}

impl CoreLink for TicketTable {
    fn ticket_cap(&self, t: u32) -> usize {
        self.slots[t as usize].cap.load(Ordering::Relaxed) as usize
    }
    fn complete(&self, t: u32, status: u32, data: &[u8]) {
        let s = &self.slots[t as usize];
        *s.data.lock().unwrap() = data.to_vec();
        s.status.store(status, Ordering::Relaxed);
        s.len.store(data.len() as u32, Ordering::Relaxed);
        s.state.store(if status == 0 { TICKET_DONE } else { TICKET_FAILED }, Ordering::SeqCst);
    }
    fn is_lost(&self) -> bool {
        self.lost()
    }
    fn mark_lost(&self, message: &[u8]) {
        *self.lost_message.lock().unwrap() = message.to_vec();
        self.lost.store(1, Ordering::SeqCst);
    }
}

/// Counters, as the JS executor's `stats`.
#[derive(Default, Clone, Copy, Debug)]
pub struct Stats {
    pub flushes: u64,
    pub commands: u64,
    pub writes: u64,
    pub write_bytes: u64,
    pub submits: u64,
    pub tickets: u64,
    /// DRAW_LIST buckets drawn (each one multi-draw).
    pub draw_list_buckets: u64,
}

/// A failed stream. The core was marked lost with `executor: <message>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecError {
    UnknownOp(u32),
    /// A command or its arguments run past the end of the stream or staging.
    Truncated,
    /// A handle that was never created or was destroyed.
    DeadHandle { kind: &'static str, id: u32 },
    /// A command outside the state it needs (a pass command with no pass open).
    State(&'static str),
    /// The device could not do what was asked synchronously.
    Device(String),
}

impl fmt::Display for ExecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecError::UnknownOp(op) => write!(f, "unknown core GPU op {op}"),
            ExecError::Truncated => write!(f, "stream or staging truncated"),
            ExecError::DeadHandle { kind, id } => write!(f, "dead {kind} handle {id}"),
            ExecError::State(s) => write!(f, "{s}"),
            ExecError::Device(s) => write!(f, "{s}"),
        }
    }
}
impl std::error::Error for ExecError {}

/// Cut `message` to `cap` bytes (the JS `subarray(0, cap)` on the encoded text).
fn cut(message: &str, cap: usize) -> &[u8] {
    &message.as_bytes()[..message.len().min(cap)]
}

/// A failed call is the device's end for the core: every later call refuses.
/// The first message wins.
fn fail(link: &dyn CoreLink, message: &str) {
    if link.is_lost() {
        return;
    }
    link.mark_lost(cut(message, MESSAGE_BYTES));
}

/// Uncaptured WebGPU errors so far: a run that reports none drew what it asked for.
pub static UNCAPTURED_ERRORS: AtomicU32 = AtomicU32::new(0);

/// A WebGPU enum value by its name (the core's tables), through wgpu-types'
/// WebGPU-name deserializers.
pub fn parse<T: for<'de> serde::Deserialize<'de>>(name: &str) -> Option<T> {
    use serde::de::IntoDeserializer;
    let d: serde::de::value::StrDeserializer<'_, serde::de::value::Error> = name.into_deserializer();
    T::deserialize(d).ok()
}

/// The table entry `index` names, parsed.
fn pick<T: for<'de> serde::Deserialize<'de>>(table: &[&str], index: u32) -> Result<T, ExecError> {
    let name = table.get(index as usize).ok_or(ExecError::State("enum index out of range"))?;
    parse(name).ok_or(ExecError::State("enum name wgpu does not know"))
}

/// An optional enum: 0 absent, else index + 1.
fn pick_opt<T: for<'de> serde::Deserialize<'de>>(table: &[&str], v: u32) -> Result<Option<T>, ExecError> {
    if v == 0 { Ok(None) } else { pick(table, v - 1).map(Some) }
}

fn name(table: &[&str], index: u32) -> Result<&'static str, ExecError>
where
{
    // The tables are 'static: the name outlives the call.
    let s: &str = table.get(index as usize).ok_or(ExecError::State("enum index out of range"))?;
    // SAFETY-free: every table is a `&'static [&'static str]`.
    Ok(unsafe { std::mem::transmute::<&str, &'static str>(s) })
}

/// Mappings whose WebGPU names do not deserialize into the wgpu type directly.
mod map {
    use super::*;

    pub fn texture_dimension(s: &str) -> Result<wgpu::TextureDimension, ExecError> {
        Ok(match s {
            "1d" => wgpu::TextureDimension::D1,
            "2d" => wgpu::TextureDimension::D2,
            "3d" => wgpu::TextureDimension::D3,
            _ => return Err(ExecError::State("unknown texture dimension")),
        })
    }
    pub fn view_dimension(s: &str) -> Result<wgpu::TextureViewDimension, ExecError> {
        Ok(match s {
            "1d" => wgpu::TextureViewDimension::D1,
            "2d" => wgpu::TextureViewDimension::D2,
            "2d-array" => wgpu::TextureViewDimension::D2Array,
            "cube" => wgpu::TextureViewDimension::Cube,
            "cube-array" => wgpu::TextureViewDimension::CubeArray,
            "3d" => wgpu::TextureViewDimension::D3,
            _ => return Err(ExecError::State("unknown view dimension")),
        })
    }
    pub fn buffer_binding(s: &str) -> Result<wgpu::BufferBindingType, ExecError> {
        Ok(match s {
            "uniform" => wgpu::BufferBindingType::Uniform,
            "storage" => wgpu::BufferBindingType::Storage { read_only: false },
            "read-only-storage" => wgpu::BufferBindingType::Storage { read_only: true },
            _ => return Err(ExecError::State("unknown buffer binding type")),
        })
    }
    pub fn sample_type(s: &str) -> Result<wgpu::TextureSampleType, ExecError> {
        Ok(match s {
            "float" => wgpu::TextureSampleType::Float { filterable: true },
            "unfilterable-float" => wgpu::TextureSampleType::Float { filterable: false },
            "depth" => wgpu::TextureSampleType::Depth,
            "sint" => wgpu::TextureSampleType::Sint,
            "uint" => wgpu::TextureSampleType::Uint,
            _ => return Err(ExecError::State("unknown sample type")),
        })
    }
    pub fn cull(s: &str) -> Result<Option<wgpu::Face>, ExecError> {
        Ok(match s {
            "none" => None,
            "front" => Some(wgpu::Face::Front),
            "back" => Some(wgpu::Face::Back),
            _ => return Err(ExecError::State("unknown cull mode")),
        })
    }
    pub fn alpha_mode(s: &str) -> Result<wgpu::CompositeAlphaMode, ExecError> {
        Ok(match s {
            "opaque" => wgpu::CompositeAlphaMode::Opaque,
            "premultiplied" => wgpu::CompositeAlphaMode::PreMultiplied,
            _ => return Err(ExecError::State("unknown alpha mode")),
        })
    }
    pub fn feature(s: &str) -> Option<wgpu::Features> {
        Some(match s {
            "depth-clip-control" => wgpu::Features::DEPTH_CLIP_CONTROL,
            "depth32float-stencil8" => wgpu::Features::DEPTH32FLOAT_STENCIL8,
            "texture-compression-bc" => wgpu::Features::TEXTURE_COMPRESSION_BC,
            "texture-compression-bc-sliced-3d" => wgpu::Features::TEXTURE_COMPRESSION_BC_SLICED_3D,
            "texture-compression-etc2" => wgpu::Features::TEXTURE_COMPRESSION_ETC2,
            "texture-compression-astc" => wgpu::Features::TEXTURE_COMPRESSION_ASTC,
            "texture-compression-astc-sliced-3d" => wgpu::Features::TEXTURE_COMPRESSION_ASTC_SLICED_3D,
            "timestamp-query" => wgpu::Features::TIMESTAMP_QUERY,
            "indirect-first-instance" => wgpu::Features::INDIRECT_FIRST_INSTANCE,
            "shader-f16" => wgpu::Features::SHADER_F16,
            "rg11b10ufloat-renderable" => wgpu::Features::RG11B10UFLOAT_RENDERABLE,
            "bgra8unorm-storage" => wgpu::Features::BGRA8UNORM_STORAGE,
            "float32-filterable" => wgpu::Features::FLOAT32_FILTERABLE,
            "float32-blendable" => wgpu::Features::FLOAT32_BLENDABLE,
            "clip-distances" => wgpu::Features::CLIP_DISTANCES,
            "dual-source-blending" => wgpu::Features::DUAL_SOURCE_BLENDING,
            "subgroups" => wgpu::Features::SUBGROUP,
            _ => return None,
        })
    }
}

/// What a device asks of `adapter`, as a page's executor asks a browser: every standard WebGPU feature the adapter has
/// (`tables::FEATURES`, never wgpu's native-only ones), and the adapter's limits. A renderer
/// reads them back to choose texture formats (KTX2 transcode targets need
/// texture-compression-etc2 / -astc / -bc) and sizes.
pub fn web_device_asks(adapter: &wgpu::Adapter) -> (wgpu::Features, wgpu::Limits) {
    let have = adapter.features();
    let features = tables::FEATURES.iter().filter_map(|n| map::feature(n)).filter(|f| have.contains(*f)).fold(wgpu::Features::empty(), |a, f| a | f);
    (features, adapter.limits())
}

/// `device`'s limits in the core's table order (`LIMITS`), then one slot per feature (`tables::FEATURES`): 1 when the
/// device has it (`Executor::device_limits`, for a host whose executor is on another thread).
pub fn device_limits(device: &wgpu::Device) -> Vec<f64> {
    let l = device.limits();
    let features = device.features();
    let mut out: Vec<f64> = LIMITS.iter().map(|n| limit_value(&l, n)).collect();
    out.extend(tables::FEATURES.iter().map(|n| if map::feature(n).is_some_and(|f| features.contains(f)) { 1.0 } else { 0.0 }));
    out
}

/// The limits table's names in slot order (gpu_tables `LIMITS`); the features follow (`tables::FEATURES`).
pub const LIMITS: [&str; 30] = [
    "maxBufferSize", "maxStorageBufferBindingSize", "maxStorageBuffersPerShaderStage", "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupsPerDimension", "maxUniformBufferBindingSize",
    "maxTextureDimension1D", "maxTextureDimension2D", "maxTextureDimension3D", "maxTextureArrayLayers",
    "maxBindGroups", "maxBindingsPerBindGroup", "maxDynamicUniformBuffersPerPipelineLayout", "maxDynamicStorageBuffersPerPipelineLayout",
    "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxStorageTexturesPerShaderStage", "maxUniformBuffersPerShaderStage",
    "minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment", "maxVertexBuffers", "maxVertexAttributes", "maxVertexBufferArrayStride",
    "maxInterStageShaderVariables", "maxColorAttachments", "maxColorAttachmentBytesPerSample", "maxComputeWorkgroupStorageSize",
    "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ",
];

fn limit_value(l: &wgpu::Limits, name: &str) -> f64 {
    (match name {
        "maxBufferSize" => l.max_buffer_size,
        "maxStorageBufferBindingSize" => l.max_storage_buffer_binding_size as u64,
        "maxUniformBufferBindingSize" => l.max_uniform_buffer_binding_size as u64,
        "maxStorageBuffersPerShaderStage" => l.max_storage_buffers_per_shader_stage as u64,
        "maxComputeWorkgroupSizeX" => l.max_compute_workgroup_size_x as u64,
        "maxComputeWorkgroupSizeY" => l.max_compute_workgroup_size_y as u64,
        "maxComputeWorkgroupSizeZ" => l.max_compute_workgroup_size_z as u64,
        "maxComputeWorkgroupsPerDimension" => l.max_compute_workgroups_per_dimension as u64,
        "maxTextureDimension1D" => l.max_texture_dimension_1d as u64,
        "maxTextureDimension2D" => l.max_texture_dimension_2d as u64,
        "maxTextureDimension3D" => l.max_texture_dimension_3d as u64,
        "maxTextureArrayLayers" => l.max_texture_array_layers as u64,
        "maxBindGroups" => l.max_bind_groups as u64,
        "maxBindingsPerBindGroup" => l.max_bindings_per_bind_group as u64,
        "maxDynamicUniformBuffersPerPipelineLayout" => l.max_dynamic_uniform_buffers_per_pipeline_layout as u64,
        "maxDynamicStorageBuffersPerPipelineLayout" => l.max_dynamic_storage_buffers_per_pipeline_layout as u64,
        "maxSampledTexturesPerShaderStage" => l.max_sampled_textures_per_shader_stage as u64,
        "maxSamplersPerShaderStage" => l.max_samplers_per_shader_stage as u64,
        "maxStorageTexturesPerShaderStage" => l.max_storage_textures_per_shader_stage as u64,
        "maxUniformBuffersPerShaderStage" => l.max_uniform_buffers_per_shader_stage as u64,
        "minUniformBufferOffsetAlignment" => l.min_uniform_buffer_offset_alignment as u64,
        "minStorageBufferOffsetAlignment" => l.min_storage_buffer_offset_alignment as u64,
        "maxVertexBuffers" => l.max_vertex_buffers as u64,
        "maxVertexAttributes" => l.max_vertex_attributes as u64,
        "maxVertexBufferArrayStride" => l.max_vertex_buffer_array_stride as u64,
        "maxInterStageShaderVariables" => l.max_inter_stage_shader_variables as u64,
        "maxColorAttachments" => l.max_color_attachments as u64,
        "maxColorAttachmentBytesPerSample" => l.max_color_attachment_bytes_per_sample as u64,
        "maxComputeWorkgroupStorageSize" => l.max_compute_workgroup_storage_size as u64,
        "maxComputeInvocationsPerWorkgroup" => l.max_compute_invocations_per_workgroup as u64,
        _ => 0,
    }) as f64
}

/// Reads a blob's little-endian words from staging; every read is bounds-checked.
struct Blob<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Blob<'a> {
    fn u(&mut self) -> Result<u32, ExecError> {
        let v = self.b.get(self.p..self.p + 4).ok_or(ExecError::Truncated)?;
        self.p += 4;
        Ok(u32::from_le_bytes([v[0], v[1], v[2], v[3]]))
    }
    fn f(&mut self) -> Result<f32, ExecError> {
        Ok(f32::from_bits(self.u()?))
    }
    fn f64(&mut self) -> Result<f64, ExecError> {
        let (lo, hi) = (self.u()? as u64, self.u()? as u64);
        Ok(f64::from_bits(lo | hi << 32))
    }
    fn s(&mut self) -> Result<String, ExecError> {
        let n = self.u()? as usize;
        let v = self.b.get(self.p..self.p + n).ok_or(ExecError::Truncated)?;
        self.p += n.div_ceil(4) * 4;
        Ok(String::from_utf8_lossy(v).into_owned())
    }
    /// An enum by index, parsed.
    fn e<T: for<'de> serde::Deserialize<'de>>(&mut self, table: &[&str]) -> Result<T, ExecError> {
        let i = self.u()?;
        pick(table, i)
    }
    /// An enum by index, as its name.
    fn n(&mut self, table: &[&str]) -> Result<&'static str, ExecError> {
        let i = self.u()?;
        name(table, i)
    }
    /// An optional enum: 0 absent, else index + 1.
    fn opt<T: for<'de> serde::Deserialize<'de>>(&mut self, table: &[&str]) -> Result<Option<T>, ExecError> {
        let v = self.u()?;
        pick_opt(table, v)
    }
}

/// A programmable stage read from a blob.
struct Stage {
    module: wgpu::ShaderModule,
    /// The module's stream id (the host's GPU timing (level 2) names a pipeline by its shader).
    module_id: u32,
    entry: String,
    constants: Vec<(String, f64)>,
}

impl Stage {
    fn read(r: &mut Blob, shaders: &[Option<wgpu::ShaderModule>]) -> Result<Stage, ExecError> {
        let module_id = r.u()?;
        let module = get(shaders, module_id, "shader")?.clone();
        let entry = r.s()?;
        let n = r.u()? as usize;
        let mut constants = Vec::with_capacity(n);
        for _ in 0..n {
            let k = r.s()?;
            constants.push((k, r.f64()?));
        }
        Ok(Stage { module, module_id, entry, constants })
    }
    fn constants(&self) -> Vec<(&str, f64)> {
        self.constants.iter().map(|(k, v)| (k.as_str(), *v)).collect()
    }
}

/// A byte stride of 0 is "tightly packed / undefined" in WebGPU.
fn stride(v: u32) -> Option<u32> {
    (v != 0).then_some(v)
}

/// A buffer range: a size of 0 is "the rest of the buffer".
fn slice(b: &wgpu::Buffer, offset: u32, size: u32) -> wgpu::BufferSlice<'_> {
    if size == 0 { b.slice(offset as u64..) } else { b.slice(offset as u64..offset as u64 + size as u64) }
}

/// The target of CONFIGURE_SURFACE / ACQUIRE_SURFACE_TEXTURE / PRESENT.
enum Surface {
    /// The host's window surface and its size in pixels: configured and presented here.
    Window { surface: Arc<wgpu::Surface<'static>>, width: u32, height: u32, current: Option<wgpu::SurfaceTexture> },
    /// An executor-owned texture the host composites into its own frame (one
    /// presenter: the host); PRESENT only counts.
    Scene(Scene),
}

struct Scene {
    width: u32,
    height: u32,
    /// From CONFIGURE_SURFACE (format, usage plus TEXTURE_BINDING, view formats).
    config: Option<(wgpu::TextureFormat, wgpu::TextureUsages, Vec<wgpu::TextureFormat>)>,
    /// Made at ACQUIRE for the configuration and size, as many as the executor's `scene_buffers` (one: the same
    /// texture every frame), each ACQUIRE taking the next.
    textures: Vec<wgpu::Texture>,
    /// The one the last ACQUIRE took.
    current: usize,
    texture_size: (u32, u32),
    /// The texture the last PRESENT finished, its format and size: what the host composites.
    shown: Option<(wgpu::Texture, wgpu::TextureFormat, (u32, u32))>,
    presented: u64,
}

impl Scene {
    fn new(width: u32, height: u32) -> Scene {
        Scene { width, height, config: None, textures: Vec::new(), current: 0, texture_size: (0, 0), shown: None, presented: 0 }
    }
}

/// The scene texture as the host reads it (`Executor::scene`).
#[derive(Clone, Debug)]
pub struct SceneFrame {
    pub texture: wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
    /// PRESENTs so far: the core finished this many frames.
    pub presented: u64,
}

/// A scene surface's texture as the host reads it: the one the last PRESENT finished, else (before the first) the one
/// being drawn; None for a window surface, or before the first ACQUIRE.
fn scene_frame(surface: &Surface) -> Option<SceneFrame> {
    let Surface::Scene(s) = surface else { return None };
    let (texture, format, (width, height)) = match &s.shown {
        Some((t, f, size)) => (t.clone(), *f, *size),
        None => (s.textures.get(s.current)?.clone(), s.config.as_ref()?.0, s.texture_size),
    };
    Some(SceneFrame { texture, width, height, format, presented: s.presented })
}

/// Callback results the next `poll` hands to the core.
#[derive(Default)]
struct Completions {
    /// (ticket, buffer, offset, size, mapped)
    maps: Vec<(u32, wgpu::Buffer, u64, u64, Result<(), String>)>,
    work: Vec<u32>,
}

type PopFuture = Pin<Box<dyn Future<Output = Option<wgpu::Error>>>>;

pub struct Executor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    link: Arc<dyn CoreLink>,
    buffers: Vec<Option<wgpu::Buffer>>,
    shaders: Vec<Option<wgpu::ShaderModule>>,
    pipelines: Vec<Option<wgpu::ComputePipeline>>,
    groups: Vec<Option<wgpu::BindGroup>>,
    textures: Vec<Option<wgpu::Texture>>,
    views: Vec<Option<wgpu::TextureView>>,
    samplers: Vec<Option<wgpu::Sampler>>,
    group_layouts: Vec<Option<wgpu::BindGroupLayout>>,
    pipeline_layouts: Vec<Option<wgpu::PipelineLayout>>,
    render_pipelines: Vec<Option<wgpu::RenderPipeline>>,
    render_bundles: Vec<Option<wgpu::RenderBundle>>,
    /// DRAW_LIST's lists (draw_list.rs): each its buckets.
    draw_lists: Vec<Option<Vec<draw_list::Bucket>>>,
    /// The bundle being recorded (CREATE_RENDER_BUNDLE_ENCODER .. FINISH_RENDER_BUNDLE) and its
    /// id: render commands go to it while it is open, not to the pass.
    benc: Option<wgpu::RenderBundleEncoder<'static>>,
    benc_id: u32,
    /// The bundle's formats and samples (an empty bundle like it stands in for one wgpu refuses: FINISH_RENDER_BUNDLE).
    benc_desc: (Vec<Option<wgpu::TextureFormat>>, Option<wgpu::RenderBundleDepthStencil>, u32),
    /// GPU_STREAM_PROFILE: the state commands and draws the open bundle recorded (`profile::REPLAY_*` order), and each
    /// finished bundle's, by id: EXECUTE_BUNDLES adds them to the frame's replay counts.
    benc_counts: [u64; profile::REPLAY_KINDS],
    bundle_counts: Vec<[u64; profile::REPLAY_KINDS]>,
    /// Texture ids that name a surface texture: DESTROY only releases them.
    surface_textures: HashSet<u32>,
    /// Where the surface ops go (`set_surface` / `set_scene`): surface 0.
    surface: Option<Surface>,
    /// Further surfaces (`add_scene_surface`, a view's canvas: the web executor's addSurface), numbered from 1; None
    /// once removed.
    extra_surfaces: Vec<Option<Surface>>,
    /// The surface the surface ops go to as they run (`select_surface`, the web executor's selectSurface).
    selected: u32,
    encoder: Option<wgpu::CommandEncoder>,
    pass: Option<wgpu::ComputePass<'static>>,
    rpass: Option<wgpu::RenderPass<'static>>,
    /// the host's GPU timing (timing.rs): each view's size at its first mip and its format, by id, to name the passes
    /// that draw to it; the open pass's begin slot and name when its frame is timed; and the open pass's draws (or
    /// dispatches; a bundle's draws are counted under GPU_STREAM_PROFILE).
    view_meta: Vec<(u32, u32, wgpu::TextureFormat)>,
    timed_pass: Option<(u32, String)>,
    pass_draws: u32,
    /// the host's GPU timing (level 2) with pipeline statistics: a segment's statistics query is open in the render pass.
    stats_open: bool,
    /// the host's GPU timing (level 2) (timing.rs marks): each shader's name (a hash of its WGSL), each render and compute
    /// pipeline's (its fragment shader's, or its vertex shader's when it has none, and the entry point), the pipelines
    /// the open bundle set, and each finished bundle's name (its pipelines'), all by stream id.
    shader_names: Vec<String>,
    render_pipeline_names: Vec<String>,
    compute_pipeline_names: Vec<String>,
    benc_pipes: Vec<u32>,
    bundle_names: Vec<String>,
    /// Open error scopes, innermost last.
    scopes: Vec<wgpu::ErrorScopeGuard>,
    /// Popped scopes waiting for their result: (ticket, future).
    pops: std::cell::RefCell<Vec<(u32, PopFuture)>>,
    done: Arc<Mutex<Completions>>,
    pub stats: Stats,
    /// The driver's pipeline cache (Vulkan), when the host keeps one across runs: every pipeline is made through it.
    pipeline_cache: Option<wgpu::PipelineCache>,
    /// Pipelines made so far (the host saves the cache when this moved).
    pipelines_made: u64,
    /// Pipelines being compiled on the compile threads (`made_async`), by (render?, id): the ticket their creation
    /// settles, whether it has been completed, and where the pipeline arrives.
    pending: RefCell<HashMap<(bool, u32), PendingPipeline>>,
    /// GPU_STREAM_PROFILE: this frame's op counts and times so far (`take_profile`).
    prof: Box<profile::OpTimes>,
    /// WRITE_BUFFER's bytes go through mapped chunks kept across frames (`belt`), copied into the stream's buffers by
    /// `uploads`, submitted ahead of the next SUBMIT's command buffer (where wgpu's own `Queue::write_buffer` makes a
    /// new staging buffer per write: a placed D3D12 resource, mapped and freed; 20.7 against 1.0 us a write). Only a
    /// write `belt_takes` (one wgpu's write_buffer would accept); GPU_STREAM_BELT=0: none.
    belt: Option<wgpu::util::StagingBelt>,
    uploads: Option<wgpu::CommandEncoder>,
    /// Scene surfaces keep this many textures, an ACQUIRE taking the next (`set_scene_buffers`).
    scene_buffers: usize,
    /// MAP_READ and WORK_DONE callbacks not yet handed to the core (`waiting`).
    in_flight: std::cell::Cell<usize>,
}

/// WRITE_BUFFER through the staging belt (GPU_STREAM_BELT=0 turns it off; read once).
fn belt_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("GPU_STREAM_BELT").as_deref() != Ok("0"))
}

/// The belt's chunk size; a write larger than `BELT_LARGEST` goes through `Queue::write_buffer` (a load's uploads: no
/// chunk that size is kept).
const BELT_CHUNK: u64 = 1 << 20;
const BELT_LARGEST: usize = 256 << 10;

/// Whether a WRITE_BUFFER of `len` bytes at `offset` into `buffer` may go through the belt: exactly the writes wgpu's
/// own `Queue::write_buffer` accepts (WebGPU's writeBuffer validation: COPY_DST usage, 4-byte aligned offset and size,
/// within the buffer, the buffer unmapped), with something to copy. The belt's copy is recorded into the uploads
/// encoder and validated only at the SUBMIT, where an invalid one would invalidate that command buffer and fail the
/// whole submission (the frame's own command buffer with it), its error raised in the scopes open then. Anything else
/// goes to `Queue::write_buffer`, which raises its error at once, in the scopes open at the write, as it always did.
fn belt_takes(buffer: &wgpu::Buffer, offset: u64, len: u64) -> bool {
    let usage = buffer.usage();
    len > 0
        && len as usize <= BELT_LARGEST
        && offset % wgpu::COPY_BUFFER_ALIGNMENT == 0
        && len % wgpu::COPY_BUFFER_ALIGNMENT == 0
        && usage.contains(wgpu::BufferUsages::COPY_DST)
        // A mappable buffer may be mapped or have a map pending (MAP_READ's): writing it then is an error.
        && !usage.intersects(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::MAP_WRITE)
        && offset.checked_add(len).is_some_and(|end| end <= buffer.size())
}

/// An async creation's pipeline, once a compile thread made it.
enum MadePipeline {
    Render(wgpu::RenderPipeline),
    Compute(wgpu::ComputePipeline),
}

/// Where a compile thread leaves its pipeline and its error scope's message (None: no error).
#[derive(Default)]
struct PipelineSlot {
    made: Mutex<Option<(MadePipeline, Option<String>)>>,
    ready: Condvar,
}

struct PendingPipeline {
    /// An async creation's ticket; None for a creation made as WebGPU's synchronous one.
    ticket: Option<u32>,
    completed: bool,
    slot: Arc<PipelineSlot>,
    /// A synchronous creation's descriptor: when its compile reported an error, it is made again on the executor's
    /// thread at `settle`, so the error reaches the stream's own error scopes (or the uncaptured handler) as a
    /// synchronous creation's would.
    remake: Option<PipelineSpec>,
}

#[derive(Clone)]
enum PipelineSpec {
    Render(Arc<RenderSpec>),
    Compute(Arc<ComputeSpec>),
}

impl PipelineSpec {
    fn make(&self, device: &wgpu::Device) -> MadePipeline {
        match self {
            PipelineSpec::Render(r) => MadePipeline::Render(r.make(device)),
            PipelineSpec::Compute(c) => MadePipeline::Compute(c.make(device)),
        }
    }
}

/// A render pipeline's descriptor as its blob gives it, owning what it names: made on the executor's thread, or on a
/// compile thread (`made_async`).
struct RenderSpec {
    layout: Option<wgpu::PipelineLayout>,
    vertex: Stage,
    buffers: Vec<(u64, wgpu::VertexStepMode, Vec<wgpu::VertexAttribute>)>,
    fragment: Option<(Stage, Vec<Option<wgpu::ColorTargetState>>)>,
    primitive: wgpu::PrimitiveState,
    depth_stencil: Option<wgpu::DepthStencilState>,
    multisample: wgpu::MultisampleState,
    cache: Option<wgpu::PipelineCache>,
}

impl RenderSpec {
    fn make(&self, device: &wgpu::Device) -> wgpu::RenderPipeline {
        let vconstants = self.vertex.constants();
        let layouts: Vec<Option<wgpu::VertexBufferLayout>> =
            self.buffers.iter().map(|(stride, step, a)| Some(wgpu::VertexBufferLayout { array_stride: *stride, step_mode: *step, attributes: a })).collect();
        let fconstants = self.fragment.as_ref().map(|(f, _)| f.constants()).unwrap_or_default();
        let fragment = self.fragment.as_ref().map(|(fs, targets)| wgpu::FragmentState {
            module: &fs.module,
            entry_point: Some(&fs.entry),
            compilation_options: wgpu::PipelineCompilationOptions { constants: &fconstants, ..Default::default() },
            targets,
        });
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: self.layout.as_ref(),
            vertex: wgpu::VertexState {
                module: &self.vertex.module,
                entry_point: Some(&self.vertex.entry),
                compilation_options: wgpu::PipelineCompilationOptions { constants: &vconstants, ..Default::default() },
                buffers: &layouts,
            },
            primitive: self.primitive,
            depth_stencil: self.depth_stencil.clone(),
            multisample: self.multisample,
            fragment,
            multiview_mask: None,
            cache: self.cache.as_ref(),
        })
    }
}

/// A compute pipeline's descriptor (CREATE_COMPUTE_PIPELINE_WITH_LAYOUT), owning what it names.
struct ComputeSpec {
    layout: Option<wgpu::PipelineLayout>,
    stage: Stage,
    cache: Option<wgpu::PipelineCache>,
}

impl ComputeSpec {
    fn make(&self, device: &wgpu::Device) -> wgpu::ComputePipeline {
        let constants = self.stage.constants();
        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: None,
            layout: self.layout.as_ref(),
            module: &self.stage.module,
            entry_point: Some(&self.stage.entry),
            compilation_options: wgpu::PipelineCompilationOptions { constants: &constants, ..Default::default() },
            cache: self.cache.as_ref(),
        })
    }
}

type CompileJob = Box<dyn FnOnce() + Send>;

/// The compile threads async pipeline creations run on (the page's Dawn compiles them off its GPU thread too): a
/// shared queue, as many threads as the machine has cores less two (one at least, eight at most), started on first use.
fn compile_queue() -> &'static Mutex<std::sync::mpsc::Sender<CompileJob>> {
    static QUEUE: std::sync::OnceLock<Mutex<std::sync::mpsc::Sender<CompileJob>>> = std::sync::OnceLock::new();
    QUEUE.get_or_init(|| {
        let (send, receive) = std::sync::mpsc::channel::<CompileJob>();
        let receive = Arc::new(Mutex::new(receive));
        let threads = std::thread::available_parallelism().map_or(2, |n| n.get()).saturating_sub(2).clamp(1, 8);
        for n in 0..threads {
            let receive = receive.clone();
            let _ = std::thread::Builder::new().name(format!("gpu-stream compile {n}")).spawn(move || loop {
                // The lock is held only while taking a job, not while running it.
                let job = match receive.lock() {
                    Ok(r) => r.recv(),
                    Err(_) => return,
                };
                match job {
                    Ok(job) => job(),
                    Err(_) => return,
                }
            });
        }
        Mutex::new(send)
    })
}

/// `r` for a call that takes `&'a T` on a `'static` bundle encoder. Sound: wgpu-core's
/// bundle encoder records the resource's id, resolved when the bundle finishes, and the
/// executor's tables keep every resource alive until the core destroys it.
fn keep<T>(r: &T) -> &'static T {
    unsafe { &*(r as *const T) }
}

impl Executor {
    /// A headless executor: its own wgpu instance, adapter and device (no
    /// surface), the core side behind `link`.
    pub fn headless(link: Arc<dyn CoreLink>) -> Result<Executor, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).map_err(|e| format!("no adapter: {e}"))?;
        let (features, limits) = web_device_asks(&adapter);
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("gpu-stream device"),
            required_features: features,
            required_limits: limits,
            ..Default::default()
        }))
        .map_err(|e| format!("no device: {e}"))?;
        // Its own device: the executor watches it for loss and uncaptured errors.
        let lost = link.clone();
        device.set_device_lost_callback(move |reason, message| {
            if reason == wgpu::DeviceLostReason::Destroyed {
                return;
            }
            fail(&*lost, &format!("device lost: {}", if message.is_empty() { format!("{reason:?}") } else { message }));
        });
        device.on_uncaptured_error(Arc::new(|e: wgpu::Error| {
            UNCAPTURED_ERRORS.fetch_add(1, Ordering::Relaxed);
            eprintln!("gpu-stream: uncaptured WebGPU error: {e}");
        }));
        Ok(Executor::from_device(device, queue, link))
    }

    /// Run on a host's device (wgpu handles are shared references). The host keeps
    /// its own loss and error handlers; it forwards a loss with `fail_lost`.
    pub fn from_device(device: wgpu::Device, queue: wgpu::Queue, link: Arc<dyn CoreLink>) -> Executor {
        Executor {
            device, queue, link,
            buffers: Vec::new(), shaders: Vec::new(), pipelines: Vec::new(), groups: Vec::new(),
            textures: Vec::new(), views: Vec::new(), samplers: Vec::new(), group_layouts: Vec::new(),
            pipeline_layouts: Vec::new(), render_pipelines: Vec::new(), render_bundles: Vec::new(), draw_lists: Vec::new(),
            benc: None, benc_id: 0, benc_desc: (Vec::new(), None, 1), benc_counts: [0; profile::REPLAY_KINDS], bundle_counts: Vec::new(), surface_textures: HashSet::new(), surface: None, extra_surfaces: Vec::new(), selected: 0,
            encoder: None, pass: None, rpass: None, view_meta: Vec::new(), timed_pass: None, pass_draws: 0, stats_open: false,
            shader_names: Vec::new(), render_pipeline_names: Vec::new(), compute_pipeline_names: Vec::new(), benc_pipes: Vec::new(), bundle_names: Vec::new(),
            scopes: Vec::new(), pops: Default::default(),
            done: Arc::new(Mutex::new(Completions::default())), stats: Stats::default(),
            pipeline_cache: None, pipelines_made: 0, pending: RefCell::new(HashMap::new()),
            prof: Box::default(),
            belt: None, uploads: None, scene_buffers: 1, in_flight: Default::default(),
        }
    }

    /// Benchmarks and tests (examples/drawlist.rs): objects made directly on the device, put in the executor's tables
    /// under stream ids, as the stream's CREATE_* would.
    #[doc(hidden)]
    pub fn adopt_buffer(&mut self, id: u32, b: wgpu::Buffer) {
        set(&mut self.buffers, id, b);
    }
    #[doc(hidden)]
    pub fn adopt_group(&mut self, id: u32, g: wgpu::BindGroup) {
        set(&mut self.groups, id, g);
    }
    #[doc(hidden)]
    pub fn adopt_render_pipeline(&mut self, id: u32, p: wgpu::RenderPipeline) {
        set(&mut self.render_pipelines, id, p);
    }
    #[doc(hidden)]
    pub fn adopt_view(&mut self, id: u32, v: wgpu::TextureView) {
        set(&mut self.views, id, v);
    }

    /// Scene surfaces keep `n` textures from now on (at least one), each ACQUIRE drawing into the next: a host that
    /// composites the last PRESENT's texture on another thread while the stream draws the next frame (an executor on a
    /// thread of its own) reads a finished frame, never the one being drawn. One (the default) draws every frame into
    /// the same texture, for a host that composites between streams.
    pub fn set_scene_buffers(&mut self, n: usize) {
        self.scene_buffers = n.max(1);
    }

    /// Whether anything waits on the device: a map or work-done callback, a popped error scope, an async pipeline
    /// creation whose ticket is not settled. A host polling on its own (`poll`) polls while this holds.
    pub fn waiting(&self) -> bool {
        self.in_flight.get() > 0 || !self.pops.borrow().is_empty() || self.pending.borrow().values().any(|p| p.ticket.is_some() && !p.completed)
    }

    /// Pipelines are made through `cache` from now on (a host's cache kept across runs: Vulkan compiles every
    /// pipeline in the driver, seconds of a scene's load on a phone).
    pub fn set_pipeline_cache(&mut self, cache: wgpu::PipelineCache) {
        self.pipeline_cache = Some(cache);
    }

    /// The pipeline cache's data to keep, and how many pipelines have been made (the host saves when it moved).
    pub fn pipeline_cache_data(&self) -> Option<(Vec<u8>, u64)> {
        Some((self.pipeline_cache.as_ref()?.get_data()?, self.pipelines_made))
    }

    pub fn pipelines_made(&self) -> u64 {
        self.pipelines_made
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }
    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// Mark the core lost from outside.
    pub fn fail_lost(&self, message: &str) {
        fail(&*self.link, message)
    }

    /// The device's limits in the core's table order (`LIMITS`), then one slot per
    /// feature (`tables::FEATURES`): 1 when the device has it.
    pub fn device_limits(&self) -> Vec<f64> {
        device_limits(&self.device)
    }

    /// Give the executor the host's window surface and its size in pixels, for
    /// CONFIGURE_SURFACE / ACQUIRE_SURFACE_TEXTURE / PRESENT.
    pub fn set_surface(&mut self, surface: Arc<wgpu::Surface<'static>>, width: u32, height: u32) {
        self.surface = Some(Surface::Window { surface, width, height, current: None });
    }

    /// The surface ops draw into an executor-owned scene texture of `width` x
    /// `height` pixels instead of a window: the host composites it (`scene`)
    /// and presents its own frame, so PRESENT only counts frames.
    pub fn set_scene(&mut self, width: u32, height: u32) {
        profile::record_surface(profile::SURF_SCENE, width, height, 0);
        self.surface = Some(Surface::Scene(Scene::new(width, height)));
    }

    /// The surface's size changed (the next CONFIGURE_SURFACE uses it; a scene
    /// texture is remade at the next ACQUIRE_SURFACE_TEXTURE).
    pub fn resize_surface(&mut self, w: u32, h: u32) {
        profile::record_surface(profile::SURF_RESIZE, w, h, 0);
        match &mut self.surface {
            Some(Surface::Window { width, height, .. }) => {
                *width = w;
                *height = h;
            }
            Some(Surface::Scene(s)) => {
                s.width = w;
                s.height = h;
            }
            None => {}
        }
    }

    /// The scene texture the core last acquired (`set_scene`), if any.
    pub fn scene(&self) -> Option<SceneFrame> {
        scene_frame(self.surface.as_ref()?)
    }

    /// Another surface the stream may draw on (a view's canvas, the web executor's addSurface): an executor-owned
    /// scene texture of `width` x `height` pixels the host composites in that canvas's box. Its number (from 1).
    pub fn add_scene_surface(&mut self, width: u32, height: u32) -> u32 {
        profile::record_surface(profile::SURF_ADD, width, height, 0);
        self.extra_surfaces.push(Some(Surface::Scene(Scene::new(width, height))));
        self.extra_surfaces.len() as u32
    }

    /// Where the surface ops go as they run, until the next selection (0: the executor's own surface). False for a
    /// surface that does not exist (nothing changes).
    pub fn select_surface(&mut self, n: u32) -> bool {
        profile::record_surface(profile::SURF_SELECT, n, 0, 0);
        let exists = n == 0 || self.extra_surfaces.get(n as usize - 1).is_some_and(Option::is_some);
        if exists {
            self.selected = n;
        }
        exists
    }

    /// A further surface's size changed (its scene texture is remade at the next ACQUIRE_SURFACE_TEXTURE).
    pub fn resize_scene_surface(&mut self, n: u32, w: u32, h: u32) {
        profile::record_surface(profile::SURF_RESIZE_EXTRA, n, w, h);
        if let Some(Some(Surface::Scene(s))) = n.checked_sub(1).and_then(|i| self.extra_surfaces.get_mut(i as usize)) {
            s.width = w;
            s.height = h;
        }
    }

    /// A further surface's scene texture as the core last acquired it, if any.
    pub fn surface_scene(&self, n: u32) -> Option<SceneFrame> {
        scene_frame(n.checked_sub(1).and_then(|i| self.extra_surfaces.get(i as usize))?.as_ref()?)
    }

    /// Turn the device's event processing: mapAsync, work-done and error-scope
    /// results complete their tickets here.
    /// Live handles by kind (buffers, textures, bind groups, render bundles, ...), for a leak hunt: a count that only
    /// grows while the scene stands still is a handle the stream creates and never destroys.
    pub fn live_handles(&self) -> String {
        fn live<T>(table: &[Option<T>]) -> usize {
            table.iter().flatten().count()
        }
        format!(
            "buffers {} textures {} views {} groups {} samplers {} render pipelines {} bundles {} shaders {}",
            live(&self.buffers), live(&self.textures), live(&self.views), live(&self.groups), live(&self.samplers),
            live(&self.render_pipelines), live(&self.render_bundles), live(&self.shaders),
        )
    }

    pub fn poll(&self) {
        let _ = self.device.poll(wgpu::PollType::Poll);
        let done = std::mem::take(&mut *self.done.lock().unwrap());
        self.in_flight.set(self.in_flight.get().saturating_sub(done.maps.len() + done.work.len()));
        for (ticket, buffer, offset, size, mapped) in done.maps {
            match mapped {
                Ok(()) => {
                    let data = buffer.slice(offset..offset + size).get_mapped_range().map(|v| v.to_vec());
                    buffer.unmap();
                    match data {
                        Ok(d) => self.link.complete(ticket, 0, &d),
                        Err(e) => self.link.complete(ticket, 1, cut(&e.to_string(), size as usize)),
                    }
                }
                // The ticket's region is the read's size: the message is cut to it.
                Err(m) => self.link.complete(ticket, 1, cut(if m.is_empty() { "mapAsync failed" } else { &m }, size as usize)),
            }
        }
        for ticket in done.work {
            self.link.complete(ticket, 0, &[]);
        }
        // Async creations whose pipeline arrived: their tickets settle now; the pipeline goes in its table at the next
        // stream (`install_made`), before anything the settled creation lets the core record runs.
        for p in self.pending.borrow_mut().values_mut() {
            let Some(ticket) = p.ticket.filter(|_| !p.completed) else { continue };
            let made = p.slot.made.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((_, error)) = made.as_ref() {
                match error {
                    None => self.link.complete(ticket, 0, &[]),
                    Some(m) => self.link.complete(ticket, 1, cut(m, self.link.ticket_cap(ticket))),
                }
                p.completed = true;
            }
        }
        let mut cx = Context::from_waker(Waker::noop());
        let link = self.link.clone();
        self.pops.borrow_mut().retain_mut(|(ticket, fut)| match fut.as_mut().poll(&mut cx) {
            Poll::Pending => true,
            Poll::Ready(None) => {
                link.complete(*ticket, 0, &[]);
                false
            }
            Poll::Ready(Some(e)) => {
                let m = e.to_string();
                link.complete(*ticket, 1, cut(if m.is_empty() { "error scope popped without an error message" } else { &m }, link.ticket_cap(*ticket)));
                false
            }
        });
    }

    /// Poll until ticket `t` is done or failed. Returns its status (0 ok), or
    /// `None` on timeout. The native `executor.ticket(t)` promise.
    pub fn wait_ticket(&self, tickets: &TicketTable, t: u32, timeout: Duration) -> Option<u32> {
        let end = Instant::now() + timeout;
        loop {
            self.poll();
            let s = tickets.state(t);
            if s == TICKET_DONE || s == TICKET_FAILED {
                return Some(if s == TICKET_DONE { 0 } else { 1 });
            }
            if Instant::now() >= end {
                return None;
            }
            std::thread::sleep(Duration::from_micros(100));
        }
    }

    /// Execute one flushed stream. `stream` is the command words, `staging` the
    /// upload bytes the commands name. On failure the core is marked lost
    /// (`executor: <message>`) and the stream stops at the failing command.
    pub fn execute(&mut self, stream: &[u32], staging: &[u8]) -> Result<(), ExecError> {
        self.stats.flushes += 1;
        if profile::recording() {
            profile::record_flush(stream, staging);
        }
        let started = profile::enabled().then(Instant::now);
        let r = self.run(stream, staging);
        if let Some(t) = started {
            self.prof.executes += 1;
            self.prof.exec_ns += t.elapsed().as_nanos() as u64;
        }
        if let Err(e) = &r {
            fail(&*self.link, &format!("executor: {e}"));
        }
        r
    }

    /// GPU_STREAM_PROFILE: the op counts and times since the last take (the host takes them once per frame).
    pub fn take_profile(&mut self) -> profile::OpTimes {
        std::mem::take(&mut *self.prof)
    }

    /// The belt's pending writes submitted now, on their own (before a queue operation that must see them).
    fn flush_uploads(&mut self) {
        let Some(uploads) = self.uploads.take() else { return };
        let belt = self.belt.as_mut().unwrap();
        belt.finish();
        self.queue.submit([uploads.finish()]);
        belt.recall();
    }

    /// the host's GPU timing: a render pass's name from what it draws to: the attachments' size, their formats, and
    /// whether the first is cleared or loaded (an opaque pass and a later one over the same targets differ there).
    fn render_pass_name(&self, colors: &[u32], depth: Option<u32>, load: &str) -> String {
        let meta = |v: u32| self.view_meta.get(v as usize).copied().filter(|m| m.0 != 0);
        let size = colors.iter().chain(depth.iter()).find_map(|&v| meta(v)).map_or_else(|| "?".to_string(), |(w, h, _)| format!("{w}x{h}"));
        let mut formats: Vec<String> = colors.iter().filter_map(|&v| meta(v)).map(|(_, _, f)| format!("{f:?}")).collect();
        if let Some((_, _, f)) = depth.and_then(meta) {
            formats.push(format!("{f:?}"));
        }
        format!("render {size} {} ({load})", formats.join("+"))
    }

    /// the host's GPU timing (level 2) with pipeline statistics: ends the open segment's statistics query and begins the next
    /// segment's (the one starting at the pass or mark just taken).
    fn restart_segment_stats(&mut self) {
        let Some(rpass) = self.rpass.as_mut() else { return };
        if std::mem::take(&mut self.stats_open) {
            rpass.end_pipeline_statistics_query();
        }
        if let Some((set, q)) = timing::segment_stats() {
            rpass.begin_pipeline_statistics_query(&set, q);
            self.stats_open = true;
        }
    }

    /// the host's GPU timing: the pass just ended gets its name and draws.
    fn name_timed_pass(&mut self) {
        if let Some((begin, name)) = self.timed_pass.take() {
            timing::name(begin, if name.is_empty() { "compute".to_string() } else { name }, self.pass_draws);
        }
    }

    fn encoder(&mut self) -> &mut wgpu::CommandEncoder {
        self.encoder.get_or_insert_with(|| self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default()))
    }

    fn rpass(&mut self) -> Result<&mut wgpu::RenderPass<'static>, ExecError> {
        self.rpass.as_mut().ok_or(ExecError::State("no render pass open"))
    }

    fn pass(&mut self) -> Result<&mut wgpu::ComputePass<'static>, ExecError> {
        self.pass.as_mut().ok_or(ExecError::State("no compute pass open"))
    }

    fn run(&mut self, words: &[u32], staging: &[u8]) -> Result<(), ExecError> {
        // GPU_STREAM_TRACE=1: every op and its first arguments (debugging); read once, not per command.
        static TRACE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        let trace = *TRACE.get_or_init(|| std::env::var_os("GPU_STREAM_TRACE").is_some());
        let prof = profile::enabled();
        self.install_made();
        let mut i = 0usize;
        // The command before this one, timed from `last` (GPU_STREAM_PROFILE).
        let mut last: Option<(u32, Instant)> = None;
        while i < words.len() {
            let op = words[i];
            if prof {
                let now = Instant::now();
                if let Some((o, t)) = last.replace((op, now)) {
                    let k = (o as usize).min(profile::OPS - 1);
                    self.prof.n[k] += 1;
                    self.prof.ns[k] += now.duration_since(t).as_nanos() as u64;
                }
            }
            let n = *words.get(i + 1).ok_or(ExecError::Truncated)? as usize;
            if prof && self.benc.is_some() {
                if let Some(k) = profile::replay_kind(op) {
                    self.benc_counts[k] += 1;
                }
            }
            let a = words.get(i + 2..i + 2 + n).ok_or(ExecError::Truncated)?;
            i += 2 + n;
            self.stats.commands += 1;
            if trace {
                eprintln!("gpu-stream: op {op} {:?}", &a[..a.len().min(6)]);
            }
            let arg = |k: usize| a.get(k).copied().ok_or(ExecError::Truncated);
            let bytes = |off: u32, len: u32| -> Result<&[u8], ExecError> { staging.get(off as usize..off as usize + len as usize).ok_or(ExecError::Truncated) };
            match op {
                op::CREATE_BUFFER => {
                    let (size, usage) = (arg(1)? as u64, wgpu::BufferUsages::from_bits_truncate(arg(2)?));
                    let b = self.device.create_buffer(&wgpu::BufferDescriptor { label: None, size, usage, mapped_at_creation: false });
                    census::buffer(arg(0)?, size, usage);
                    set(&mut self.buffers, arg(0)?, b);
                }
                op::WRITE_BUFFER => {
                    let (offset, len) = (arg(1)? as usize, arg(3)? as usize);
                    let data = bytes(arg(2)?, arg(3)?)?;
                    let buffer = get(&self.buffers, arg(0)?, "buffer")?;
                    if belt_on() && belt_takes(buffer, offset as u64, len as u64) {
                        let size = NonZeroU64::new(len as u64).ok_or(ExecError::State("empty belt write"))?;
                        let device = &self.device;
                        let uploads = self.uploads.get_or_insert_with(|| device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("gpu-stream uploads") }));
                        let belt = self.belt.get_or_insert_with(|| wgpu::util::StagingBelt::new(device.clone(), BELT_CHUNK));
                        belt.write_buffer(uploads, buffer, offset as u64, size).copy_from_slice(data);
                    } else if len > 0 {
                        // Belt writes still pending go first (queue order).
                        self.flush_uploads();
                        let buffer = get(&self.buffers, arg(0)?, "buffer")?;
                        let mut k = 0;
                        while k < len {
                            let n = WRITE_CHUNK_BYTES.min(len - k);
                            self.queue.write_buffer(buffer, (offset + k) as u64, &data[k..k + n]);
                            k += n;
                        }
                    }
                    self.stats.writes += 1;
                    self.stats.write_bytes += len as u64;
                }
                op::CREATE_SHADER => {
                    let code = String::from_utf8_lossy(bytes(arg(1)?, arg(2)?)?).into_owned();
                    // GPU_STREAM_DUMP_SHADERS=<dir>: every shader's WGSL, as shader-<id>.wgsl (debugging).
                    if let Some(dir) = std::env::var_os("GPU_STREAM_DUMP_SHADERS") {
                        let _ = std::fs::write(std::path::Path::new(&dir).join(format!("shader-{}.wgsl", arg(0)?)), &code);
                    }
                    if timing::detailed() {
                        // FNV-1a over the source: the same shader has the same name in every run. GPU_STREAM_TIMING_SHADERS=<dir>
                        // keeps each source as <name>.wgsl, to tell which shader a name is.
                        let hash = code.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x0100_0000_01b3));
                        let name = format!("{:08x}", (hash ^ (hash >> 32)) as u32);
                        if let Some(dir) = std::env::var_os("GPU_STREAM_TIMING_SHADERS") {
                            let file = std::path::Path::new(&dir).join(format!("{name}.wgsl"));
                            if !file.exists() {
                                let _ = std::fs::write(file, &code);
                            }
                        }
                        let at = arg(0)? as usize;
                        if self.shader_names.len() <= at {
                            self.shader_names.resize(at + 1, String::new());
                        }
                        self.shader_names[at] = name;
                    }
                    let m = self.device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(code.into()) });
                    set(&mut self.shaders, arg(0)?, m);
                }
                op::CREATE_COMPUTE_PIPELINE => {
                    let module = get(&self.shaders, arg(1)?, "shader")?;
                    let entry = String::from_utf8_lossy(bytes(arg(2)?, arg(3)?)?).into_owned();
                    let p = self.device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                        label: None,
                        // No layout is "auto".
                        layout: None,
                        module,
                        entry_point: Some(&entry),
                        compilation_options: Default::default(),
                        cache: self.pipeline_cache.as_ref(),
                    });
                    self.pipelines_made += 1;
                    set(&mut self.pipelines, arg(0)?, p);
                }
                op::CREATE_BIND_GROUP => {
                    self.settle(false, arg(1)?);
                    let pipeline = get(&self.pipelines, arg(1)?, "pipeline")?;
                    let count = arg(3)? as usize;
                    let mut entries = Vec::with_capacity(count);
                    for e in 0..count {
                        let p = 4 + e * 4;
                        let size = arg(p + 3)?;
                        entries.push(wgpu::BindGroupEntry {
                            binding: arg(p)?,
                            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                                buffer: get(&self.buffers, arg(p + 1)?, "buffer")?,
                                offset: arg(p + 2)? as u64,
                                size: NonZeroU64::new(size as u64),
                            }),
                        });
                    }
                    let layout = pipeline.get_bind_group_layout(arg(2)?);
                    let g = self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &layout, entries: &entries });
                    set(&mut self.groups, arg(0)?, g);
                }
                op::BEGIN_COMPUTE => {
                    let timed = timing::pass();
                    let timestamp_writes = timed.as_ref().map(|(set, b, e)| wgpu::ComputePassTimestampWrites { query_set: set, beginning_of_pass_write_index: Some(*b), end_of_pass_write_index: Some(*e) });
                    // Named by its first pipeline (SET_PIPELINE).
                    self.timed_pass = timed.as_ref().map(|(_, b, _)| (*b, String::new()));
                    self.pass_draws = 0;
                    let pass = self.encoder().begin_compute_pass(&wgpu::ComputePassDescriptor { label: None, timestamp_writes }).forget_lifetime();
                    self.pass = Some(pass);
                }
                op::SET_PIPELINE => {
                    // A render pass or bundle takes render pipelines, a compute pass compute pipelines.
                    self.settle(self.benc.is_some() || self.rpass.is_some(), arg(0)?);
                    if self.benc.is_some() {
                        let p = keep(get(&self.render_pipelines, arg(0)?, "render pipeline")?);
                        self.benc.as_mut().unwrap().set_pipeline(p);
                        if timing::detailed() && !self.benc_pipes.contains(&arg(0)?) {
                            self.benc_pipes.push(arg(0)?);
                        }
                    } else if self.rpass.is_some() {
                        let p = get(&self.render_pipelines, arg(0)?, "render pipeline")?.clone();
                        // the host's GPU timing (level 2): a timed pass's direct draws are split where their pipeline changes.
                        if self.timed_pass.is_some() {
                            let id = arg(0)? as usize;
                            if let Some((set, at)) = timing::mark(|| format!("draws {}", self.render_pipeline_names.get(id).map_or("?", |n| n.as_str()))) {
                                self.rpass()?.write_timestamp(&set, at);
                                self.restart_segment_stats();
                            }
                        }
                        self.rpass()?.set_pipeline(&p);
                    } else {
                        let p = get(&self.pipelines, arg(0)?, "pipeline")?.clone();
                        self.pass()?.set_pipeline(&p);
                        if let Some((_, name)) = self.timed_pass.as_mut().filter(|(_, name)| name.is_empty()) {
                            *name = match self.compute_pipeline_names.get(arg(0)? as usize).filter(|n| !n.is_empty()) {
                                Some(n) => format!("compute {n}"),
                                None => format!("compute pipeline {}", arg(0)?),
                            };
                        }
                    }
                }
                op::SET_BIND_GROUP => {
                    let g = get(&self.groups, arg(1)?, "bind group")?.clone();
                    let index = arg(0)?;
                    if let Some(b) = self.benc.as_mut() {
                        b.set_bind_group(index, &g, &[]);
                    } else if self.rpass.is_some() {
                        self.rpass()?.set_bind_group(index, &g, &[]);
                    } else {
                        self.pass()?.set_bind_group(index, &g, &[]);
                    }
                }
                op::DISPATCH => {
                    let (x, y, z) = (arg(0)?, arg(1)?, arg(2)?);
                    self.pass()?.dispatch_workgroups(x, y, z);
                    // the host's GPU timing: a compute pass is named by its first pipeline and its first dispatch's size.
                    if self.pass_draws == 0 {
                        if let Some((_, name)) = self.timed_pass.as_mut() {
                            name.push_str(&format!(" [{x}x{y}x{z}]"));
                        }
                    }
                    self.pass_draws += 1;
                }
                op::END_COMPUTE => {
                    // Dropping a pass ends it.
                    self.pass.take().ok_or(ExecError::State("no compute pass open"))?;
                    self.name_timed_pass();
                }
                op::COPY_BUFFER => {
                    let (src, dst) = (get(&self.buffers, arg(0)?, "buffer")?.clone(), get(&self.buffers, arg(2)?, "buffer")?.clone());
                    let (so, dof, size) = (arg(1)? as u64, arg(3)? as u64, arg(4)? as u64);
                    self.encoder().copy_buffer_to_buffer(&src, so, &dst, dof, size);
                }
                op::SUBMIT => {
                    // No open encoder submits nothing, like the JS `[]`. A pass left open ends here.
                    self.pass = None;
                    if std::mem::take(&mut self.stats_open) {
                        if let Some(rpass) = self.rpass.as_mut() {
                            rpass.end_pipeline_statistics_query();
                        }
                    }
                    self.rpass = None;
                    self.name_timed_pass();
                    // The belt's writes go first, in a submission of their own: a submission with any invalid command
                    // buffer runs none of them (wgpu-core's Queue::submit), so one the program's own commands made
                    // invalid (a destroyed buffer a bundle still uses, at a scene change) would drop the writes with
                    // it, where Queue::write_buffer's stay pending for the next submission that succeeds. The belt's
                    // only take valid writes (`belt_takes`): their submission cannot fail on the program's account.
                    let t_uploads = prof.then(Instant::now);
                    self.flush_uploads();
                    let uploads_ns = t_uploads.map_or(0, |t| t.elapsed().as_nanos() as u64);
                    let t = prof.then(Instant::now);
                    let buffers: Vec<wgpu::CommandBuffer> = self.encoder.take().into_iter().map(|e| e.finish()).collect();
                    let finished = t.map(|t| t.elapsed().as_nanos() as u64);
                    if !buffers.is_empty() {
                        self.queue.submit(buffers);
                    }
                    if prof && uploads_ns > 0 {
                        self.prof.n[profile::SLOT_UPLOADS] += 1;
                        self.prof.ns[profile::SLOT_UPLOADS] += uploads_ns;
                    }
                    if let (Some(t), Some(f)) = (t, finished) {
                        // The SUBMIT's halves (GPU_STREAM_PROFILE): the encoders' finish (wgpu encodes the passes there)
                        // and the queue's submit.
                        self.prof.n[profile::SLOT_FINISH] += 1;
                        self.prof.ns[profile::SLOT_FINISH] += f;
                        self.prof.n[profile::SLOT_QUEUE_SUBMIT] += 1;
                        self.prof.ns[profile::SLOT_QUEUE_SUBMIT] += (t.elapsed().as_nanos() as u64).saturating_sub(f);
                    }
                    self.stats.submits += 1;
                }
                op::MAP_READ => {
                    self.flush_uploads();
                    let ticket = arg(0)?;
                    let buffer = get(&self.buffers, arg(1)?, "buffer")?.clone();
                    let (offset, size) = (arg(2)? as u64, arg(3)? as u64);
                    let done = self.done.clone();
                    let b = buffer.clone();
                    buffer.slice(offset..offset + size).map_async(wgpu::MapMode::Read, move |r| {
                        done.lock().unwrap().maps.push((ticket, b, offset, size, r.map_err(|e| e.to_string())));
                    });
                    self.in_flight.set(self.in_flight.get() + 1);
                    self.stats.tickets += 1;
                }
                op::WORK_DONE => {
                    self.flush_uploads();
                    let (ticket, done) = (arg(0)?, self.done.clone());
                    self.queue.on_submitted_work_done(move || done.lock().unwrap().work.push(ticket));
                    self.in_flight.set(self.in_flight.get() + 1);
                    self.stats.tickets += 1;
                }
                op::PUSH_ERROR_SCOPE => {
                    // A validation scope around one pipeline creation is the stream's async creation (`made_async`).
                    if arg(0)? == 0 {
                        if let Some(after) = self.made_async(words, i, staging)? {
                            i = after;
                            continue;
                        }
                    }
                    // validation, out-of-memory, internal
                    let filter = match arg(0)? {
                        0 => wgpu::ErrorFilter::Validation,
                        1 => wgpu::ErrorFilter::OutOfMemory,
                        2 => wgpu::ErrorFilter::Internal,
                        _ => return Err(ExecError::State("bad error filter")),
                    };
                    self.scopes.push(self.device.push_error_scope(filter));
                }
                op::POP_ERROR_SCOPE => {
                    let ticket = arg(0)?;
                    match self.scopes.pop() {
                        Some(scope) => self.pops.borrow_mut().push((ticket, Box::pin(scope.pop()))),
                        // WebGPU rejects popping an empty stack: the ticket fails.
                        None => self.link.complete(ticket, 1, cut("popErrorScope with no error scope", self.link.ticket_cap(ticket))),
                    }
                }
                op::DESTROY => {
                    let (kind, id) = (arg(0)?, arg(1)?);
                    match kind {
                        0 => {
                            // A belt write to it still pending runs first (its copy would refuse a destroyed buffer).
                            self.flush_uploads();
                            get(&self.buffers, id, "buffer")?.destroy();
                            clear(&mut self.buffers, id);
                            census::drop_buffer(id);
                        }
                        1 => {
                            get(&self.shaders, id, "shader")?;
                            clear(&mut self.shaders, id)
                        }
                        2 => {
                            self.settle(false, id);
                            get(&self.pipelines, id, "pipeline")?;
                            clear(&mut self.pipelines, id)
                        }
                        3 => {
                            get(&self.groups, id, "bind group")?;
                            clear(&mut self.groups, id)
                        }
                        4 => {
                            // A surface texture belongs to the surface: only its handle goes.
                            if let Some(Some(t)) = self.textures.get(id as usize) {
                                if !self.surface_textures.remove(&id) {
                                    t.destroy();
                                }
                            }
                            if (id as usize) < self.textures.len() {
                                clear(&mut self.textures, id);
                            }
                            census::drop_texture(id);
                        }
                        5 => {
                            get(&self.views, id, "texture view")?;
                            clear(&mut self.views, id)
                        }
                        6 => {
                            get(&self.samplers, id, "sampler")?;
                            clear(&mut self.samplers, id)
                        }
                        7 => {
                            get(&self.group_layouts, id, "bind group layout")?;
                            clear(&mut self.group_layouts, id)
                        }
                        8 => {
                            get(&self.pipeline_layouts, id, "pipeline layout")?;
                            clear(&mut self.pipeline_layouts, id)
                        }
                        9 => {
                            self.settle(true, id);
                            get(&self.render_pipelines, id, "render pipeline")?;
                            clear(&mut self.render_pipelines, id)
                        }
                        10 => {
                            get(&self.render_bundles, id, "render bundle")?;
                            clear(&mut self.render_bundles, id)
                        }
                        11 => {
                            get(&self.draw_lists, id, "draw list")?;
                            clear(&mut self.draw_lists, id)
                        }
                        _ => return Err(ExecError::State("bad handle kind")),
                    }
                }
                op::CREATE_TEXTURE => {
                    let mut r = Blob { b: bytes(arg(1)?, arg(2)?)?, p: 0 };
                    let size = wgpu::Extent3d { width: r.u()?, height: r.u()?, depth_or_array_layers: r.u()? };
                    let (mips, samples) = (r.u()?, r.u()?);
                    let dimension = map::texture_dimension(r.n(tables::TEXTURE_DIMENSIONS)?)?;
                    let format: wgpu::TextureFormat = r.e(tables::TEXTURE_FORMATS)?;
                    let usage = wgpu::TextureUsages::from_bits_truncate(r.u()?);
                    let n = r.u()?;
                    let mut view_formats = Vec::new();
                    for _ in 0..n {
                        view_formats.push(r.e::<wgpu::TextureFormat>(tables::TEXTURE_FORMATS)?);
                    }
                    let d = wgpu::TextureDescriptor {
                        label: None, size, mip_level_count: mips, sample_count: samples, dimension, format, usage, view_formats: &view_formats,
                    };
                    let t = self.device.create_texture(&d);
                    census::texture(arg(0)?, &d);
                    self.surface_textures.remove(&arg(0)?);
                    set(&mut self.textures, arg(0)?, t);
                }
                op::CREATE_VIEW => {
                    let tex = get(&self.textures, arg(1)?, "texture")?;
                    let (fmt, dim) = (arg(2)?, arg(3)?);
                    let (mips, layers) = (arg(6)?, arg(8)?);
                    let d = wgpu::TextureViewDescriptor {
                        label: None,
                        format: pick_opt(tables::TEXTURE_FORMATS, fmt)?,
                        dimension: if dim != 0 { Some(map::view_dimension(name(tables::VIEW_DIMENSIONS, dim - 1)?)?) } else { None },
                        usage: None,
                        aspect: pick(tables::ASPECTS, arg(4)?)?,
                        base_mip_level: arg(5)?,
                        mip_level_count: (mips != 0).then_some(mips),
                        base_array_layer: arg(7)?,
                        array_layer_count: (layers != 0).then_some(layers),
                    };
                    if timing::installed() {
                        let (size, at) = (tex.size(), arg(0)? as usize);
                        if self.view_meta.len() <= at {
                            self.view_meta.resize(at + 1, (0, 0, wgpu::TextureFormat::R8Unorm));
                        }
                        let mip = arg(5)?.min(31);
                        self.view_meta[at] = ((size.width >> mip).max(1), (size.height >> mip).max(1), d.format.unwrap_or(tex.format()));
                    }
                    let v = tex.create_view(&d);
                    set(&mut self.views, arg(0)?, v);
                }
                op::CREATE_SAMPLER => {
                    let compare = arg(9)?;
                    let d = wgpu::SamplerDescriptor {
                        label: None,
                        address_mode_u: pick(tables::ADDRESS_MODES, arg(1)?)?,
                        address_mode_v: pick(tables::ADDRESS_MODES, arg(2)?)?,
                        address_mode_w: pick(tables::ADDRESS_MODES, arg(3)?)?,
                        mag_filter: pick(tables::FILTER_MODES, arg(4)?)?,
                        min_filter: pick(tables::FILTER_MODES, arg(5)?)?,
                        mipmap_filter: pick(tables::FILTER_MODES, arg(6)?)?,
                        lod_min_clamp: f32::from_bits(arg(7)?),
                        lod_max_clamp: f32::from_bits(arg(8)?),
                        compare: pick_opt(tables::COMPARE_FUNCTIONS, compare)?,
                        anisotropy_clamp: arg(10)? as u16,
                        border_color: None,
                    };
                    let s = self.device.create_sampler(&d);
                    set(&mut self.samplers, arg(0)?, s);
                }
                op::CREATE_BIND_GROUP_LAYOUT => {
                    let mut r = Blob { b: bytes(arg(1)?, arg(2)?)?, p: 0 };
                    let n = r.u()?;
                    let mut entries = Vec::new();
                    for _ in 0..n {
                        let (binding, visibility, kind, x, y, z) = (r.u()?, r.u()?, r.u()?, r.u()?, r.u()?, r.u()?);
                        let ty = match kind {
                            0 => wgpu::BindingType::Buffer {
                                ty: map::buffer_binding(name(tables::BUFFER_BINDING_TYPES, x)?)?,
                                has_dynamic_offset: y != 0,
                                min_binding_size: NonZeroU64::new(z as u64),
                            },
                            1 => wgpu::BindingType::Sampler(pick(tables::SAMPLER_BINDING_TYPES, x)?),
                            2 => wgpu::BindingType::Texture {
                                sample_type: map::sample_type(name(tables::SAMPLE_TYPES, x)?)?,
                                view_dimension: map::view_dimension(name(tables::VIEW_DIMENSIONS, y)?)?,
                                multisampled: z != 0,
                            },
                            _ => wgpu::BindingType::StorageTexture {
                                access: pick(tables::STORAGE_ACCESS, x)?,
                                format: pick(tables::TEXTURE_FORMATS, y)?,
                                view_dimension: map::view_dimension(name(tables::VIEW_DIMENSIONS, z)?)?,
                            },
                        };
                        entries.push(wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::from_bits_truncate(visibility), ty, count: None });
                    }
                    let l = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &entries });
                    set(&mut self.group_layouts, arg(0)?, l);
                }
                op::CREATE_PIPELINE_LAYOUT => {
                    let mut r = Blob { b: bytes(arg(1)?, arg(2)?)?, p: 0 };
                    let n = r.u()?;
                    let mut layouts = Vec::new();
                    for _ in 0..n {
                        layouts.push(get(&self.group_layouts, r.u()?, "bind group layout")?);
                    }
                    let l = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &layouts.into_iter().map(Some).collect::<Vec<_>>(), ..Default::default() });
                    set(&mut self.pipeline_layouts, arg(0)?, l);
                }
                op::CREATE_BIND_GROUP_WITH_LAYOUT => {
                    let mut r = Blob { b: bytes(arg(1)?, arg(2)?)?, p: 0 };
                    let layout = get(&self.group_layouts, r.u()?, "bind group layout")?;
                    let n = r.u()?;
                    let mut entries = Vec::new();
                    for _ in 0..n {
                        let (binding, kind, h, offset, size) = (r.u()?, r.u()?, r.u()?, r.u()?, r.u()?);
                        let resource = match kind {
                            0 => wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: get(&self.buffers, h, "buffer")?, offset: offset as u64, size: NonZeroU64::new(size as u64) }),
                            1 => wgpu::BindingResource::Sampler(get(&self.samplers, h, "sampler")?),
                            _ => wgpu::BindingResource::TextureView(get(&self.views, h, "texture view")?),
                        };
                        entries.push(wgpu::BindGroupEntry { binding, resource });
                    }
                    let g = self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout, entries: &entries });
                    set(&mut self.groups, arg(0)?, g);
                }
                // Compiled on a compile thread, waited for at the pipeline's first use (`settle`): the pipelines a stream
                // makes before it uses them compile at once, as the page's GPU process compiles them while the page
                // records on.
                op::CREATE_COMPUTE_PIPELINE_WITH_LAYOUT => self.compile(false, arg(0)?, bytes(arg(1)?, arg(2)?)?, None)?,
                op::GET_BIND_GROUP_LAYOUT => {
                    self.settle(arg(1)? == 9, arg(2)?);
                    let l = if arg(1)? == 9 {
                        get(&self.render_pipelines, arg(2)?, "render pipeline")?.get_bind_group_layout(arg(3)?)
                    } else {
                        get(&self.pipelines, arg(2)?, "pipeline")?.get_bind_group_layout(arg(3)?)
                    };
                    set(&mut self.group_layouts, arg(0)?, l);
                }
                op::CREATE_RENDER_PIPELINE => self.compile(true, arg(0)?, bytes(arg(1)?, arg(2)?)?, None)?,
                op::BEGIN_RENDER_PASS => {
                    let mut r = Blob { b: bytes(arg(0)?, arg(1)?)?, p: 0 };
                    let n = r.u()?;
                    let mut colors = Vec::new();
                    // the host's GPU timing: the attachments' view ids and the first one's load, to name the pass.
                    let mut named: Vec<u32> = Vec::new();
                    let mut first_load = "";
                    for _ in 0..n {
                        let (v, resolve) = (r.u()?, r.u()?);
                        let load = r.n(tables::LOAD_OPS)?;
                        if v != 0 && named.is_empty() {
                            first_load = load;
                        }
                        if v != 0 {
                            named.push(v);
                        }
                        let store: wgpu::StoreOp = r.e(tables::STORE_OPS)?;
                        let clear = wgpu::Color { r: r.f()? as f64, g: r.f()? as f64, b: r.f()? as f64, a: r.f()? as f64 };
                        // View 0 is a hole in the attachment list.
                        if v == 0 {
                            colors.push(None);
                            continue;
                        }
                        colors.push(Some(wgpu::RenderPassColorAttachment {
                            view: keep(get(&self.views, v, "texture view")?),
                            depth_slice: None,
                            resolve_target: if resolve != 0 { Some(keep(get(&self.views, resolve, "texture view")?)) } else { None },
                            ops: wgpu::Operations { load: if load == "clear" { wgpu::LoadOp::Clear(clear) } else { wgpu::LoadOp::Load }, store },
                        }));
                    }
                    let mut depth_view = None;
                    let depth = if r.u()? == 1 {
                        let id = r.u()?;
                        depth_view = Some(id);
                        let view = keep(get(&self.views, id, "texture view")?);
                        let load = r.u()?;
                        if named.is_empty() {
                            first_load = if load == 0 { "" } else { name(tables::LOAD_OPS, load - 1)? };
                        }
                        let store = r.u()?;
                        let clear = r.f()?;
                        let _depth_read_only = r.u()?;
                        let sload = r.u()?;
                        let sstore = r.u()?;
                        let sclear = r.u()?;
                        let _stencil_read_only = r.u()?;
                        let ops = |load: u32, store: u32| -> Result<Option<wgpu::Operations<f32>>, ExecError> {
                            if load == 0 {
                                return Ok(None);
                            }
                            let l = name(tables::LOAD_OPS, load - 1)?;
                            let s: wgpu::StoreOp = pick(tables::STORE_OPS, store.saturating_sub(1))?;
                            Ok(Some(wgpu::Operations { load: if l == "clear" { wgpu::LoadOp::Clear(clear) } else { wgpu::LoadOp::Load }, store: s }))
                        };
                        let sops = |load: u32, store: u32| -> Result<Option<wgpu::Operations<u32>>, ExecError> {
                            if load == 0 {
                                return Ok(None);
                            }
                            let l = name(tables::LOAD_OPS, load - 1)?;
                            let s: wgpu::StoreOp = pick(tables::STORE_OPS, store.saturating_sub(1))?;
                            Ok(Some(wgpu::Operations { load: if l == "clear" { wgpu::LoadOp::Clear(sclear) } else { wgpu::LoadOp::Load }, store: s }))
                        };
                        Some(wgpu::RenderPassDepthStencilAttachment { view, depth_ops: ops(load, store)?, stencil_ops: sops(sload, sstore)? })
                    } else {
                        None
                    };
                    let timed = timing::pass();
                    let timestamp_writes = timed.as_ref().map(|(set, b, e)| wgpu::RenderPassTimestampWrites { query_set: set, beginning_of_pass_write_index: Some(*b), end_of_pass_write_index: Some(*e) });
                    self.timed_pass = timed.as_ref().map(|(_, b, _)| (*b, self.render_pass_name(&named, depth_view, first_load)));
                    self.pass_draws = 0;
                    self.stats_open = false;
                    if self.timed_pass.is_some() {
                        self.restart_segment_stats();
                    }
                    let pass = self
                        .encoder()
                        .begin_render_pass(&wgpu::RenderPassDescriptor { label: None, color_attachments: &colors, depth_stencil_attachment: depth, timestamp_writes, ..Default::default() })
                        .forget_lifetime();
                    self.rpass = Some(pass);
                }
                op::SET_VIEWPORT => {
                    let f = |k: usize| arg(k).map(f32::from_bits);
                    let (x, y, w, h, min, max) = (f(0)?, f(1)?, f(2)?, f(3)?, f(4)?, f(5)?);
                    self.rpass()?.set_viewport(x, y, w, h, min, max);
                }
                op::SET_SCISSOR => {
                    let (x, y, w, h) = (arg(0)?, arg(1)?, arg(2)?, arg(3)?);
                    self.rpass()?.set_scissor_rect(x, y, w, h);
                }
                op::SET_VERTEX_BUFFER => {
                    let b = keep(get(&self.buffers, arg(1)?, "buffer")?);
                    let (slot, offset, size) = (arg(0)?, arg(2)?, arg(3)?);
                    if let Some(enc) = self.benc.as_mut() {
                        enc.set_vertex_buffer(slot, slice(b, offset, size));
                    } else {
                        self.rpass()?.set_vertex_buffer(slot, slice(b, offset, size));
                    }
                }
                op::SET_INDEX_BUFFER => {
                    let b = keep(get(&self.buffers, arg(0)?, "buffer")?);
                    let fmt: wgpu::IndexFormat = pick(tables::INDEX_FORMATS, arg(1)?)?;
                    let (offset, size) = (arg(2)?, arg(3)?);
                    if let Some(enc) = self.benc.as_mut() {
                        enc.set_index_buffer(slice(b, offset, size), fmt);
                    } else {
                        self.rpass()?.set_index_buffer(slice(b, offset, size), fmt);
                    }
                }
                op::DRAW => {
                    let (v, inst, fv, fi) = (arg(0)?, arg(1)?, arg(2)?, arg(3)?);
                    if let Some(enc) = self.benc.as_mut() {
                        enc.draw(fv..fv + v, fi..fi + inst);
                    } else {
                        self.rpass()?.draw(fv..fv + v, fi..fi + inst);
                        self.pass_draws += 1;
                    }
                }
                op::DRAW_INDEXED => {
                    let (ic, inst, fidx, base, fi) = (arg(0)?, arg(1)?, arg(2)?, arg(3)? as i32, arg(4)?);
                    if let Some(enc) = self.benc.as_mut() {
                        enc.draw_indexed(fidx..fidx + ic, base, fi..fi + inst);
                    } else {
                        self.rpass()?.draw_indexed(fidx..fidx + ic, base, fi..fi + inst);
                        self.pass_draws += 1;
                    }
                }
                op::DRAW_INDIRECT => {
                    let b = keep(get(&self.buffers, arg(0)?, "buffer")?);
                    let off = arg(1)? as u64;
                    if let Some(enc) = self.benc.as_mut() {
                        enc.draw_indirect(b, off);
                    } else {
                        self.rpass()?.draw_indirect(b, off);
                        self.pass_draws += 1;
                    }
                }
                op::DRAW_INDEXED_INDIRECT => {
                    let b = keep(get(&self.buffers, arg(0)?, "buffer")?);
                    let off = arg(1)? as u64;
                    if let Some(enc) = self.benc.as_mut() {
                        enc.draw_indexed_indirect(b, off);
                    } else {
                        self.rpass()?.draw_indexed_indirect(b, off);
                        self.pass_draws += 1;
                    }
                }
                op::CREATE_RENDER_BUNDLE_ENCODER => {
                    if self.benc.is_some() {
                        return Err(ExecError::State("a render bundle is already recording"));
                    }
                    let mut r = Blob { b: bytes(arg(1)?, arg(2)?)?, p: 0 };
                    let n = r.u()?;
                    let mut formats = Vec::with_capacity(n as usize);
                    for _ in 0..n {
                        formats.push(Some(r.e::<wgpu::TextureFormat>(tables::TEXTURE_FORMATS)?));
                    }
                    let depth = r.u()?;
                    let depth_format: Option<wgpu::TextureFormat> = pick_opt(tables::TEXTURE_FORMATS, depth)?;
                    let (sample_count, depth_read_only, stencil_read_only) = (r.u()?, r.u()? != 0, r.u()? != 0);
                    let depth_stencil = depth_format.map(|format| wgpu::RenderBundleDepthStencil { format, depth_read_only, stencil_read_only });
                    let enc = self.device.create_render_bundle_encoder(&wgpu::RenderBundleEncoderDescriptor {
                        label: None,
                        color_formats: &formats,
                        depth_stencil,
                        sample_count,
                        multiview: None,
                    });
                    self.benc = Some(enc);
                    self.benc_id = arg(0)?;
                    self.benc_counts = [0; profile::REPLAY_KINDS];
                    self.benc_pipes.clear();
                    self.benc_desc = (formats, depth_stencil, sample_count);
                }
                op::FINISH_RENDER_BUNDLE => {
                    let enc = self.benc.take().ok_or(ExecError::State("no render bundle recording"))?;
                    // wgpu panics on a bundle that fails validation (its finish's error is fatal), as one that sets a
                    // pipeline whose compile failed does (DXC's E_FAIL, seen under load): the process ended there. The
                    // error is reported as an uncaptured one instead, and an empty bundle of the same formats stands in
                    // (its draws are missing, as a browser's invalid bundle draws nothing).
                    let finished = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| enc.finish(&wgpu::RenderBundleDescriptor { label: None })));
                    let b = match finished {
                        Ok(b) => b,
                        Err(_) => {
                            UNCAPTURED_ERRORS.fetch_add(1, Ordering::Relaxed);
                            eprintln!("gpu-stream: render bundle {} is invalid (above); an empty one stands in", self.benc_id);
                            let (formats, depth_stencil, sample_count) = &self.benc_desc;
                            self.device
                                .create_render_bundle_encoder(&wgpu::RenderBundleEncoderDescriptor { label: None, color_formats: formats, depth_stencil: *depth_stencil, sample_count: *sample_count, multiview: None })
                                .finish(&wgpu::RenderBundleDescriptor { label: None })
                        }
                    };
                    set(&mut self.render_bundles, self.benc_id, b);
                    if timing::detailed() {
                        let at = self.benc_id as usize;
                        if self.bundle_names.len() <= at {
                            self.bundle_names.resize(at + 1, String::new());
                        }
                        let names: Vec<&str> = self.benc_pipes.iter().map(|&p| self.render_pipeline_names.get(p as usize).map_or("?", |n| n.as_str())).collect();
                        self.bundle_names[at] = match names.len() {
                            0 => "bundle (no pipeline)".to_string(),
                            1..=2 => format!("bundle {}", names.join(" + ")),
                            n => format!("bundle {} + {} more", names[..2].join(" + "), n - 2),
                        };
                    }
                    if prof {
                        let at = self.benc_id as usize;
                        if self.bundle_counts.len() <= at {
                            self.bundle_counts.resize(at + 1, [0; profile::REPLAY_KINDS]);
                        }
                        self.bundle_counts[at] = self.benc_counts;
                    }
                }
                op::EXECUTE_BUNDLES => {
                    let n = arg(0)? as usize;
                    let ids = a.get(1..1 + n).ok_or(ExecError::Truncated)?;
                    let mut list = Vec::with_capacity(n);
                    for &id in ids {
                        list.push(get(&self.render_bundles, id, "render bundle")?.clone());
                        if prof {
                            if let Some(c) = self.bundle_counts.get(id as usize) {
                                for k in 0..profile::REPLAY_KINDS {
                                    self.prof.n[profile::SLOT_REPLAY + k] += c[k];
                                }
                                self.pass_draws += c[4] as u32;
                            }
                        }
                    }
                    if self.timed_pass.is_some() && timing::detailed() {
                        // the host's GPU timing (level 2): a mark before each bundle, each executed on its own.
                        for (b, &id) in list.iter().zip(ids) {
                            if let Some((set, at)) = timing::mark(|| self.bundle_names.get(id as usize).cloned().unwrap_or_else(|| "bundle ?".to_string())) {
                                self.rpass()?.write_timestamp(&set, at);
                                self.restart_segment_stats();
                            }
                            self.rpass()?.execute_bundles(std::iter::once(b));
                        }
                    } else {
                        self.rpass()?.execute_bundles(list.iter());
                    }
                }
                op::CREATE_DRAW_LIST => set(&mut self.draw_lists, arg(0)?, Vec::new()),
                op::SET_DRAW_LIST => {
                    let buckets = draw_list::parse(bytes(arg(2)?, arg(3)?)?, arg(1)? as usize)?;
                    get(&self.draw_lists, arg(0)?, "draw list")?;
                    set(&mut self.draw_lists, arg(0)?, buckets);
                }
                op::DRAW_LIST => self.draw_list(arg(0)?)?,
                op::END_RENDER_PASS => {
                    // Dropping a pass ends it (and its open statistics query first).
                    if std::mem::take(&mut self.stats_open) {
                        self.rpass()?.end_pipeline_statistics_query();
                    }
                    self.rpass.take().ok_or(ExecError::State("no render pass open"))?;
                    self.name_timed_pass();
                }
                op::SET_STENCIL_REFERENCE => {
                    let v = arg(0)?;
                    self.rpass()?.set_stencil_reference(v);
                }
                op::SET_BLEND_CONSTANT => {
                    let f = |k: usize| arg(k).map(|v| f32::from_bits(v) as f64);
                    let c = wgpu::Color { r: f(0)?, g: f(1)?, b: f(2)?, a: f(3)? };
                    self.rpass()?.set_blend_constant(c);
                }
                op::SET_BIND_GROUP_DYNAMIC => {
                    let g = get(&self.groups, arg(1)?, "bind group")?.clone();
                    let n = arg(2)? as usize;
                    let offsets = a.get(3..3 + n).ok_or(ExecError::Truncated)?;
                    let index = arg(0)?;
                    if let Some(enc) = self.benc.as_mut() {
                        enc.set_bind_group(index, &g, offsets);
                    } else if self.rpass.is_some() {
                        self.rpass()?.set_bind_group(index, &g, offsets);
                    } else {
                        self.pass()?.set_bind_group(index, &g, offsets);
                    }
                }
                op::WRITE_TEXTURE => {
                    let tex = get(&self.textures, arg(0)?, "texture")?;
                    let data = bytes(arg(6)?, arg(7)?)?;
                    let dst = wgpu::TexelCopyTextureInfo {
                        texture: tex,
                        mip_level: arg(1)?,
                        origin: wgpu::Origin3d { x: arg(2)?, y: arg(3)?, z: arg(4)? },
                        aspect: pick(tables::ASPECTS, arg(5)?)?,
                    };
                    let layout = wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: stride(arg(8)?), rows_per_image: stride(arg(9)?) };
                    let size = wgpu::Extent3d { width: arg(10)?, height: arg(11)?, depth_or_array_layers: arg(12)? };
                    self.queue.write_texture(dst, data, layout, size);
                    self.stats.writes += 1;
                    self.stats.write_bytes += data.len() as u64;
                }
                op::COPY_BUFFER_TO_TEXTURE => {
                    let buffer = get(&self.buffers, arg(0)?, "buffer")?.clone();
                    let texture = get(&self.textures, arg(4)?, "texture")?.clone();
                    let src = wgpu::TexelCopyBufferInfo {
                        buffer: &buffer,
                        layout: wgpu::TexelCopyBufferLayout { offset: arg(1)? as u64, bytes_per_row: stride(arg(2)?), rows_per_image: stride(arg(3)?) },
                    };
                    let dst = wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: arg(5)?,
                        origin: wgpu::Origin3d { x: arg(6)?, y: arg(7)?, z: arg(8)? },
                        aspect: pick(tables::ASPECTS, arg(9)?)?,
                    };
                    let size = wgpu::Extent3d { width: arg(10)?, height: arg(11)?, depth_or_array_layers: arg(12)? };
                    self.encoder().copy_buffer_to_texture(src, dst, size);
                }
                op::COPY_TEXTURE_TO_BUFFER => {
                    let texture = get(&self.textures, arg(0)?, "texture")?.clone();
                    let buffer = get(&self.buffers, arg(6)?, "buffer")?.clone();
                    let src = wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: arg(1)?,
                        origin: wgpu::Origin3d { x: arg(2)?, y: arg(3)?, z: arg(4)? },
                        aspect: pick(tables::ASPECTS, arg(5)?)?,
                    };
                    let dst = wgpu::TexelCopyBufferInfo {
                        buffer: &buffer,
                        layout: wgpu::TexelCopyBufferLayout { offset: arg(7)? as u64, bytes_per_row: stride(arg(8)?), rows_per_image: stride(arg(9)?) },
                    };
                    let size = wgpu::Extent3d { width: arg(10)?, height: arg(11)?, depth_or_array_layers: arg(12)? };
                    self.encoder().copy_texture_to_buffer(src, dst, size);
                }
                op::COPY_TEXTURE_TO_TEXTURE => {
                    let (st, dt) = (get(&self.textures, arg(0)?, "texture")?.clone(), get(&self.textures, arg(6)?, "texture")?.clone());
                    let src = wgpu::TexelCopyTextureInfo { texture: &st, mip_level: arg(1)?, origin: wgpu::Origin3d { x: arg(2)?, y: arg(3)?, z: arg(4)? }, aspect: pick(tables::ASPECTS, arg(5)?)? };
                    let dst = wgpu::TexelCopyTextureInfo { texture: &dt, mip_level: arg(7)?, origin: wgpu::Origin3d { x: arg(8)?, y: arg(9)?, z: arg(10)? }, aspect: pick(tables::ASPECTS, arg(11)?)? };
                    let size = wgpu::Extent3d { width: arg(12)?, height: arg(13)?, depth_or_array_layers: arg(14)? };
                    self.encoder().copy_texture_to_texture(src, dst, size);
                }
                op::CONFIGURE_SURFACE => {
                    let mut r = Blob { b: bytes(arg(0)?, arg(1)?)?, p: 0 };
                    let format: wgpu::TextureFormat = r.e(tables::TEXTURE_FORMATS)?;
                    let alpha = map::alpha_mode(r.n(tables::ALPHA_MODES)?)?;
                    let usage = wgpu::TextureUsages::from_bits_truncate(r.u()?);
                    let n = r.u()?;
                    let mut view_formats = Vec::new();
                    for _ in 0..n {
                        view_formats.push(r.e::<wgpu::TextureFormat>(tables::TEXTURE_FORMATS)?);
                    }
                    let target = match self.selected {
                        0 => self.surface.as_mut(),
                        n => self.extra_surfaces.get_mut(n as usize - 1).and_then(Option::as_mut),
                    };
                    match target {
                        Some(Surface::Window { surface, width, height, .. }) => surface.configure(&self.device, &wgpu::SurfaceConfiguration {
                            usage, format, width: *width, height: *height, present_mode: wgpu::PresentMode::Fifo,
                            desired_maximum_frame_latency: 2, alpha_mode: alpha, view_formats,
                            color_space: Default::default(),
                        }),
                        Some(Surface::Scene(s)) => {
                            // The host samples it; the next ACQUIRE makes it (the last frame shown stays shown meanwhile).
                            s.textures.clear();
                            s.config = Some((format, usage | wgpu::TextureUsages::TEXTURE_BINDING, view_formats));
                        }
                        None => return Err(ExecError::State("CONFIGURE_SURFACE without a surface (Executor::set_surface)")),
                    }
                }
                op::ACQUIRE_SURFACE_TEXTURE => {
                    let target = match self.selected {
                        0 => self.surface.as_mut(),
                        n => self.extra_surfaces.get_mut(n as usize - 1).and_then(Option::as_mut),
                    };
                    let texture = match target {
                        Some(Surface::Window { surface, current, .. }) => {
                            let st = match surface.get_current_texture() {
                                wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
                                other => return Err(ExecError::Device(format!("surface texture unavailable ({:?})", std::mem::discriminant(&other)))),
                            };
                            let t = st.texture.clone();
                            *current = Some(st);
                            t
                        }
                        Some(Surface::Scene(s)) => {
                            let (format, usage, view_formats) = s.config.clone().ok_or(ExecError::State("ACQUIRE_SURFACE_TEXTURE before CONFIGURE_SURFACE"))?;
                            let size = (s.width.max(1), s.height.max(1));
                            if s.texture_size != size {
                                s.textures.clear();
                                s.texture_size = size;
                            }
                            // The next of the surface's textures: with more than one, the frame the host composites is not
                            // the one being drawn (a host compositing on another thread: `set_scene_buffers`).
                            s.current = (s.current + 1) % self.scene_buffers;
                            if s.textures.len() <= s.current {
                                s.current = s.textures.len();
                                s.textures.push(self.device.create_texture(&wgpu::TextureDescriptor {
                                    label: Some("core scene"),
                                    size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                                    // COPY_SRC beside the page's usage: the host reads its own scene back (captures).
                                    mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format, usage: usage | wgpu::TextureUsages::COPY_SRC, view_formats: &view_formats,
                                }));
                            }
                            s.textures[s.current].clone()
                        }
                        None => return Err(ExecError::State("ACQUIRE_SURFACE_TEXTURE without a surface (Executor::set_surface)")),
                    };
                    census::drop_texture(arg(0)?);
                    set(&mut self.textures, arg(0)?, texture);
                    self.surface_textures.insert(arg(0)?);
                }
                op::PRESENT => match match self.selected {
                    0 => self.surface.as_mut(),
                    n => self.extra_surfaces.get_mut(n as usize - 1).and_then(Option::as_mut),
                } {
                    Some(Surface::Window { current, .. }) => {
                        if let Some(t) = current.take() {
                            self.queue.present(t);
                        }
                    }
                    Some(Surface::Scene(s)) => {
                        if let (Some(t), Some((format, _, _))) = (s.textures.get(s.current), s.config.as_ref()) {
                            s.shown = Some((t.clone(), *format, s.texture_size));
                        }
                        s.presented += 1;
                    }
                    None => return Err(ExecError::State("PRESENT without a surface (Executor::set_surface)")),
                },
                other => return Err(ExecError::UnknownOp(other)),
            }
        }
        if let Some((o, t)) = last {
            let k = (o as usize).min(profile::OPS - 1);
            self.prof.n[k] += 1;
            self.prof.ns[k] += t.elapsed().as_nanos() as u64;
        }
        Ok(())
    }

    /// The render pipeline `blob` describes (CREATE_RENDER_PIPELINE's), ready to make.
    fn render_spec(&self, id: u32, blob: &[u8]) -> Result<RenderSpec, ExecError> {
        let mut r = Blob { b: blob, p: 0 };
        let l = r.u()?;
        let layout = if l == 0 { None } else { Some(get(&self.pipeline_layouts, l, "pipeline layout")?.clone()) };
        let vstage = Stage::read(&mut r, &self.shaders)?;
        let nb = r.u()?;
        let mut attrs: Vec<Vec<wgpu::VertexAttribute>> = Vec::new();
        let mut bufs: Vec<(u64, wgpu::VertexStepMode)> = Vec::new();
        for _ in 0..nb {
            let stride = r.u()? as u64;
            let step: wgpu::VertexStepMode = r.e(tables::STEP_MODES)?;
            let na = r.u()?;
            let mut list = Vec::new();
            for _ in 0..na {
                let format: wgpu::VertexFormat = r.e(tables::VERTEX_FORMATS)?;
                list.push(wgpu::VertexAttribute { format, offset: r.u()? as u64, shader_location: r.u()? });
            }
            attrs.push(list);
            bufs.push((stride, step));
        }
        // GPU_STREAM_DUMP_SHADERS: each pipeline's vertex buffers too (debugging).
        if let Some(dir) = std::env::var_os("GPU_STREAM_DUMP_SHADERS") {
            let text: String = bufs
                .iter()
                .zip(&attrs)
                .map(|((stride, step), a)| format!("stride {stride} step {step:?}: {}\n", a.iter().map(|x| format!("loc {} off {} fmt {:?}", x.shader_location, x.offset, x.format)).collect::<Vec<_>>().join(", ")))
                .collect();
            let _ = std::fs::write(std::path::Path::new(&dir).join(format!("pipeline-{id}.txt")), text);
        }
        let mut fstage = None;
        let mut targets: Vec<Option<wgpu::ColorTargetState>> = Vec::new();
        if r.u()? == 1 {
            let fs = Stage::read(&mut r, &self.shaders)?;
            let nt = r.u()?;
            for _ in 0..nt {
                let format: wgpu::TextureFormat = r.e(tables::TEXTURE_FORMATS)?;
                let write_mask = wgpu::ColorWrites::from_bits_truncate(r.u()?);
                let mut blend = None;
                if r.u()? == 1 {
                    let mut comp = || -> Result<wgpu::BlendComponent, ExecError> {
                        Ok(wgpu::BlendComponent { operation: r.e(tables::BLEND_OPERATIONS)?, src_factor: r.e(tables::BLEND_FACTORS)?, dst_factor: r.e(tables::BLEND_FACTORS)? })
                    };
                    let color = comp()?;
                    let alpha = comp()?;
                    blend = Some(wgpu::BlendState { color, alpha });
                }
                targets.push(Some(wgpu::ColorTargetState { format, blend, write_mask }));
            }
            fstage = Some(fs);
        }
        let topology: wgpu::PrimitiveTopology = r.e(tables::TOPOLOGIES)?;
        let strip_index_format: Option<wgpu::IndexFormat> = r.opt(tables::INDEX_FORMATS)?;
        let front_face: wgpu::FrontFace = r.e(tables::FRONT_FACES)?;
        let cull_mode = map::cull(r.n(tables::CULL_MODES)?)?;
        let unclipped_depth = r.u()? != 0;
        let mut depth_stencil = None;
        if r.u()? == 1 {
            let format: wgpu::TextureFormat = r.e(tables::TEXTURE_FORMATS)?;
            // 0 false, 1 true, 2 absent.
            let write = r.u()?;
            let compare: Option<wgpu::CompareFunction> = r.opt(tables::COMPARE_FUNCTIONS)?;
            let face = |r: &mut Blob| -> Result<wgpu::StencilFaceState, ExecError> {
                Ok(wgpu::StencilFaceState { compare: r.e(tables::COMPARE_FUNCTIONS)?, fail_op: r.e(tables::STENCIL_OPERATIONS)?, depth_fail_op: r.e(tables::STENCIL_OPERATIONS)?, pass_op: r.e(tables::STENCIL_OPERATIONS)? })
            };
            let front = face(&mut r)?;
            let back = face(&mut r)?;
            let (read_mask, write_mask) = (r.u()?, r.u()?);
            let bias = wgpu::DepthBiasState { constant: r.u()? as i32, slope_scale: r.f()?, clamp: r.f()? };
            depth_stencil = Some(wgpu::DepthStencilState {
                format,
                depth_write_enabled: match write { 0 => Some(false), 1 => Some(true), _ => None },
                depth_compare: compare,
                stencil: wgpu::StencilState { front, back, read_mask, write_mask },
                bias,
            });
        }
        let multisample = wgpu::MultisampleState { count: r.u()?, mask: r.u()? as u64, alpha_to_coverage_enabled: r.u()? != 0 };
        Ok(RenderSpec {
            layout,
            vertex: vstage,
            buffers: bufs.into_iter().zip(attrs).map(|((stride, step), a)| (stride, step, a)).collect(),
            fragment: fstage.map(|f| (f, targets)),
            primitive: wgpu::PrimitiveState { topology, strip_index_format, front_face, cull_mode, unclipped_depth, polygon_mode: wgpu::PolygonMode::Fill, conservative: false },
            depth_stencil,
            multisample,
            cache: self.pipeline_cache.clone(),
        })
    }

    /// The compute pipeline `blob` describes (CREATE_COMPUTE_PIPELINE_WITH_LAYOUT's), ready to make.
    fn compute_spec(&self, blob: &[u8]) -> Result<ComputeSpec, ExecError> {
        let mut r = Blob { b: blob, p: 0 };
        let l = r.u()?;
        let layout = if l == 0 { None } else { Some(get(&self.pipeline_layouts, l, "pipeline layout")?.clone()) };
        let stage = Stage::read(&mut r, &self.shaders)?;
        Ok(ComputeSpec { layout, stage, cache: self.pipeline_cache.clone() })
    }

    /// The core's async pipeline creation (CoreGpuDevice.madeAsync: a validation PUSH_ERROR_SCOPE, then one
    /// CREATE_RENDER_PIPELINE or CREATE_COMPUTE_PIPELINE_WITH_LAYOUT, then the POP_ERROR_SCOPE whose ticket the creation
    /// waits on), read as a browser executor reads it: the pipeline compiles on a compile thread, in an
    /// error scope of that thread's own, and the ticket settles once it is made (`poll`). `at`: the word after the
    /// PUSH_ERROR_SCOPE. Answers the word after the run's POP_ERROR_SCOPE, or None when the commands there are not that
    /// run (the scope is then pushed as usual).
    fn made_async(&mut self, words: &[u32], at: usize, staging: &[u8]) -> Result<Option<usize>, ExecError> {
        let (Some(&op), Some(&n)) = (words.get(at), words.get(at + 1)) else { return Ok(None) };
        let render = op == op::CREATE_RENDER_PIPELINE;
        if !render && op != op::CREATE_COMPUTE_PIPELINE_WITH_LAYOUT {
            return Ok(None);
        }
        let pop = at + 2 + n as usize;
        if words.get(pop) != Some(&op::POP_ERROR_SCOPE) || words.get(pop + 1).is_none_or(|&k| k < 1) {
            return Ok(None);
        }
        let (Some(&id), Some(&off), Some(&len), Some(&ticket)) = (words.get(at + 2), words.get(at + 3), words.get(at + 4), words.get(pop + 2)) else {
            return Ok(None);
        };
        let blob = staging.get(off as usize..off as usize + len as usize).ok_or(ExecError::Truncated)?;
        self.compile(render, id, blob, Some(ticket))?;
        self.stats.commands += 2;
        Ok(Some(pop + 2 + words[pop + 1] as usize))
    }

    /// Pipeline `id` (render or compute, as `blob` describes it) compiling on a compile thread; the stream goes on
    /// meanwhile, and its first use waits for it (`settle`). With `ticket` (an async creation), the creation's
    /// validation error settles that ticket. Without (WebGPU's synchronous creation), a compile that reported any error
    /// is made again on this thread at `settle`, so the error reaches the stream's scopes as it would have.
    fn compile(&mut self, render: bool, id: u32, blob: &[u8], ticket: Option<u32>) -> Result<(), ExecError> {
        // A creation of the same handle still compiling (a reused id) is settled first: its pipeline is replaced.
        self.settle(render, id);
        let spec = if render { PipelineSpec::Render(Arc::new(self.render_spec(id, blob)?)) } else { PipelineSpec::Compute(Arc::new(self.compute_spec(blob)?)) };
        if timing::detailed() {
            let shader = |names: &Vec<String>, st: &Stage| format!("{}:{}", names.get(st.module_id as usize).map_or("?", |n| n.as_str()), st.entry);
            let (names, name) = match &spec {
                PipelineSpec::Render(r) => (
                    &mut self.render_pipeline_names,
                    match &r.fragment {
                        Some((fs, _)) => format!("fs {}", shader(&self.shader_names, fs)),
                        None => format!("vs {} (no fragment)", shader(&self.shader_names, &r.vertex)),
                    },
                ),
                PipelineSpec::Compute(c) => (&mut self.compute_pipeline_names, format!("cs {}", shader(&self.shader_names, &c.stage))),
            };
            if names.len() <= id as usize {
                names.resize(id as usize + 1, String::new());
            }
            names[id as usize] = name;
        }
        let slot = Arc::new(PipelineSlot::default());
        let (device, job_spec, job_slot) = (self.device.clone(), spec.clone(), slot.clone());
        let filters: &'static [wgpu::ErrorFilter] =
            if ticket.is_some() { &[wgpu::ErrorFilter::Validation] } else { &[wgpu::ErrorFilter::Validation, wgpu::ErrorFilter::OutOfMemory, wgpu::ErrorFilter::Internal] };
        let job: CompileJob = Box::new(move || {
            let scopes: Vec<wgpu::ErrorScopeGuard> = filters.iter().map(|f| device.push_error_scope(*f)).collect();
            let made = job_spec.make(&device);
            let mut error = None;
            for scope in scopes.into_iter().rev() {
                if let Some(e) = pollster::block_on(scope.pop()) {
                    error.get_or_insert_with(|| e.to_string());
                }
            }
            *job_slot.made.lock().unwrap_or_else(|e| e.into_inner()) = Some((made, error));
            job_slot.ready.notify_all();
        });
        self.pipelines_made += 1;
        let remake = if ticket.is_none() { Some(spec.clone()) } else { None };
        if compile_queue().lock().unwrap_or_else(|e| e.into_inner()).send(job).is_err() {
            // No compile threads: made here.
            match spec.make(&self.device) {
                MadePipeline::Render(r) => set(&mut self.render_pipelines, id, r),
                MadePipeline::Compute(c) => set(&mut self.pipelines, id, c),
            }
            if let Some(t) = ticket {
                self.link.complete(t, 0, &[]);
            }
            return Ok(());
        }
        self.pending.borrow_mut().insert((render, id), PendingPipeline { ticket, completed: false, slot, remake });
        Ok(())
    }

    /// The pipelines the compile threads have made, put in their tables.
    fn install_made(&mut self) {
        let ready: Vec<(bool, u32)> = self
            .pending
            .borrow()
            .iter()
            .filter(|(_, p)| p.slot.made.lock().unwrap_or_else(|e| e.into_inner()).is_some())
            .map(|(k, _)| *k)
            .collect();
        for (render, id) in ready {
            self.settle(render, id);
        }
    }

    /// Pipeline `id` (a render one with `render`) in its table, waiting for it while a compile thread still makes it
    /// (the page's executor makes such a one synchronously instead: `forced`), its ticket settled if `poll` had not.
    /// Nothing for a handle that is not pending.
    fn settle(&mut self, render: bool, id: u32) {
        let Some(p) = self.pending.borrow_mut().remove(&(render, id)) else { return };
        let mut made = p.slot.made.lock().unwrap_or_else(|e| e.into_inner());
        while made.is_none() {
            made = p.slot.ready.wait(made).unwrap_or_else(|e| e.into_inner());
        }
        let Some((mut pipeline, error)) = made.take() else { return };
        drop(made);
        if let (Some(ticket), false) = (p.ticket, p.completed) {
            match &error {
                None => self.link.complete(ticket, 0, &[]),
                Some(m) => self.link.complete(ticket, 1, cut(m, self.link.ticket_cap(ticket))),
            }
        }
        if let (Some(spec), Some(_)) = (&p.remake, &error) {
            pipeline = spec.make(&self.device);
        }
        match pipeline {
            MadePipeline::Render(r) => set(&mut self.render_pipelines, id, r),
            MadePipeline::Compute(c) => set(&mut self.pipelines, id, c),
        }
    }
}

fn get<'t, T>(table: &'t [Option<T>], id: u32, kind: &'static str) -> Result<&'t T, ExecError> {
    match table.get(id as usize) {
        Some(Some(v)) => Ok(v),
        _ => Err(ExecError::DeadHandle { kind, id }),
    }
}

fn set<T>(table: &mut Vec<Option<T>>, id: u32, value: T) {
    let id = id as usize;
    if table.len() <= id {
        table.resize_with(id + 1, || None);
    }
    // A reused id: the previous object (already destroyed by the core) goes.
    table[id] = Some(value);
}

fn clear<T>(table: &mut [Option<T>], id: u32) {
    if let Some(slot) = table.get_mut(id as usize) {
        *slot = None;
    }
}

impl Drop for Executor {
    fn drop(&mut self) {
        // Passes end before their encoder goes.
        self.pass = None;
        self.rpass = None;
        self.benc = None;
    }
}
