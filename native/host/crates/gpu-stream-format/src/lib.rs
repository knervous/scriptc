//! The WebGPU command stream's format: what an encoder writes and an executor reads, in one place for both sides.
//!
//! A stream is little-endian `u32` words plus a staging arena of upload bytes (4-byte aligned). Every command is
//! `[op, n, args...]`, with `n` the number of argument words, so a decoder can skip what it does not know ([`op`]).
//! Resources are integer handles the encoder gives out, one table per kind ([`KIND_BUFFER`] ...); 0 is no handle.
//! Asynchronous results (an error scope's pop, work done, a mapped read) complete into tickets, slots of a fixed
//! table ([`TICKETS`] of them) whose state goes [`TICKET_PENDING`] to [`TICKET_DONE`] or [`TICKET_FAILED`].
//! An encoder refuses misuse with a negative code ([`err`]) before anything is encoded.
//!
//! **Blobs.** Fixed-shape commands carry their arguments inline. Descriptors of variable shape travel as a *blob*:
//! little-endian u32 words copied into staging at the call, the command naming `staging_off len`. A string inside a
//! blob is `byte_len` then its UTF-8 bytes padded to whole words. Enums are indices into [`tables`]; "optional" enums
//! are 0 for absent and index + 1 otherwise. f32 values are their bit patterns. A draw list's buckets are
//! [`DRAW_LIST_BUCKET_WORDS`] words each.
//!
//! Order is the ABI: opcodes, kinds and table entries are appended, never renumbered or reordered.

#![no_std]

pub mod tables;

/// Opcodes. Every command is `[op, n, args...]` with `n` the number of
/// argument words, so a decoder can skip what it does not know.
pub mod op {
    pub const CREATE_BUFFER: u32 = 1; // id size usage
    pub const WRITE_BUFFER: u32 = 2; // id offset staging_off len
    pub const CREATE_SHADER: u32 = 3; // id staging_off len (UTF-8 WGSL)
    pub const CREATE_COMPUTE_PIPELINE: u32 = 4; // id shader staging_off len (entry point)
    pub const CREATE_BIND_GROUP: u32 = 5; // id pipeline group count, count × (binding buffer offset size)
    pub const BEGIN_COMPUTE: u32 = 6;
    pub const SET_PIPELINE: u32 = 7; // id
    pub const SET_BIND_GROUP: u32 = 8; // index id
    pub const DISPATCH: u32 = 9; // x y z
    pub const END_COMPUTE: u32 = 10;
    pub const COPY_BUFFER: u32 = 11; // src src_off dst dst_off size
    pub const SUBMIT: u32 = 12;
    pub const MAP_READ: u32 = 13; // ticket buffer offset size
    pub const WORK_DONE: u32 = 14; // ticket
    pub const PUSH_ERROR_SCOPE: u32 = 15; // filter
    pub const POP_ERROR_SCOPE: u32 = 16; // ticket
    pub const DESTROY: u32 = 17; // kind id
    // Render (gpu_render.rs). A `blob` is staging_off len: a descriptor of
    // little-endian words whose schema is on the op's encoder there.
    pub const CREATE_TEXTURE: u32 = 18; // id blob
    pub const CREATE_VIEW: u32 = 19; // id texture format dimension aspect base_mip mip_count base_layer layer_count
    pub const CREATE_SAMPLER: u32 = 20; // id u v w mag min mip lod_min lod_max compare max_anisotropy
    pub const CREATE_BIND_GROUP_LAYOUT: u32 = 21; // id blob
    pub const CREATE_PIPELINE_LAYOUT: u32 = 22; // id blob
    pub const CREATE_BIND_GROUP_WITH_LAYOUT: u32 = 23; // id blob
    pub const CREATE_RENDER_PIPELINE: u32 = 24; // id blob
    pub const BEGIN_RENDER_PASS: u32 = 25; // blob
    pub const SET_VIEWPORT: u32 = 26; // x y w h min_depth max_depth (f32 bits)
    pub const SET_SCISSOR: u32 = 27; // x y w h
    pub const SET_VERTEX_BUFFER: u32 = 28; // slot buffer offset size
    pub const SET_INDEX_BUFFER: u32 = 29; // buffer format offset size
    pub const DRAW: u32 = 30; // vertices instances first_vertex first_instance
    pub const DRAW_INDEXED: u32 = 31; // indices instances first_index base_vertex first_instance
    pub const DRAW_INDIRECT: u32 = 32; // buffer offset
    pub const DRAW_INDEXED_INDIRECT: u32 = 33; // buffer offset
    pub const END_RENDER_PASS: u32 = 34;
    pub const SET_STENCIL_REFERENCE: u32 = 35; // reference
    pub const SET_BLEND_CONSTANT: u32 = 36; // r g b a (f32 bits)
    pub const WRITE_TEXTURE: u32 = 37; // texture mip x y z aspect staging_off len bytes_per_row rows_per_image w h d
    pub const COPY_BUFFER_TO_TEXTURE: u32 = 38; // buffer offset bytes_per_row rows_per_image texture mip x y z aspect w h d
    pub const COPY_TEXTURE_TO_BUFFER: u32 = 39; // texture mip x y z aspect buffer offset bytes_per_row rows_per_image w h d
    pub const COPY_TEXTURE_TO_TEXTURE: u32 = 40; // src mip x y z aspect dst mip x y z aspect w h d
    pub const CONFIGURE_SURFACE: u32 = 41; // blob
    pub const ACQUIRE_SURFACE_TEXTURE: u32 = 42; // id (a texture handle for this frame's surface texture)
    pub const PRESENT: u32 = 43;
    pub const SET_BIND_GROUP_DYNAMIC: u32 = 44; // index group count offsets...
    pub const CREATE_COMPUTE_PIPELINE_WITH_LAYOUT: u32 = 45; // id blob
    pub const GET_BIND_GROUP_LAYOUT: u32 = 46; // id pipeline_kind(2 compute, 9 render) pipeline index
    // Render bundles: a bundle's commands arrive as one run, CREATE_RENDER_BUNDLE_ENCODER .. FINISH_RENDER_BUNDLE,
    // and the render commands between them record into it (a pass may be open around the run).
    pub const CREATE_RENDER_BUNDLE_ENCODER: u32 = 47; // id blob (color count, formats, depth format+1, samples, depth ro, stencil ro)
    pub const FINISH_RENDER_BUNDLE: u32 = 48;
    pub const EXECUTE_BUNDLES: u32 = 49; // count ids...
    // Draw lists (gpu_render.rs `set_draw_list`): buckets of indexed-indirect rows, each bucket one multi-draw natively
    // (gpu-stream-wgpu draw_list.rs), a bundle of drawIndexedIndirect per row on the web.
    pub const CREATE_DRAW_LIST: u32 = 50; // id
    pub const SET_DRAW_LIST: u32 = 51; // id bucket_count staging_off len (DRAW_LIST_BUCKET_WORDS words per bucket)
    pub const DRAW_LIST: u32 = 52; // id (in a render pass, not a bundle)
}

