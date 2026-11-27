//! The core's side of the executor over the core's shared wasm memory: the
//! ticket table, limits and lost word where the core put them (its
//! `Layout`), for a host that runs the encoder as wasm (a V8 or a wasmtime host).

use std::ptr::NonNull;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use crate::{CoreLink, MESSAGE_BYTES};

use crate::{TICKET_DONE, TICKET_FAILED};

/// The core's ticket/limits/lost layout (gpu.rs `Layout`, seven u32 words).
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub tickets: usize,
    pub ticket_count: usize,
    pub limits: usize,
    pub limit_count: usize,
    pub lost: usize,
    pub lost_message: usize,
    pub lost_message_bytes: usize,
}

/// The core's shared memory, seen from the executor. Shared memories never
/// move (the engine reserves their maximum), so the base pointer is stable;
/// the known length only grows, refreshed with `grow_to`.
pub struct MemoryLink {
    base: NonNull<u8>,
    len: AtomicUsize,
    pub layout: Layout,
}

// The memory is shared by design, written from any thread, with the same
// atomic protocol as the JS executor (data first, state last).
unsafe impl Send for MemoryLink {}
unsafe impl Sync for MemoryLink {}

impl MemoryLink {
    /// Reads the layout the core published at byte `at` (`core_gpu_layout()`).
    ///
    /// # Safety
    /// `base..base+len` must be the core's shared memory, alive and never
    /// moved for as long as the link is used.
    pub unsafe fn new(base: NonNull<u8>, len: usize, at: usize) -> Result<MemoryLink, String> {
        if at % 4 != 0 || at + 28 > len {
            return Err(format!("attach: layout {at} outside the memory"));
        }
        let w = |k: usize| unsafe { (*(base.as_ptr().add(at + 4 * k) as *const AtomicU32)).load(Ordering::Acquire) as usize };
        let layout = Layout {
            tickets: w(0),
            ticket_count: w(1),
            limits: w(2),
            limit_count: w(3),
            lost: w(4),
            lost_message: w(5),
            lost_message_bytes: w(6),
        };
        Ok(MemoryLink { base, len: AtomicUsize::new(len), layout })
    }
    pub fn base(&self) -> NonNull<u8> {
        self.base
    }
    /// The memory grew (the length only increases).
    pub fn grow_to(&self, len: usize) {
        self.len.fetch_max(len, Ordering::AcqRel);
    }
    pub fn in_bounds(&self, at: usize, n: usize) -> bool {
        at.checked_add(n).is_some_and(|end| end <= self.len.load(Ordering::Acquire))
    }
    fn u32_at(&self, at: usize) -> &AtomicU32 {
        assert!(at % 4 == 0 && self.in_bounds(at, 4), "core layout word {at} outside the memory");
        unsafe { &*(self.base.as_ptr().add(at) as *const AtomicU32) }
    }
    pub fn write(&self, at: usize, bytes: &[u8]) {
        assert!(self.in_bounds(at, bytes.len()), "core write {at}+{} outside the memory", bytes.len());
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), self.base.as_ptr().add(at), bytes.len()) }
    }
    fn slot(&self, t: u32) -> usize {
        assert!((t as usize) < self.layout.ticket_count, "ticket {t} outside the table");
        self.layout.tickets + t as usize * 16
    }
    /// Fills the core's limits table: f64s in the format's order (gpu-stream-format `tables::LIMITS`).
    pub fn write_limits(&self, limits: &[f64]) {
        for (k, v) in limits.iter().enumerate().take(self.layout.limit_count) {
            self.write(self.layout.limits + 8 * k, &v.to_le_bytes());
        }
    }
    /// The stream and staging views of one flush (byte offsets, as the JS
    /// executor receives them).
    pub fn flush_views(&self, words: usize, count: usize, staging: usize, staging_bytes: usize) -> Result<(&[u32], &[u8]), String> {
        if words % 4 != 0 || !self.in_bounds(words, count * 4) || !self.in_bounds(staging, staging_bytes) {
            return Err(format!("gpu_flush: stream {words}+{count} words or staging {staging}+{staging_bytes} outside the memory"));
        }
        let base = self.base.as_ptr();
        // SAFETY: in bounds of the live shared memory (checked above).
        unsafe {
            Ok((
                std::slice::from_raw_parts(base.add(words) as *const u32, count),
                std::slice::from_raw_parts(base.add(staging), staging_bytes),
            ))
        }
    }
}

impl CoreLink for MemoryLink {
    fn ticket_cap(&self, t: u32) -> usize {
        self.u32_at(self.slot(t) + 12).load(Ordering::Relaxed) as usize
    }
    fn complete(&self, t: u32, status: u32, data: &[u8]) {
        // As a browser executor completes one: data at the slot's data pointer,
        // status, length (over the capacity word), then the state.
        let slot = self.slot(t);
        let data_at = self.u32_at(slot + 8).load(Ordering::Relaxed) as usize;
        let cap = self.ticket_cap(t);
        let data = &data[..data.len().min(cap)];
        self.write(data_at, data);
        self.u32_at(slot + 4).store(status, Ordering::Relaxed);
        self.u32_at(slot + 12).store(data.len() as u32, Ordering::Relaxed);
        self.u32_at(slot).store(if status == 0 { TICKET_DONE } else { TICKET_FAILED }, Ordering::SeqCst);
    }
    fn is_lost(&self) -> bool {
        self.u32_at(self.layout.lost).load(Ordering::SeqCst) != 0
    }
    fn mark_lost(&self, message: &[u8]) {
        if self.is_lost() {
            return;
        }
        let n = message.len().min(self.layout.lost_message_bytes).min(MESSAGE_BYTES);
        self.write(self.layout.lost_message, &message[..n]);
        self.u32_at(self.layout.lost).store(1, Ordering::SeqCst);
    }
}
