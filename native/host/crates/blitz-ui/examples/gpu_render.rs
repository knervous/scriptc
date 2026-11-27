//! Renders an HTML file through the GPU painter (gpu_paint::GpuUiPainter, Vello on this machine's own wgpu device, CSS
//! filters by gpu_filter) to a PNG over a dark ground: the native host's UI paint, headless, to compare with Chrome
//! or blitz-render (vello_cpu). BLITZ_UI_FILTERS=0 paints as before filters were drawn.
//!
//!   cargo run --release -p blitz-ui --features gpu-vello --example gpu_render -- page.html out.png [width height scale]
use std::sync::Arc;

use blitz_dom::DocumentConfig;
use blitz_html::HtmlDocument;
use blitz_net::Provider;
use blitz_traits::shell::{ColorScheme, Viewport};
use blitz_ui::gpu_paint::{GpuUiPainter, TARGET_FORMAT, TARGET_USAGE};
use vello::wgpu;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let html_path = std::path::Path::new(args.first().expect("page.html")).canonicalize().expect("page.html");
    let out = args.get(1).cloned().unwrap_or_else(|| "gpu.out.png".into());
    let width: u32 = args.get(2).and_then(|a| a.parse().ok()).unwrap_or(1280);
    let height: u32 = args.get(3).and_then(|a| a.parse().ok()).unwrap_or(720);
    let scale: f32 = args.get(4).and_then(|a| a.parse().ok()).unwrap_or(1.0);
    let (w, h) = ((width as f32 * scale) as u32, (height as f32 * scale) as u32);

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _guard = runtime.enter();
    let html = std::fs::read_to_string(&html_path).expect("read html");
    let base = url::Url::from_file_path(&html_path).unwrap().to_string();
    let net = Arc::new(Provider::new(None));
    let mut document = HtmlDocument::from_html(
        &html,
        DocumentConfig { base_url: Some(base), net_provider: Some(net.clone() as _), viewport: Some(Viewport::new(w, h, scale, ColorScheme::Dark)), ..Default::default() },
    );
    for _ in 0..2000 {
        document.resolve(0.0);
        if net.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }

    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).expect("adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
    let mut painter = GpuUiPainter::new(&device, &queue).expect("painter");
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("gpu_render target"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: TARGET_FORMAT,
        usage: TARGET_USAGE | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let doc: &mut blitz_dom::BaseDocument = document.as_mut();
    // REPEAT=<n>: n whole paints, each waited for; the first (pipelines compiled) and the median of the rest reported.
    let repeat: usize = std::env::var("REPEAT").ok().and_then(|n| n.parse().ok()).unwrap_or(1).max(1);
    let mut times = Vec::new();
    for _ in 0..repeat {
        let t = std::time::Instant::now();
        painter.paint_damage(doc, &target, scale, 1.0, true);
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        times.push(t.elapsed().as_secs_f64() * 1e3);
    }
    let paint_ms = times[0];
    if repeat > 1 {
        let mut rest = times[1..].to_vec();
        rest.sort_by(|a, b| a.total_cmp(b));
        eprintln!("paint: first {:.1} ms, then median {:.2} ms over {}", times[0], rest[rest.len() / 2], rest.len());
    }

    // Read back (rows padded to 256 bytes), straight alpha over #1b1b1b.
    let row = (w * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: u64::from(row * h), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.copy_texture_to_buffer(
        target.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) } },
        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let data = buffer.slice(..).get_mapped_range().expect("mapped");
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for px in data[(y * row) as usize..][..(w * 4) as usize].chunks(4) {
            let a = f32::from(px[3]) / 255.0;
            for c in 0..3 {
                rgba.push((f32::from(px[c]) * a + 27.0 * (1.0 - a)).round() as u8);
            }
            rgba.push(255);
        }
    }
    let file = std::fs::File::create(&out).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(&rgba).unwrap();
    println!("{{\"out\":\"{out}\",\"width\":{w},\"height\":{h},\"paintMs\":{paint_ms:.1},\"adapter\":\"{}\"}}", adapter.get_info().name);
}
