//! The stream's enum tables by name, in ABI order (gpu-stream-format's): an entry's index is what the stream carries.
//! The executor maps a name to its wgpu value through wgpu-types' WebGPU-name deserializer (`crate::parse`).

pub use gpu_stream_format::tables::*;
