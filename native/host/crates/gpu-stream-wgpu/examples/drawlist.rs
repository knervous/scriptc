//! DRAW_LIST against today's bundle replay, through the executor's own ops (so the executor's DRAW_LIST is what runs):
//! one render pass of R rows a frame, timed from the stream's execute to its submit (wgpu encodes the pass at the
//! SUBMIT's finish), medians of interleaved frames.
//!
//! - `bundle, per-draw state`: today's shape. A bundle replays, per row, its mesh's bind group, five vertex buffers, an
//!   index buffer and a drawIndexedIndirect; the pipeline set per bucket.
//! - `bundle, per-bucket state`: pooled geometry and shared groups (the shared S2 step, and the web's DRAW_LIST
//!   backend): state once per bucket, then one drawIndexedIndirect per row.
//! - `DRAW_LIST`: the native backend, one multi_draw_indexed_indirect_count per bucket in the pass.
//!
//! `cargo run --release --example drawlist [rows]`; WGPU_VALIDATION_INDIRECT_CALL=0 for indirect validation's share.


use std::time::Instant;

use gpu_stream_wgpu::{Executor, TicketTable, op, tables, wgpu};
use wgpu::util::DeviceExt;

const SHADER: &str = r#"
struct U { m: vec4<f32> }
@group(0) @binding(0) var<uniform> u: U;
struct In { @location(0) a: vec4<f32>, @location(1) b: vec4<f32>, @location(2) c: vec4<f32>, @location(3) d: vec4<f32>, @location(4) e: vec4<f32>, @location(5) record: u32 }
@vertex fn vs(i: In) -> @builtin(position) vec4<f32> { return (i.a + i.b + i.c + i.d + i.e + u.m) * 0.001 + vec4<f32>(f32(i.record) * 1e-9, 0.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
"#;

/// A stream being written: words and staging bytes.
#[derive(Default)]
struct Stream {
    words: Vec<u32>,
    staging: Vec<u8>,
}

impl Stream {
    fn cmd(&mut self, op: u32, args: &[u32]) {
        self.words.push(op);
        self.words.push(args.len() as u32);
        self.words.extend_from_slice(args);
    }
    /// Bytes into staging: (offset, length).
    fn bytes(&mut self, b: &[u8]) -> (u32, u32) {
        let at = self.staging.len() as u32;
        self.staging.extend_from_slice(b);
        while self.staging.len() % 4 != 0 {
            self.staging.push(0);
        }
        (at, b.len() as u32)
    }
}

fn le(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

fn main() {
    let rows: usize = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(2500);
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).unwrap();
    let (mut features, limits) = gpu_stream_wgpu::web_device_asks(&adapter);
    features |= adapter.features() & wgpu::Features::MULTI_DRAW_INDIRECT_COUNT;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: features, required_limits: limits, ..Default::default() })).unwrap();
    eprintln!(
        "drawlist: {} ({:?}), MDI-count {}, flags {:?}",
        adapter.get_info().name,
        adapter.get_info().backend,
        device.features().contains(wgpu::Features::MULTI_DRAW_INDIRECT_COUNT),
        wgpu::InstanceDescriptor::new_without_display_handle_from_env().flags
    );
    let link = TicketTable::new();
    let mut exec = Executor::from_device(device.clone(), queue.clone(), link);

    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
        entries: &[wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::VERTEX, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None }],
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { bind_group_layouts: &[Some(&bgl)], ..Default::default() });
    let attrs: Vec<[wgpu::VertexAttribute; 1]> = (0..5).map(|k| [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: k }]).collect();
    let record = [wgpu::VertexAttribute { format: wgpu::VertexFormat::Uint32, offset: 0, shader_location: 5 }];
    let mut vbl: Vec<Option<wgpu::VertexBufferLayout>> = attrs.iter().map(|a| Some(wgpu::VertexBufferLayout { array_stride: 16, step_mode: wgpu::VertexStepMode::Vertex, attributes: a })).collect();
    vbl.push(Some(wgpu::VertexBufferLayout { array_stride: 4, step_mode: wgpu::VertexStepMode::Instance, attributes: &record }));
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let n_pipelines = 8usize;
    // Stream ids: pipelines 1.., groups 1.., buffers 1.., view 1, bundles 1.., lists 1...
    for k in 0..n_pipelines {
        let p = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &vbl },
            primitive: wgpu::PrimitiveState { cull_mode: if k % 2 == 0 { None } else { Some(wgpu::Face::Back) }, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })] }),
            multiview_mask: None,
            cache: None,
        });
        exec.adopt_render_pipeline(1 + k as u32, p);
    }
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: None, size: wgpu::Extent3d { width: 256, height: 256, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1,
        dimension: wgpu::TextureDimension::D2, format, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[],
    });
    exec.adopt_view(1, target.create_view(&Default::default()));
    // One group per row (today: a mesh's own), buffers per row (5 vertex + index), and the shared ones.
    let mut next_buffer = 1u32;
    let mut buffer = |exec: &mut Executor, b: wgpu::Buffer| {
        let id = next_buffer;
        next_buffer += 1;
        exec.adopt_buffer(id, b);
        id
    };
    let groups: Vec<u32> = (0..rows)
        .map(|r| {
            let u = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 256, usage: wgpu::BufferUsages::UNIFORM, mapped_at_creation: false });
            exec.adopt_group(1 + r as u32, device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &bgl, entries: &[wgpu::BindGroupEntry { binding: 0, resource: u.as_entire_binding() }] }));
            1 + r as u32
        })
        .collect();
    let row_vb: Vec<[u32; 5]> = (0..rows).map(|_| std::array::from_fn(|_| buffer(&mut exec, device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 3 * 16, usage: wgpu::BufferUsages::VERTEX, mapped_at_creation: false })))).collect();
    let indices: [u16; 4] = [0, 1, 2, 0];
    let index_bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let row_ib: Vec<u32> = (0..rows).map(|_| buffer(&mut exec, device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &index_bytes, usage: wgpu::BufferUsages::INDEX }))).collect();
    let arena_vb: [u32; 5] = std::array::from_fn(|_| buffer(&mut exec, device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 3 * 16, usage: wgpu::BufferUsages::VERTEX, mapped_at_creation: false })));
    let arena_ib = buffer(&mut exec, device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &index_bytes, usage: wgpu::BufferUsages::INDEX }));
    let iota: Vec<u8> = (0..rows as u32).flat_map(|i| i.to_le_bytes()).collect();
    let iota_vb = buffer(&mut exec, device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &iota, usage: wgpu::BufferUsages::VERTEX }));
    // Rows: 3 indices, 1 instance, firstInstance = the row's record.
    let args: Vec<u32> = (0..rows as u32).flat_map(|r| [3, 1, 0, 0, r]).collect();
    let args_id = buffer(&mut exec, device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &le(&args), usage: wgpu::BufferUsages::INDIRECT }));
    let fmt_index = tables::TEXTURE_FORMATS.iter().position(|f| *f == "rgba8unorm").unwrap() as u32;

    let mut results: Vec<(String, Vec<f64>)> = Vec::new();
    let mut frames: Vec<(String, Stream)> = Vec::new();
    let mut setup = Stream::default();
    let pass_blob = le(&[1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    let mut next_bundle = 1u32;
    let mut next_list = 1u32;
    for buckets in [rows, 600, 128, 32] {
        if buckets > rows {
            continue;
        }
        let per = rows.div_ceil(buckets);
        // Whole buckets of `per` rows (the last may be short).
        let buckets = rows.div_ceil(per);
        let bucket_of = |r: usize| r / per;
        let pipeline_of = |b: usize| 1 + (b % n_pipelines) as u32;
        // Today's bundle: per-row group, buffers and draw; the pipeline when the bucket changes.
        for per_row_state in [true, false] {
            // Per-row state does not depend on the bucketing past the pipeline: measured once.
            if per_row_state && buckets != rows {
                continue;
            }
            let (fo, fl) = setup.bytes(&le(&[1, fmt_index, 0, 1, 0, 0]));
            let id = next_bundle;
            next_bundle += 1;
            setup.cmd(op::CREATE_RENDER_BUNDLE_ENCODER, &[id, fo, fl]);
            for r in 0..rows {
                let b = bucket_of(r);
                let first = r == 0 || bucket_of(r - 1) != b;
                if first {
                    setup.cmd(op::SET_PIPELINE, &[pipeline_of(b)]);
                }
                if per_row_state || first {
                    let (group, vbs, ib) = if per_row_state { (groups[r], row_vb[r], row_ib[r]) } else { (groups[b], arena_vb, arena_ib) };
                    setup.cmd(op::SET_BIND_GROUP, &[0, group]);
                    for (k, vb) in vbs.iter().enumerate() {
                        setup.cmd(op::SET_VERTEX_BUFFER, &[k as u32, *vb, 0, 0]);
                    }
                    setup.cmd(op::SET_VERTEX_BUFFER, &[5, iota_vb, 0, 0]);
                    setup.cmd(op::SET_INDEX_BUFFER, &[ib, 0, 0, 0]);
                }
                setup.cmd(op::DRAW_INDEXED_INDIRECT, &[args_id, (r * 20) as u32]);
            }
            setup.cmd(op::FINISH_RENDER_BUNDLE, &[]);
            let mut f = Stream::default();
            let (po, pl) = f.bytes(&pass_blob);
            f.cmd(op::BEGIN_RENDER_PASS, &[po, pl]);
            f.cmd(op::EXECUTE_BUNDLES, &[1, id]);
            f.cmd(op::END_RENDER_PASS, &[]);
            f.cmd(op::SUBMIT, &[]);
            frames.push((format!("bundle, {} state, {buckets} buckets", if per_row_state { "per-draw" } else { "per-bucket" }), f));
        }
        // DRAW_LIST: per bucket its state and rows; counts in a buffer of their own.
        let counts: Vec<u32> = (0..buckets).map(|b| (rows.min((b + 1) * per) - b * per) as u32).collect();
        let count_id = buffer(&mut exec, device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &le(&counts), usage: wgpu::BufferUsages::INDIRECT }));
        let mut words = Vec::new();
        for b in 0..buckets {
            let mut w = [0u32; gpu_stream_wgpu::draw_list::BUCKET_WORDS];
            w[0] = pipeline_of(b);
            w[1] = 1;
            w[2] = groups[b];
            w[6] = 6;
            for k in 0..5 {
                w[7 + 2 * k] = arena_vb[k];
            }
            w[7 + 2 * 5] = iota_vb;
            w[23] = arena_ib;
            w[25] = 0;
            w[26] = args_id;
            w[27] = (b * per * 20) as u32;
            w[28] = counts[b];
            w[29] = count_id;
            w[30] = (b * 4) as u32;
            words.extend_from_slice(&w);
        }
        let list = next_list;
        next_list += 1;
        let (lo, ll) = setup.bytes(&le(&words));
        setup.cmd(op::CREATE_DRAW_LIST, &[list]);
        setup.cmd(op::SET_DRAW_LIST, &[list, buckets as u32, lo, ll]);
        let mut f = Stream::default();
        let (po, pl) = f.bytes(&pass_blob);
        f.cmd(op::BEGIN_RENDER_PASS, &[po, pl]);
        f.cmd(op::DRAW_LIST, &[list]);
        f.cmd(op::END_RENDER_PASS, &[]);
        f.cmd(op::SUBMIT, &[]);
        frames.push((format!("DRAW_LIST, {buckets} buckets"), f));
    }
    exec.execute(&setup.words, &setup.staging).expect("setup");
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    for (name, _) in &frames {
        results.push((name.clone(), Vec::new()));
    }
    // Interleaved: every method once per round.
    for round in 0..120 {
        for (k, (_, f)) in frames.iter().enumerate() {
            let t0 = Instant::now();
            exec.execute(&f.words, &f.staging).unwrap_or_else(|e| panic!("{}: {e}", frames[k].0));
            let ms = t0.elapsed().as_secs_f64() * 1e3;
            let _ = device.poll(wgpu::PollType::wait_indefinitely());
            if round >= 20 {
                results[k].1.push(ms);
            }
        }
    }
    for (name, mut v) in results {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let (p50, p95) = (v[v.len() / 2], v[v.len() * 95 / 100]);
        println!("{name:<44} {rows} rows: execute+finish+submit p50 {p50:.3} ms p95 {p95:.3} ms = {:.2} us/row", p50 * 1e3 / rows as f64);
    }
}
