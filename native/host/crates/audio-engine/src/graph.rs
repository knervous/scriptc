//! The render thread's graph: the commands the page thread queues, the mailbox they cross in, and the renderer that
//! applies them at the start of a quantum and renders the quantum.
//!
//! The mailbox is one mutex the page thread holds only to push a command (or take events); the render thread only ever
//! try-locks it, swapping its own empty vectors for the queued ones, so it never waits on the page thread: when the
//! lock is busy, the commands land a quantum later. What the render thread gives up (freed nodes, replaced buffers,
//! finished curves) goes back through the mailbox as `Garbage`, so memory is freed on the page thread, never while
//! rendering.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::bus::Bus;
use crate::convolver::ConvolverState;
use crate::nodes::{Ctx, Edge, Listener, Node, NodeState, Target};
use crate::oscillator::WaveTables;
use crate::param::{ParamInput, QUANTUM};
use crate::{Attr, BufferData, DESTINATION, Event, NodeId, Param, ParamEvent, State};

/// A node id's low bits are its slot in the graph's table; the high bits count the slot's reuses, so an id the page
/// thread still has from a freed node never names the node that took its slot.
pub const SLOT_BITS: u32 = 20;
pub const SLOT_MASK: u32 = (1 << SLOT_BITS) - 1;
pub const GENERATION_MASK: u32 = (1 << (32 - SLOT_BITS)) - 1;

pub fn slot(id: NodeId) -> usize {
    (id & SLOT_MASK) as usize
}

pub enum Cmd {
    Create(Box<NodeState>),
    Connect { from: NodeId, to: NodeId, target: Target },
    Disconnect { from: NodeId, to: Option<NodeId> },
    Param { node: NodeId, param: Param, event: ParamEvent },
    Set { node: NodeId, attr: Attr },
    /// A convolver's new kernel (None clears it).
    SetConvolver { node: NodeId, state: Option<Box<ConvolverState>> },
    SetWave { node: NodeId, tables: Arc<WaveTables> },
    Start { node: NodeId, when: f64, offset: f64, duration: Option<f64> },
    Stop { node: NodeId, when: f64 },
    Release(NodeId),
}

/// What the render thread hands back to be freed on the page thread (held only to be dropped there).
#[allow(dead_code)]
pub enum Garbage {
    Node(Box<NodeState>),
    Buffer(Arc<BufferData>),
    Convolver(Box<ConvolverState>),
    Tables(Arc<WaveTables>),
    Curve(Vec<f32>),
}

#[derive(Default)]
pub struct Mailbox {
    pub commands: Vec<Cmd>,
    pub events: Vec<Event>,
    pub garbage: Vec<Garbage>,
    /// Slots of freed nodes, for the page thread to reuse.
    pub freed: Vec<u32>,
}

pub const STATE_SUSPENDED: u8 = 0;
pub const STATE_RUNNING: u8 = 1;
pub const STATE_CLOSED: u8 = 2;

/// What the page thread and the render thread share.
pub struct Shared {
    pub mailbox: Mutex<Mailbox>,
    /// Frames rendered (the context's clock).
    pub frames: AtomicU64,
    pub state: AtomicU8,
    pub sample_rate: AtomicU32,
    pub latency: AtomicU64,
    /// Quanta rendered for the device and device buffers filled (the live example's checks).
    pub device_frames: AtomicU64,
    pub device_periods: AtomicU64,
    /// The render thread has ended (or never started): commands sent now would never be taken.
    pub render_gone: AtomicBool,
    /// Bumped each time the default output device changes (the device watcher thread, wasapi.rs).
    #[cfg_attr(not(windows), allow(dead_code))]
    pub device_epoch: AtomicU64,
    /// An auto-reset event (a HANDLE; 0 elsewhere than Windows) the stream signals each period, set by `close` too so
    /// the render thread wakes at once to see it.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub wake: usize,
}

