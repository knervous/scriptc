//! wgpu's CPU cost per draw on this machine, by what the draw sets (a busy scene's frame: ~185 draws, ~5 vertex buffers
//! and ~1 bind group each, mostly indexed-indirect). Records one render pass of N draws and times recording, the
//! encoder's finish (wgpu encodes the pass there) and the queue's submit.
//!
//! `cargo run --release --example drawcost`; WGPU_VALIDATION_INDIRECT_CALL=0 to see indirect validation's share.

use std::time::Instant;

use gpu_stream_wgpu::wgpu;
use wgpu::util::DeviceExt;

const SHADER: &str = r#"
struct U { m: vec4<f32> }
@group(0) @binding(0) var<uniform> u: U;
struct In { @location(0) a: vec4<f32>, @location(1) b: vec4<f32>, @location(2) c: vec4<f32>, @location(3) d: vec4<f32>, @location(4) e: vec4<f32> }
@vertex fn vs(i: In) -> @builtin(position) vec4<f32> { return i.a + i.b + i.c + i.d + i.e + u.m; }
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
"#;

fn main() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).unwrap();
    let (features, limits) = gpu_stream_wgpu::web_device_asks(&adapter);
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: features, required_limits: limits, ..Default::default() })).unwrap();
    eprintln!("drawcost: {} ({:?}) flags {:?}", adapter.get_info().name, adapter.get_info().backend, wgpu::InstanceDescriptor::new_without_display_handle_from_env().flags);
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
        entries: &[wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::VERTEX, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None }],
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { bind_group_layouts: &[Some(&bgl)], ..Default::default() });
    let attrs: Vec<[wgpu::VertexAttribute; 1]> = (0..5).map(|k| [wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: k }]).collect();
    let vbl: Vec<Option<wgpu::VertexBufferLayout>> = attrs.iter().map(|a| Some(wgpu::VertexBufferLayout { array_stride: 16, step_mode: wgpu::VertexStepMode::Vertex, attributes: a })).collect();
    let pipelines: Vec<wgpu::RenderPipeline> = (0..8)
        .map(|k| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: None,
                layout: Some(&layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &vbl },
                primitive: wgpu::PrimitiveState { cull_mode: if k % 2 == 0 { None } else { Some(wgpu::Face::Back) }, ..Default::default() },
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::Rgba8Unorm, blend: None, write_mask: wgpu::ColorWrites::ALL })] }),
                multiview_mask: None,
                cache: None,
            })
        })
        .collect();
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: None, size: wgpu::Extent3d { width: 256, height: 256, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1,
        dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8Unorm, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[],
    });
    let view = target.create_view(&Default::default());
    // A distinct buffer per draw and slot (a scene's meshes each have their own).
    let n_draws = 200usize;
    let vb: Vec<wgpu::Buffer> = (0..n_draws * 5).map(|_| device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 3 * 16, usage: wgpu::BufferUsages::VERTEX, mapped_at_creation: false })).collect();
    let ib: Vec<wgpu::Buffer> = (0..n_draws).map(|_| device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 16, usage: wgpu::BufferUsages::INDEX, mapped_at_creation: false })).collect();
    let indirect = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &[0u8; 20 * 256], usage: wgpu::BufferUsages::INDIRECT });
    let groups: Vec<wgpu::BindGroup> = (0..n_draws)
        .map(|_| {
            let u = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 256, usage: wgpu::BufferUsages::UNIFORM, mapped_at_creation: false });
            device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &bgl, entries: &[wgpu::BindGroupEntry { binding: 0, resource: u.as_entire_binding() }] })
        })
        .collect();

    // The scene's way: draws recorded once into render bundles, the bundles executed every frame (28 bundles holding
    // 1125 draws a frame in the recording).
    for indirect_draw in [true, false] {
        let bundle = {
            let mut b = device.create_render_bundle_encoder(&wgpu::RenderBundleEncoderDescriptor {
                label: None, color_formats: &[Some(wgpu::TextureFormat::Rgba8Unorm)], depth_stencil: None, sample_count: 1, multiview: None,
            });
            for d in 0..n_draws {
                b.set_pipeline(&pipelines[d % pipelines.len()]);
                b.set_bind_group(0, &groups[d], &[]);
                for k in 0..5 {
                    b.set_vertex_buffer(k as u32, vb[d * 5 + k].slice(..));
                }
                b.set_index_buffer(ib[d].slice(..), wgpu::IndexFormat::Uint16);
                if indirect_draw {
                    b.draw_indexed_indirect(&indirect, (d as u64 % 256) * 20);
                } else {
                    b.draw_indexed(0..3, 0, 0..1);
                }
            }
            b.finish(&wgpu::RenderBundleDescriptor { label: None })
        };
        let reps = 5;
        let mut times = Vec::new();
        for _ in 0..60 {
            let t0 = Instant::now();
            let mut enc = device.create_command_encoder(&Default::default());
            {
                let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store } })],
                    ..Default::default()
                });
                pass.execute_bundles(std::iter::repeat_n(&bundle, reps));
            }
            let cb = enc.finish();
            queue.submit([cb]);
            times.push(t0.elapsed().as_secs_f64() * 1e3);
            let _ = device.poll(wgpu::PollType::wait_indefinitely());
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let t = times[times.len() / 2];
        println!("bundle of {n_draws} draws ({}), executed {reps}x: {t:.3} ms = {:.2} us/draw", if indirect_draw { "indexed-indirect" } else { "indexed" }, t * 1e3 / (n_draws * reps) as f64);
    }

    for (name, indirect_draw, vbs, group_each, pipe_each) in [
        ("indexed-indirect, 5 vb, group+pipeline each", true, 5usize, true, true),
        ("indexed-indirect, 5 vb, group each", true, 5, true, false),
        ("indexed (direct), 5 vb, group+pipeline each", false, 5, true, true),
        ("indexed (direct), 5 vb, group each", false, 5, true, false),
    ] {
        let (mut rec, mut fin, mut sub) = (Vec::new(), Vec::new(), Vec::new());
        for _ in 0..60 {
            let t0 = Instant::now();
            let mut enc = device.create_command_encoder(&Default::default());
            {
                let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store } })],
                    ..Default::default()
                });
                pass.set_pipeline(&pipelines[0]);
                pass.set_bind_group(0, &groups[0], &[]);
                for k in 0..vbs as u32 {
                    pass.set_vertex_buffer(k, vb[k as usize].slice(..));
                }
                for d in 0..n_draws {
                    if pipe_each {
                        pass.set_pipeline(&pipelines[d % pipelines.len()]);
                    }
                    if group_each {
                        pass.set_bind_group(0, &groups[d], &[]);
                    }
                    if vbs > 1 || group_each {
                        for k in 0..vbs {
                            pass.set_vertex_buffer(k as u32, vb[d * 5 + k].slice(..));
                        }
                        pass.set_index_buffer(ib[d].slice(..), wgpu::IndexFormat::Uint16);
                    } else if d == 0 {
                        pass.set_index_buffer(ib[0].slice(..), wgpu::IndexFormat::Uint16);
                    }
                    if indirect_draw {
                        pass.draw_indexed_indirect(&indirect, (d as u64 % 256) * 20);
                    } else {
                        pass.draw_indexed(0..3, 0, 0..1);
                    }
                }
            }
            let t1 = Instant::now();
            let cb = enc.finish();
            let t2 = Instant::now();
            queue.submit([cb]);
            let t3 = Instant::now();
            let _ = device.poll(wgpu::PollType::wait_indefinitely());
            rec.push((t1 - t0).as_secs_f64() * 1e3);
            fin.push((t2 - t1).as_secs_f64() * 1e3);
            sub.push((t3 - t2).as_secs_f64() * 1e3);
        }
        let med = |v: &mut Vec<f64>| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v[v.len() / 2]
        };
        let (r, f, s) = (med(&mut rec), med(&mut fin), med(&mut sub));
        println!("{name:<48} {n_draws} draws: record {r:.3} ms, finish {f:.3} ms, submit {s:.3} ms = {:.2} us/draw", (r + f + s) * 1e3 / n_draws as f64);
    }
}