/// Handle kinds (the executor keeps one table per kind).
pub const KIND_BUFFER: u32 = 0;
pub const KIND_SHADER: u32 = 1;
pub const KIND_PIPELINE: u32 = 2;
pub const KIND_BIND_GROUP: u32 = 3;
pub const KIND_TEXTURE: u32 = 4;
pub const KIND_VIEW: u32 = 5;
pub const KIND_SAMPLER: u32 = 6;
pub const KIND_BIND_GROUP_LAYOUT: u32 = 7;
pub const KIND_PIPELINE_LAYOUT: u32 = 8;
pub const KIND_RENDER_PIPELINE: u32 = 9;
pub const KIND_RENDER_BUNDLE: u32 = 10;
pub const KIND_DRAW_LIST: u32 = 11;
/// The number of handle kinds.
pub const KINDS: usize = 12;

/// Ticket states.
pub const TICKET_FREE: u32 = 0;
pub const TICKET_PENDING: u32 = 1;
pub const TICKET_DONE: u32 = 2;
pub const TICKET_FAILED: u32 = 3;
pub const TICKETS: usize = 256;
/// Bytes an error scope's message may use.
pub const MESSAGE_BYTES: usize = 256;

/// Limits the executor fills at init, by index (`gpu_limit`).
pub mod limit {
    pub const MAX_BUFFER_SIZE: usize = 0;
    pub const MAX_STORAGE_BUFFER_BINDING_SIZE: usize = 1;
    pub const MAX_STORAGE_BUFFERS_PER_SHADER_STAGE: usize = 2;
    pub const MAX_COMPUTE_WORKGROUP_SIZE_X: usize = 3;
    pub const MAX_COMPUTE_WORKGROUPS_PER_DIMENSION: usize = 4;
    pub const MAX_UNIFORM_BUFFER_BINDING_SIZE: usize = 5;
    /// The limit and feature slots (tables::LIMITS then ::FEATURES).
    pub const COUNT: usize = 64;
}

/// Refusal codes (negative results).
pub mod err {
    pub const DEAD_HANDLE: i32 = -1;
    pub const UNALIGNED: i32 = -2;
    pub const OUT_OF_RANGE: i32 = -3;
    pub const BAD_STATE: i32 = -4;
    pub const BAD_UTF8: i32 = -5;
    pub const NO_TICKET: i32 = -6;
    pub const BAD_ARGUMENT: i32 = -7;
    pub const LOST: i32 = -8;
}

/// A draw-list bucket's words (op::SET_DRAW_LIST): [0] render pipeline, [1] bind group count (<= 4), [2..6] the groups
/// by index (0: none), [6] vertex buffer count (<= 8), [7..23] per slot (buffer, byte offset), [23] index buffer, [24]
/// its byte offset, [25] index format (0 uint16, 1 uint32), [26] args buffer, [27] the first row's byte offset, [28]
/// rows, [29] count buffer (0: none), [30] its byte offset, [31] flags (0). Rows are 20-byte indexed-indirect args;
/// rows past the count carry instanceCount 0 (the web draws every row).
pub const DRAW_LIST_BUCKET_WORDS: usize = 32;
