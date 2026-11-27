//! The stream's enum tables: a WebGPU enum crosses the stream as its index in one of these. An encoder writes indices;
//! an executor maps them back by name. [`tables_json`] renders them, so each side can check its copy against these.
//! Order is the ABI: append only, never reorder.

extern crate alloc;
use alloc::format;
use alloc::string::String;

/// GPUTextureFormat.
pub const TEXTURE_FORMATS: &[&str] = &[
    "r8unorm", "r8snorm", "r8uint", "r8sint",
    "r16uint", "r16sint", "r16float",
    "rg8unorm", "rg8snorm", "rg8uint", "rg8sint",
    "r32uint", "r32sint", "r32float",
    "rg16uint", "rg16sint", "rg16float",
    "rgba8unorm", "rgba8unorm-srgb", "rgba8snorm", "rgba8uint", "rgba8sint",
    "bgra8unorm", "bgra8unorm-srgb",
    "rgb9e5ufloat", "rgb10a2uint", "rgb10a2unorm", "rg11b10ufloat",
    "rg32uint", "rg32sint", "rg32float",
    "rgba16uint", "rgba16sint", "rgba16float",
    "rgba32uint", "rgba32sint", "rgba32float",
    "stencil8", "depth16unorm", "depth24plus", "depth24plus-stencil8", "depth32float", "depth32float-stencil8",
    "bc1-rgba-unorm", "bc1-rgba-unorm-srgb", "bc2-rgba-unorm", "bc2-rgba-unorm-srgb", "bc3-rgba-unorm", "bc3-rgba-unorm-srgb",
    "bc4-r-unorm", "bc4-r-snorm", "bc5-rg-unorm", "bc5-rg-snorm", "bc6h-rgb-ufloat", "bc6h-rgb-float", "bc7-rgba-unorm", "bc7-rgba-unorm-srgb",
    "etc2-rgb8unorm", "etc2-rgb8unorm-srgb", "etc2-rgb8a1unorm", "etc2-rgb8a1unorm-srgb", "etc2-rgba8unorm", "etc2-rgba8unorm-srgb",
    "eac-r11unorm", "eac-r11snorm", "eac-rg11unorm", "eac-rg11snorm",
    "astc-4x4-unorm", "astc-4x4-unorm-srgb", "astc-5x4-unorm", "astc-5x4-unorm-srgb", "astc-5x5-unorm", "astc-5x5-unorm-srgb",
    "astc-6x5-unorm", "astc-6x5-unorm-srgb", "astc-6x6-unorm", "astc-6x6-unorm-srgb", "astc-8x5-unorm", "astc-8x5-unorm-srgb",
    "astc-8x6-unorm", "astc-8x6-unorm-srgb", "astc-8x8-unorm", "astc-8x8-unorm-srgb", "astc-10x5-unorm", "astc-10x5-unorm-srgb",
    "astc-10x6-unorm", "astc-10x6-unorm-srgb", "astc-10x8-unorm", "astc-10x8-unorm-srgb", "astc-10x10-unorm", "astc-10x10-unorm-srgb",
    "astc-12x10-unorm", "astc-12x10-unorm-srgb", "astc-12x12-unorm", "astc-12x12-unorm-srgb",
    "r16unorm", "rg16unorm", "rgba16unorm", "r16snorm", "rg16snorm", "rgba16snorm",
];
/// GPUVertexFormat.
pub const VERTEX_FORMATS: &[&str] = &[
    "uint8", "uint8x2", "uint8x4", "sint8", "sint8x2", "sint8x4", "unorm8", "unorm8x2", "unorm8x4", "snorm8", "snorm8x2", "snorm8x4",
    "uint16", "uint16x2", "uint16x4", "sint16", "sint16x2", "sint16x4", "unorm16", "unorm16x2", "unorm16x4", "snorm16", "snorm16x2", "snorm16x4",
    "float16", "float16x2", "float16x4", "float32", "float32x2", "float32x3", "float32x4",
    "uint32", "uint32x2", "uint32x3", "uint32x4", "sint32", "sint32x2", "sint32x3", "sint32x4",
    "unorm10-10-10-2", "unorm8x4-bgra",
];
pub const TEXTURE_DIMENSIONS: &[&str] = &["1d", "2d", "3d"];
pub const VIEW_DIMENSIONS: &[&str] = &["1d", "2d", "2d-array", "cube", "cube-array", "3d"];
pub const ASPECTS: &[&str] = &["all", "stencil-only", "depth-only"];
pub const ADDRESS_MODES: &[&str] = &["clamp-to-edge", "repeat", "mirror-repeat"];
pub const FILTER_MODES: &[&str] = &["nearest", "linear"];
pub const COMPARE_FUNCTIONS: &[&str] = &["never", "less", "equal", "less-equal", "greater", "not-equal", "greater-equal", "always"];
pub const BUFFER_BINDING_TYPES: &[&str] = &["uniform", "storage", "read-only-storage"];
pub const SAMPLER_BINDING_TYPES: &[&str] = &["filtering", "non-filtering", "comparison"];
pub const SAMPLE_TYPES: &[&str] = &["float", "unfilterable-float", "depth", "sint", "uint"];
pub const STORAGE_ACCESS: &[&str] = &["write-only", "read-only", "read-write"];
pub const STEP_MODES: &[&str] = &["vertex", "instance"];
pub const TOPOLOGIES: &[&str] = &["point-list", "line-list", "line-strip", "triangle-list", "triangle-strip"];
pub const INDEX_FORMATS: &[&str] = &["uint16", "uint32"];
pub const FRONT_FACES: &[&str] = &["ccw", "cw"];
pub const CULL_MODES: &[&str] = &["none", "front", "back"];
pub const BLEND_FACTORS: &[&str] = &[
    "zero", "one", "src", "one-minus-src", "src-alpha", "one-minus-src-alpha", "dst", "one-minus-dst", "dst-alpha", "one-minus-dst-alpha",
    "src-alpha-saturated", "constant", "one-minus-constant", "src1", "one-minus-src1", "src1-alpha", "one-minus-src1-alpha",
];
pub const BLEND_OPERATIONS: &[&str] = &["add", "subtract", "reverse-subtract", "min", "max"];
pub const STENCIL_OPERATIONS: &[&str] = &["keep", "zero", "replace", "invert", "increment-clamp", "decrement-clamp", "increment-wrap", "decrement-wrap"];
pub const LOAD_OPS: &[&str] = &["load", "clear"];
pub const STORE_OPS: &[&str] = &["store", "discard"];
pub const ALPHA_MODES: &[&str] = &["opaque", "premultiplied"];
/// GPUSupportedLimits names the executor reads into the encoder's limits table
/// (`gpu_limit(i)`), after which come the features (`gpu_limit(LIMITS.len() + i)`
/// is 1 when the device has `FEATURES[i]`). The first six are gpu.rs `limit::*`.
pub const LIMITS: &[&str] = &[
    "maxBufferSize", "maxStorageBufferBindingSize", "maxStorageBuffersPerShaderStage", "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupsPerDimension", "maxUniformBufferBindingSize",
    "maxTextureDimension1D", "maxTextureDimension2D", "maxTextureDimension3D", "maxTextureArrayLayers",
    "maxBindGroups", "maxBindingsPerBindGroup", "maxDynamicUniformBuffersPerPipelineLayout", "maxDynamicStorageBuffersPerPipelineLayout",
    "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxStorageTexturesPerShaderStage", "maxUniformBuffersPerShaderStage",
    "minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment", "maxVertexBuffers", "maxVertexAttributes", "maxVertexBufferArrayStride",
    "maxInterStageShaderVariables", "maxColorAttachments", "maxColorAttachmentBytesPerSample", "maxComputeWorkgroupStorageSize",
    "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ",
];
/// GPUFeatureName.
pub const FEATURES: &[&str] = &[
    "depth-clip-control", "depth32float-stencil8", "texture-compression-bc", "texture-compression-bc-sliced-3d", "texture-compression-etc2",
    "texture-compression-astc", "texture-compression-astc-sliced-3d", "timestamp-query", "indirect-first-instance", "shader-f16",
    "rg11b10ufloat-renderable", "bgra8unorm-storage", "float32-filterable", "float32-blendable", "clip-distances", "dual-source-blending",
    "subgroups", "texture-formats-tier1", "texture-formats-tier2", "primitive-index",
];