impl Drop for Shared {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.wake != 0 {
            // SAFETY: the event made in `new`, closed once, when neither thread can use it any more.
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.wake as windows_sys::Win32::Foundation::HANDLE) };
        }
    }
}

impl Shared {
    pub fn new(sample_rate: f32) -> Arc<Shared> {
        Arc::new(Shared {
            mailbox: Mutex::new(Mailbox {
                commands: Vec::with_capacity(256),
                events: Vec::with_capacity(64),
                garbage: Vec::with_capacity(64),
                freed: Vec::with_capacity(64),
            }),
            frames: AtomicU64::new(0),
            state: AtomicU8::new(STATE_RUNNING),
            sample_rate: AtomicU32::new(sample_rate.to_bits()),
            latency: AtomicU64::new(0f64.to_bits()),
            device_frames: AtomicU64::new(0),
            device_periods: AtomicU64::new(0),
            render_gone: AtomicBool::new(false),
            device_epoch: AtomicU64::new(0),
            wake: wake_event(),
        })
    }

    /// Wakes the render thread from its wait on the device (close).
    pub fn wake(&self) {
        #[cfg(windows)]
        if self.wake != 0 {
            // SAFETY: the event this Shared owns.
            unsafe { windows_sys::Win32::System::Threading::SetEvent(self.wake as windows_sys::Win32::Foundation::HANDLE) };
        }
    }

    pub fn state(&self) -> State {
        match self.state.load(Ordering::Acquire) {
            STATE_SUSPENDED => State::Suspended,
            STATE_RUNNING => State::Running,
            _ => State::Closed,
        }
    }
}

pub struct Renderer {
    pub sample_rate: f32,
    pub frame: u64,
    nodes: Vec<Option<Box<NodeState>>>,
    order: Vec<u32>,
    order_dirty: bool,
    indegree: Vec<u32>,
    queue: Vec<u32>,
    to_free: Vec<u32>,
    listener: Listener,
    commands: Vec<Cmd>,
    events: Vec<Event>,
    garbage: Vec<Garbage>,
    freed: Vec<u32>,
    /// The quantum rendered last, stereo.
    pub out: Bus,
}

impl Renderer {
    pub fn new(sample_rate: f32) -> Renderer {
        let capacity = 1024;
        let mut nodes: Vec<Option<Box<NodeState>>> = Vec::with_capacity(capacity);
        nodes.push(Some(NodeState::destination()));
        Renderer {
            sample_rate,
            frame: 0,
            nodes,
            order: Vec::with_capacity(capacity),
            order_dirty: true,
            indegree: Vec::with_capacity(capacity),
            queue: Vec::with_capacity(capacity),
            to_free: Vec::with_capacity(64),
            listener: Listener::new(),
            commands: Vec::with_capacity(256),
            events: Vec::with_capacity(64),
            garbage: Vec::with_capacity(256),
            freed: Vec::with_capacity(64),
            out: Bus::new(),
        }
    }

    /// Swaps queued commands in and events and garbage out, if the mailbox is free; never waits. Commands taken are
    /// applied by the next `apply_commands` (render_quantum does it first).
    pub fn exchange(&mut self, shared: &Shared) {
        let Ok(mut mailbox) = shared.mailbox.try_lock() else { return };
        if self.commands.is_empty() {
            std::mem::swap(&mut mailbox.commands, &mut self.commands);
        } else {
            self.commands.append(&mut mailbox.commands);
        }
        self.hand_back(&mut mailbox);
    }

    /// Events, garbage and freed slots out to the mailbox, commands left there (an offline render's last step).
    pub fn hand_back(&mut self, mailbox: &mut Mailbox) {
        hand_over(&mut mailbox.events, &mut self.events);
        hand_over(&mut mailbox.garbage, &mut self.garbage);
        hand_over(&mut mailbox.freed, &mut self.freed);
    }

