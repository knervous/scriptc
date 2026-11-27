//! The executor driven by a stream this test writes itself, by the format alone (gpu-stream-format): no other encoder.
//! The device tests need a GPU adapter (any wgpu backend, a software one included); without one they say so and pass.

use std::sync::Arc;
use std::time::Duration;

use gpu_stream_wgpu::format::{KIND_BUFFER, op, tables};
use gpu_stream_wgpu::{Executor, TICKET_DONE, TICKET_FAILED, TicketTable};

const MAP_READ: u32 = 0x1;
const COPY_SRC: u32 = 0x4;
const COPY_DST: u32 = 0x8;
const STORAGE: u32 = 0x80;

/// A stream being written: its words, its staging bytes (4-byte aligned pieces) and the next handle and ticket.
#[derive(Default)]
struct Stream {
    words: Vec<u32>,
    staging: Vec<u8>,
    next_id: u32,
    next_ticket: u32,
}

impl Stream {
    fn cmd(&mut self, op: u32, args: &[u32]) {
        self.words.push(op);
        self.words.push(args.len() as u32);
        self.words.extend_from_slice(args);
    }
    /// `bytes` into staging: (offset, len).
    fn stage(&mut self, bytes: &[u8]) -> (u32, u32) {
        let off = self.staging.len() as u32;
        self.staging.extend_from_slice(bytes);
        self.staging.resize(self.staging.len().next_multiple_of(4), 0);
        (off, bytes.len() as u32)
    }
    fn id(&mut self) -> u32 {
        self.next_id += 1;
        self.next_id
    }
    fn ticket(&mut self, tickets: &TicketTable, cap: usize) -> u32 {
        let t = self.next_ticket;
        self.next_ticket += 1;
        tickets.arm(t, cap);
        t
    }
    fn create_buffer(&mut self, size: u32, usage: u32) -> u32 {
        let id = self.id();
        self.cmd(op::CREATE_BUFFER, &[id, size, usage]);
        id
    }
    fn write_buffer(&mut self, id: u32, offset: u32, data: &[u8]) {
        let (s, n) = self.stage(data);
        self.cmd(op::WRITE_BUFFER, &[id, offset, s, n]);
    }
    fn create_shader(&mut self, wgsl: &str) -> u32 {
        let id = self.id();
        let (s, n) = self.stage(wgsl.as_bytes());
        self.cmd(op::CREATE_SHADER, &[id, s, n]);
        id
    }
    fn create_compute_pipeline(&mut self, shader: u32, entry: &str) -> u32 {
        let id = self.id();
        let (s, n) = self.stage(entry.as_bytes());
        self.cmd(op::CREATE_COMPUTE_PIPELINE, &[id, shader, s, n]);
        id
    }
    /// One storage buffer at `binding` 0 of `group`, the whole buffer.
    fn create_bind_group(&mut self, pipeline: u32, group: u32, buffer: u32) -> u32 {
        let id = self.id();
        self.cmd(op::CREATE_BIND_GROUP, &[id, pipeline, group, 1, 0, buffer, 0, 0]);
        id
    }
    /// Finished: (words, staging).
    fn take(&mut self) -> (Vec<u32>, Vec<u8>) {
        (std::mem::take(&mut self.words), std::mem::take(&mut self.staging))
    }
}

/// A headless executor, or None (said on stderr) where no adapter is found.
fn executor() -> Option<(Executor, Arc<TicketTable>)> {
    let tickets = TicketTable::new();
    match Executor::headless(tickets.clone()) {
        Ok(ex) => Some((ex, tickets)),
        Err(e) => {
            eprintln!("skipped: no GPU adapter here ({e})");
            None
        }
    }
}

fn pattern(len: usize, seed: u32) -> Vec<u8> {
    let mut x = seed.wrapping_mul(2_654_435_761).max(1);
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x as u8
        })
        .collect()
}

const DOUBLE_PLUS_7: &str = "@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < arrayLength(&data)) { data[id.x] = data[id.x] * 2u + 7u; }
}";

#[test]
fn the_stream_tables_are_webgpu_names_wgpu_knows() {
    // A few entries by their stream index, through the executor's name parser.
    let format = |name: &str| tables::index_of(tables::TEXTURE_FORMATS, name).map(|i| tables::TEXTURE_FORMATS[i as usize]).and_then(gpu_stream_wgpu::parse::<gpu_stream_wgpu::wgpu::TextureFormat>);
    assert_eq!(format("rgba8unorm"), Some(gpu_stream_wgpu::wgpu::TextureFormat::Rgba8Unorm));
    assert_eq!(format("bgra8unorm-srgb"), Some(gpu_stream_wgpu::wgpu::TextureFormat::Bgra8UnormSrgb));
    assert_eq!(format("depth24plus-stencil8"), Some(gpu_stream_wgpu::wgpu::TextureFormat::Depth24PlusStencil8));
    for name in tables::VERTEX_FORMATS {
        assert!(gpu_stream_wgpu::parse::<gpu_stream_wgpu::wgpu::VertexFormat>(name).is_some(), "vertex format {name}");
    }
    for name in tables::COMPARE_FUNCTIONS {
        assert!(gpu_stream_wgpu::parse::<gpu_stream_wgpu::wgpu::CompareFunction>(name).is_some(), "compare function {name}");
    }
}