/// Every table by name, in a fixed order (the JSON the executors check against).
pub const TABLES: &[(&str, &[&str])] = &[
    ("textureFormat", TEXTURE_FORMATS),
    ("vertexFormat", VERTEX_FORMATS),
    ("textureDimension", TEXTURE_DIMENSIONS),
    ("viewDimension", VIEW_DIMENSIONS),
    ("aspect", ASPECTS),
    ("addressMode", ADDRESS_MODES),
    ("filterMode", FILTER_MODES),
    ("compareFunction", COMPARE_FUNCTIONS),
    ("bufferBindingType", BUFFER_BINDING_TYPES),
    ("samplerBindingType", SAMPLER_BINDING_TYPES),
    ("sampleType", SAMPLE_TYPES),
    ("storageAccess", STORAGE_ACCESS),
    ("stepMode", STEP_MODES),
    ("topology", TOPOLOGIES),
    ("indexFormat", INDEX_FORMATS),
    ("frontFace", FRONT_FACES),
    ("cullMode", CULL_MODES),
    ("blendFactor", BLEND_FACTORS),
    ("blendOperation", BLEND_OPERATIONS),
    ("stencilOperation", STENCIL_OPERATIONS),
    ("loadOp", LOAD_OPS),
    ("storeOp", STORE_OPS),
    ("alphaMode", ALPHA_MODES),
    ("limit", LIMITS),
    ("feature", FEATURES),
];

/// The tables as JSON: `{"textureFormat":["r8unorm",...],...}`.
pub fn tables_json() -> String {
    let mut out = String::from("{");
    for (i, (name, values)) in TABLES.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("\"{name}\":["));
        for (j, v) in values.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push_str(&format!("\"{v}\""));
        }
        out.push(']');
    }
    out.push('}');
    out
}

/// Index of `name` in `table`, if present.
pub fn index_of(table: &[&str], name: &str) -> Option<u32> {
    table.iter().position(|v| *v == name).map(|i| i as u32)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

    #[test]
    fn tables_have_no_duplicates() {
        for (name, values) in TABLES {
            let mut seen = std::collections::HashSet::new();
            for v in *values {
                assert!(seen.insert(v), "{name}: {v} twice");
            }
        }
    }

    #[test]
    fn json_round_trips_the_first_entries() {
        let j = tables_json();
        assert!(j.starts_with("{\"textureFormat\":[\"r8unorm\",\"r8snorm\""));
        assert!(j.contains("\"alphaMode\":[\"opaque\",\"premultiplied\"]"));
    }
}