    /// A fresh graph after `old` panicked mid-quantum, at the quantum after the one that failed: every source that was
    /// playing is reported ended (so the page is not left waiting), and the old nodes go to the page thread to free.
    /// Ids the page still holds for them name nothing now; their commands are ignored.
    pub fn salvage(&mut self, old: Renderer, failed_frame: u64) {
        self.frame = failed_frame + QUANTUM as u64;
        let Renderer { nodes, events, garbage, freed, .. } = old;
        self.events.extend(events);
        self.garbage.extend(garbage);
        self.freed.extend(freed);
        for node in nodes.into_iter().flatten() {
            let playing = match &node.node {
                Node::BufferSource(s) => s.sched.sounding(),
                Node::Oscillator(o) => o.sched.sounding(),
                _ => false,
            };
            if playing {
                self.events.push(Event::Ended(node.id));
            }
            if node.id != DESTINATION {
                self.garbage.push(Garbage::Node(node));
            }
        }
    }

    fn node(&mut self, id: NodeId) -> Option<&mut NodeState> {
        self.nodes.get_mut(slot(id))?.as_deref_mut().filter(|n| n.id == id)
    }

    fn exists(&self, id: NodeId) -> bool {
        self.nodes.get(slot(id)).and_then(|n| n.as_deref()).is_some_and(|n| n.id == id)
    }

    pub fn apply_commands(&mut self) {
        let now = self.frame as f64 / self.sample_rate as f64;
        let mut commands = std::mem::take(&mut self.commands);
        for cmd in commands.drain(..) {
            self.apply(cmd, now);
        }
        self.commands = commands;
    }

    fn apply(&mut self, cmd: Cmd, now: f64) {
        match cmd {
            Cmd::Create(node) => {
                let s = slot(node.id);
                if s == 0 {
                    self.garbage.push(Garbage::Node(node));
                    return;
                }
                if self.nodes.len() <= s {
                    self.nodes.resize_with(s + 1, || None);
                }
                if let Some(old) = self.nodes[s].replace(node) {
                    self.garbage.push(Garbage::Node(old));
                }
                self.order_dirty = true;
            }
            Cmd::Connect { from, to, target } => {
                if from == to || !self.exists(from) || !self.exists(to) {
                    return;
                }
                let edge = Edge { to, target };
                if self.node(from).is_some_and(|f| f.edges.contains(&edge)) {
                    return;
                }
                if let Target::Param(p) = target {
                    // The param's input buffer, made on its first connection.
                    let Some(param) = self.node(to).and_then(|n| n.param_mut(p)) else { return };
                    let input = param.input.get_or_insert_with(|| Box::new(ParamInput { buf: [0.0; QUANTUM], stamp: 0, connections: 0 }));
                    input.connections += 1;
                }
                if let Some(f) = self.node(from) {
                    f.edges.push(edge);
                }
                if let Some(t) = self.node(to) {
                    t.incoming += 1;
                }
                self.order_dirty = true;
            }
            Cmd::Disconnect { from, to } => {
                loop {
                    let Some(f) = self.node(from) else { return };
                    let Some(i) = f.edges.iter().position(|e| to.is_none_or(|t| e.to == t)) else { break };
                    let edge = f.edges.swap_remove(i);
                    self.unlink(edge);
                }
                self.order_dirty = true;
            }
            Cmd::Param { node, param, event } => {
                let mut garbage = std::mem::take(&mut self.garbage);
                let target = if is_listener(param) {
                    self.listener.param_mut(param)
                } else {
                    self.nodes.get_mut(slot(node)).and_then(|n| n.as_deref_mut()).filter(|n| n.id == node).and_then(|n| n.param_mut(param))
                };
                match target {
                    Some(p) => p.timeline.apply(event, now, &mut garbage),
                    None => {
                        if let ParamEvent::SetValueCurveAtTime { values, .. } = event {
                            garbage.push(Garbage::Curve(values));
                        }
                    }
                }
                self.garbage = garbage;
            }
            Cmd::Set { node, attr } => {
                let mut garbage = std::mem::take(&mut self.garbage);
                match self.node(node) {
                    Some(n) => n.set(attr, &mut garbage),
                    None => {
                        if let Attr::Buffer(Some(b)) = attr {
                            garbage.push(Garbage::Buffer(b));
                        }
                    }
                }
                self.garbage = garbage;
            }
            Cmd::SetConvolver { node, state } => {
                let old = match self.node(node).map(|n| &mut n.node) {
                    Some(Node::Convolver(c)) => std::mem::replace(&mut c.state, state),
                    _ => state,
                };
                if let Some(old) = old {
                    self.garbage.push(Garbage::Convolver(old));
                }
            }
            Cmd::SetWave { node, tables } => {
                let mut garbage = std::mem::take(&mut self.garbage);
                match self.node(node).map(|n| &mut n.node) {
                    Some(Node::Oscillator(o)) => o.set_tables(tables, &mut garbage),
                    _ => garbage.push(Garbage::Tables(tables)),
                }
                self.garbage = garbage;
            }
            Cmd::Start { node, when, offset, duration } => match self.node(node).map(|n| &mut n.node) {
                Some(Node::BufferSource(s)) => s.start(when, offset, duration),
                Some(Node::Oscillator(o)) if o.sched.start.is_none() => o.sched.start = Some(when.max(0.0)),
                _ => {}
            },
            Cmd::Stop { node, when } => {
                let sched = match self.node(node).map(|n| &mut n.node) {
                    Some(Node::BufferSource(s)) => &mut s.sched,
                    Some(Node::Oscillator(o)) => &mut o.sched,
                    _ => return,
                };
                if sched.start.is_some() && !sched.ended {
                    sched.stop = when.max(0.0);
                }
            }
            Cmd::Release(node) => {
                if node != DESTINATION
                    && let Some(n) = self.node(node)
                {
                    n.released = true;
                }
            }
        }
    }