#[test]
fn a_compute_round_trip_reads_back_through_a_ticket() {
    let Some((mut ex, tickets)) = executor() else { return };
    let mut s = Stream::default();
    let n = 1024usize;
    let data = s.create_buffer((n * 4) as u32, STORAGE | COPY_SRC | COPY_DST);
    let readback = s.create_buffer((n * 4) as u32, MAP_READ | COPY_DST);
    let input = pattern(n * 4, 42);
    s.write_buffer(data, 0, &input);
    let shader = s.create_shader(DOUBLE_PLUS_7);
    let pipeline = s.create_compute_pipeline(shader, "main");
    let group = s.create_bind_group(pipeline, 0, data);
    s.cmd(op::PUSH_ERROR_SCOPE, &[0]);
    s.cmd(op::BEGIN_COMPUTE, &[]);
    s.cmd(op::SET_PIPELINE, &[pipeline]);
    s.cmd(op::SET_BIND_GROUP, &[0, group]);
    s.cmd(op::DISPATCH, &[(n / 64) as u32, 1, 1]);
    s.cmd(op::END_COMPUTE, &[]);
    s.cmd(op::COPY_BUFFER, &[data, 0, readback, 0, (n * 4) as u32]);
    s.cmd(op::SUBMIT, &[]);
    let scope = s.ticket(&tickets, 256);
    s.cmd(op::POP_ERROR_SCOPE, &[scope]);
    let read = s.ticket(&tickets, n * 4);
    s.cmd(op::MAP_READ, &[read, readback, 0, (n * 4) as u32]);
    let (words, staging) = s.take();
    ex.execute(&words, &staging).expect("the stream executes");
    assert_eq!(ex.wait_ticket(&tickets, scope, Duration::from_secs(20)), Some(0), "no validation error");
    assert_eq!(ex.wait_ticket(&tickets, read, Duration::from_secs(20)), Some(0));
    assert_eq!(tickets.state(read), TICKET_DONE);
    let want: Vec<u8> = input.chunks_exact(4).flat_map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]).wrapping_mul(2).wrapping_add(7).to_le_bytes()).collect();
    assert_eq!(tickets.read(read).unwrap(), want);
    assert!(!tickets.lost());
}

#[test]
fn a_write_larger_than_a_chunk_lands_intact() {
    let Some((mut ex, tickets)) = executor() else { return };
    let mut s = Stream::default();
    let size = (gpu_stream_wgpu::WRITE_CHUNK_BYTES * 2 + 4096) as u32;
    let big = s.create_buffer(size, COPY_SRC | COPY_DST);
    let readback = s.create_buffer(8192, MAP_READ | COPY_DST);
    let data = pattern(size as usize, 7);
    s.write_buffer(big, 0, &data);
    // The last 8 KiB, past both chunk boundaries.
    s.cmd(op::COPY_BUFFER, &[big, size - 8192, readback, 0, 8192]);
    s.cmd(op::SUBMIT, &[]);
    let t = s.ticket(&tickets, 8192);
    s.cmd(op::MAP_READ, &[t, readback, 0, 8192]);
    let (words, staging) = s.take();
    ex.execute(&words, &staging).expect("the stream executes");
    assert_eq!(ex.wait_ticket(&tickets, t, Duration::from_secs(20)), Some(0));
    assert_eq!(tickets.read(t).unwrap(), data[data.len() - 8192..]);
}

#[test]
fn a_validation_error_reaches_its_scope_and_a_destroyed_buffer_refuses() {
    let Some((mut ex, tickets)) = executor() else { return };
    let mut s = Stream::default();
    let a = s.create_buffer(256, COPY_SRC);
    let b = s.create_buffer(256, COPY_DST);
    s.cmd(op::PUSH_ERROR_SCOPE, &[0]);
    // Past b's end: a validation error, caught by the scope.
    s.cmd(op::COPY_BUFFER, &[a, 0, b, 128, 256]);
    s.cmd(op::SUBMIT, &[]);
    let scope = s.ticket(&tickets, 256);
    s.cmd(op::POP_ERROR_SCOPE, &[scope]);
    let (words, staging) = s.take();
    ex.execute(&words, &staging).expect("the stream executes");
    assert_eq!(ex.wait_ticket(&tickets, scope, Duration::from_secs(20)), Some(1), "the scope caught the error");
    assert!(!tickets.read(scope).unwrap().is_empty(), "with its message");
    // A destroyed handle named again: the stream fails, and the executor reports the device lost to the encoder.
    s.cmd(op::DESTROY, &[KIND_BUFFER, a]);
    s.cmd(op::COPY_BUFFER, &[a, 0, b, 0, 4]);
    let (words, staging) = s.take();
    assert!(ex.execute(&words, &staging).is_err(), "a dead handle fails the stream");
    assert!(tickets.lost());
    let _ = TICKET_FAILED;
}