    /// A removed connection: the target's count of what feeds it, and a param's input when nothing feeds it any more.
    fn unlink(&mut self, edge: Edge) {
        let Some(t) = self.node(edge.to) else { return };
        t.incoming = t.incoming.saturating_sub(1);
        if let Target::Param(p) = edge.target
            && let Some(input) = t.param_mut(p).and_then(|p| p.input.as_mut())
        {
            input.connections = input.connections.saturating_sub(1);
        }
    }

    /// The processing order: every live node after everything that feeds it (Kahn's algorithm on preallocated
    /// vectors). Nodes left over are in (or fed by) a cycle and are muted.
    fn sort(&mut self) {
        let n = self.nodes.len();
        self.indegree.clear();
        self.indegree.resize(n, 0);
        for node in self.nodes.iter().flatten() {
            for e in &node.edges {
                self.indegree[slot(e.to)] += 1;
            }
        }
        self.order.clear();
        self.queue.clear();
        for (i, node) in self.nodes.iter().enumerate() {
            if node.is_some() && self.indegree[i] == 0 {
                self.queue.push(i as u32);
            }
        }
        let mut head = 0;
        while head < self.queue.len() {
            let i = self.queue[head] as usize;
            head += 1;
            self.order.push(i as u32);
            if let Some(node) = &self.nodes[i] {
                for e in &node.edges {
                    let t = slot(e.to);
                    self.indegree[t] -= 1;
                    if self.indegree[t] == 0 {
                        self.queue.push(t as u32);
                    }
                }
            }
        }
        for (i, node) in self.nodes.iter_mut().enumerate() {
            if let Some(node) = node {
                node.muted = self.indegree[i] > 0;
                if node.muted {
                    self.order.push(i as u32);
                }
            }
        }
        self.order_dirty = false;
    }

    /// Renders one quantum into `out` (stereo), advancing the clock.
    pub fn render_quantum(&mut self) {
        self.apply_commands();
        if self.order_dirty {
            self.sort();
        }
        let ctx_frame = self.frame;
        let sample_rate = self.sample_rate as f64;
        self.listener.compute(ctx_frame, sample_rate, &mut self.garbage);

        // Inputs start each quantum empty (a param's input is stale once its stamp is an earlier quantum's).
        for &i in &self.order {
            if let Some(node) = &mut self.nodes[i as usize] {
                node.input.set_silent();
            }
        }

        let ctx = Ctx { frame0: ctx_frame, sample_rate, listener: &self.listener };
        for k in 0..self.order.len() {
            let i = self.order[k] as usize;
            let (before, rest) = self.nodes.split_at_mut(i);
            let Some((node, after)) = rest.split_first_mut() else { continue };
            let Some(node) = node.as_deref_mut() else { continue };
            if node.process(&ctx, &mut self.garbage) {
                self.events.push(Event::Ended(node.id));
            }
            if node.output.silent() {
                continue;
            }
            for e in &node.edges {
                let t = slot(e.to);
                let target = if t < i { before[t].as_deref_mut() } else if t > i { after[t - i - 1].as_deref_mut() } else { None };
                let Some(target) = target else { continue };
                match e.target {
                    Target::Input => target.input.mix_in(&node.output),
                    Target::Param(p) => {
                        if let Some(input) = target.param_mut(p).and_then(|p| p.input.as_mut()) {
                            if input.stamp != ctx_frame + 1 {
                                input.buf.fill(0.0);
                                input.stamp = ctx_frame + 1;
                            }
                            node.output.add_mono_to(&mut input.buf);
                        }
                    }
                }
            }
        }

        // The destination: its input up-mixed to stereo.
        if let Some(dest) = &mut self.nodes[0] {
            self.out.set_silent();
            self.out.mix_in(&dest.input);
            self.out.up_mix_stereo();
            // Nothing that is not a number leaves for the device (a NaN would stay in the endpoint's mix).
            if !self.out.silent() {
                for c in &mut self.out.ch {
                    for x in c.iter_mut() {
                        if !x.is_finite() {
                            *x = 0.0;
                        }
                    }
                }
            }
        }
        self.frame += QUANTUM as u64;
        self.free_released();
    }

    /// Frees released nodes that nothing feeds and that can make no more sound.
    fn free_released(&mut self) {
        self.to_free.clear();
        for &i in &self.order {
            if let Some(node) = &self.nodes[i as usize]
                && node.released
                && node.incoming == 0
                && !node.sounding()
            {
                self.to_free.push(i);
            }
        }
        for k in 0..self.to_free.len() {
            let i = self.to_free[k] as usize;
            let Some(mut node) = self.nodes[i].take() else { continue };
            for e in node.edges.drain(..) {
                self.unlink(e);
            }
            self.garbage.push(Garbage::Node(node));
            self.freed.push(i as u32);
            self.order_dirty = true;
        }
    }
}

fn is_listener(param: Param) -> bool {
    matches!(
        param,
        Param::ListenerPositionX
            | Param::ListenerPositionY
            | Param::ListenerPositionZ
            | Param::ListenerForwardX
            | Param::ListenerForwardY
            | Param::ListenerForwardZ
            | Param::ListenerUpX
            | Param::ListenerUpY
            | Param::ListenerUpZ
    )
}

/// Moves `from` into `to`: a swap when `to` is empty (no allocation), else an append.
fn hand_over<T>(to: &mut Vec<T>, from: &mut Vec<T>) {
    if from.is_empty() {
        return;
    }
    if to.is_empty() {
        std::mem::swap(to, from);
    } else {
        to.append(from);
    }
}

/// The render thread's wake-up event (Windows), owned by `Shared`.
fn wake_event() -> usize {
    #[cfg(windows)]
    {
        // SAFETY: an unnamed auto-reset event, closed in Shared's Drop.
        unsafe { windows_sys::Win32::System::Threading::CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) as usize }
    }
    #[cfg(not(windows))]
    {
        0
    }
}
