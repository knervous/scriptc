//! SCRIPTC_HOST_PROFILE=<out.txt> (Windows x64): an in-process sampling CPU profiler. Off (the variable unset) it is
//! never started and costs nothing but [`phase`]'s relaxed stores.
//!
//! A thread of its own wakes about every millisecond (a high-resolution waitable timer) and samples:
//! - the page's thread (the one that made the first host call: the program's loop, the window, the document) on every
//!   tick, busy or waiting (a wall-clock profile; each sample is marked on-CPU when the thread ran most of the tick);
//! - every other thread of the process that ran at least a fifth of the tick (QueryThreadCycleTime): the network and
//!   decode pools, wgpu's and the driver's, audio. Each is labelled by its name (GetThreadDescription) or its id.
//! A sample suspends the thread (SuspendThread, GetThreadContext), walks its stack with RtlVirtualUnwind on the
//! modules' own .pdata (copied when a module is first seen, so the walk takes no lock a suspended thread may hold:
//! RtlLookupFunctionEntry can) and resumes it; nothing is allocated meanwhile.
//!
//! SCRIPTC_HOST_PROFILE_SPAN=<from>-<to> (seconds after the first host call) samples only that span and writes the
//! report when it ends (a run ended by `timeout` never reaches the window's close); without it the profile runs from
//! the start until the window closes. The report is symbolized with dbghelp (the PDB found as `symbols\<exe>.pdb` beside
//! the executable, or in SCRIPTC_HOST_PROFILE_SYMBOLS; system modules by their exports) and written to <out.txt>: per
//! thread its samples, the page thread's split by phase (what the window's turn was doing: [`Phase`]), and the top
//! exclusive and inclusive functions; <out.txt>.folded holds the collapsed stacks (`thread;phase;root;...;leaf count`,
//! flamegraph.pl's and speedscope's format).

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, LocalFree};
use windows_sys::Win32::System::Diagnostics::Debug::{
    CONTEXT, CONTEXT_FULL_AMD64, GetThreadContext, IMAGE_RUNTIME_FUNCTION_ENTRY, RtlVirtualUnwind, SYMBOL_INFOW, SYMOPT_DEFERRED_LOADS, SYMOPT_FAIL_CRITICAL_ERRORS,
    SYMOPT_NO_PROMPTS, SYMOPT_UNDNAME, SymCleanup, SymFromAddrW, SymInitializeW, SymSetOptions, UNW_FLAG_NHANDLER,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, TH32CS_SNAPMODULE, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next};
use windows_sys::Win32::System::Memory::{MEMORY_BASIC_INFORMATION, VirtualQuery};
use windows_sys::Win32::System::Threading::{
    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, CreateWaitableTimerExW, GetCurrentProcess, GetCurrentProcessId, GetCurrentThread, GetCurrentThreadId, GetThreadDescription, OpenThread,
    ResumeThread, SetThreadPriority, SetWaitableTimer, SuspendThread, THREAD_GET_CONTEXT, THREAD_PRIORITY_TIME_CRITICAL, THREAD_QUERY_LIMITED_INFORMATION,
    THREAD_SUSPEND_RESUME, TIMER_ALL_ACCESS, WaitForSingleObject,
};

// kernel32's QueryThreadCycleTime (windows-sys has it under a feature this crate does not enable).
#[link(name = "kernel32")]
unsafe extern "system" {
    fn QueryThreadCycleTime(thread: HANDLE, cycles: *mut u64) -> i32;
}

/// What the page's thread is doing, as the window's turn marks it (window_windows.rs, timers.rs): each page-thread
/// sample carries it.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Phase {
    /// The program's loop outside the window's turn: promise jobs, messages, the network's deliveries, modules.
    Loop = 0,
    /// The window's sleep (its message queue's wait).
    Wait = 1,
    /// Input dispatched into the document.
    Input = 2,
    /// The refresh's requestAnimationFrame callbacks (the program's frame: its state, UI, the scene's encoding).
    Frame = 3,
    /// Resize and mutation observers after the frame's callbacks.
    Observers = 4,
    /// The document's paint (Vello on the GPU, or the CPU).
    Paint = 5,
    /// The swapchain's next texture (get_current_texture: may wait for the display).
    Acquire = 6,
    /// The composite pass encoded and submitted.
    Composite = 7,
    /// The present.
    Present = 8,
    /// setTimeout / setInterval callbacks (timers::run_due).
    Timers = 9,
}

const PHASE_NAMES: [&str; 10] = ["loop", "wait", "input", "frame-callbacks", "observers", "paint", "acquire", "composite", "present", "timers"];

static PHASE: AtomicU8 = AtomicU8::new(0);
static STARTED: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static MAIN_TID: AtomicU32 = AtomicU32::new(0);
static DONE: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);

/// Marks what the page's thread does from now on (a relaxed store: free when the profiler is off).
#[inline(always)]
pub fn phase(p: Phase) {
    PHASE.store(p as u8, Ordering::Relaxed);
}

/// From the page's thread, at its first host call: starts the sampler when SCRIPTC_HOST_PROFILE names a file.
pub fn start() {
    let Some(out) = std::env::var_os("SCRIPTC_HOST_PROFILE").filter(|v| !v.is_empty()) else { return };
    if STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    // SAFETY: a plain query of the calling thread.
    MAIN_TID.store(unsafe { GetCurrentThreadId() }, Ordering::Release);
    let span = std::env::var("SCRIPTC_HOST_PROFILE_SPAN").ok().and_then(|s| {
        let (a, b) = s.split_once('-')?;
        Some((a.trim().parse::<f64>().ok()?, b.trim().parse::<f64>().ok()?))
    });
    let out = std::path::PathBuf::from(out);
    match std::thread::Builder::new().name("scriptc-host profiler".into()).spawn(move || sampler(out, span)) {
        Ok(h) => *DONE.lock().unwrap_or_else(|e| e.into_inner()) = Some(h),
        Err(e) => eprintln!("scriptc-host profile: no sampler thread: {e}"),
    }
}

/// The window closed: the sampler stops and writes its report (waited for, so a closing process keeps it).
pub fn stop() {
    if !STARTED.load(Ordering::Acquire) {
        return;
    }
    STOP.store(true, Ordering::Release);
    if let Some(h) = DONE.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = h.join();
    }
}

/// GetThreadContext's record must be 16-byte aligned.
#[repr(C, align(16))]
struct Ctx(CONTEXT);

/// A module's address range and its .pdata (copied: never read from the image while a thread is suspended).
struct Module {
    base: u64,
    end: u64,
    name: String,
    pdata: Vec<IMAGE_RUNTIME_FUNCTION_ENTRY>,
}

struct Thread {
    tid: u32,
    handle: HANDLE,
    name: String,
    cycles: u64,
    main: bool,
    alive: bool,
}

const MAX_FRAMES: usize = 256;

/// One sample's key: the thread's index, the page thread's phase (and whether it was on the CPU), the stack (leaf first).
#[derive(PartialEq, Eq, Hash)]
struct Key {
    thread: u32,
    phase: u8,
    on_cpu: bool,
    stack: Box<[u64]>,
}

fn sampler(out: std::path::PathBuf, span: Option<(f64, f64)>) {
    let t0 = Instant::now();
    // SAFETY: plain thread and timer calls on handles of this thread's own.
    let timer = unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
        CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS)
    };
    let tick = |ms: f64| {
        if timer.is_null() {
            std::thread::sleep(Duration::from_secs_f64(ms / 1000.0));
            return;
        }
        let due: i64 = -((ms * 10_000.0) as i64);
        // SAFETY: the timer made above.
        unsafe {
            SetWaitableTimer(timer, &due, 0, None, std::ptr::null(), 0);
            WaitForSingleObject(timer, 1000);
        }
    };
    // The TSC's rate (QueryThreadCycleTime counts it), for "ran most of the tick".
    let tsc_per_ms = {
        let (i, c) = (Instant::now(), rdtsc());
        std::thread::sleep(Duration::from_millis(50));
        (rdtsc() - c) as f64 / (i.elapsed().as_secs_f64() * 1000.0)
    };
    if let Some((from, _)) = span {
        while t0.elapsed().as_secs_f64() < from && !STOP.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let begun = Instant::now();
    // SAFETY: plain queries of this process.
    let (pid, me) = unsafe { (GetCurrentProcessId(), GetCurrentThreadId()) };
    let main_tid = MAIN_TID.load(Ordering::Acquire);
    let mut threads: Vec<Thread> = Vec::new();
    let mut modules: Vec<Module> = Vec::new();
    let mut samples: HashMap<Key, u32> = HashMap::new();
    let mut per_thread_ticks: HashMap<u32, u64> = HashMap::new();
    let mut ticks: u64 = 0;
    let mut last_refresh: Option<Instant> = None;
    let mut last_tick = Instant::now();
    let mut stack = [0u64; MAX_FRAMES];
    let mut cost = Duration::ZERO;
    loop {
        let elapsed = t0.elapsed().as_secs_f64();
        if STOP.load(Ordering::Acquire) || span.is_some_and(|(_, to)| elapsed >= to) {
            break;
        }
        if last_refresh.is_none_or(|r| r.elapsed() >= Duration::from_millis(500)) {
            refresh_threads(&mut threads, pid, me, main_tid);
            refresh_modules(&mut modules, pid);
            last_refresh = Some(Instant::now());
        }
        let tick_ms = last_tick.elapsed().as_secs_f64() * 1000.0;
        last_tick = Instant::now();
        let busy = (tsc_per_ms * tick_ms * 0.2) as u64;
        ticks += 1;
        let work = Instant::now();
        for (i, t) in threads.iter_mut().enumerate() {
            if !t.alive {
                continue;
            }
            let mut cycles = 0u64;
            // SAFETY: a handle opened with THREAD_QUERY_LIMITED_INFORMATION.
            if unsafe { QueryThreadCycleTime(t.handle, &mut cycles) } == 0 {
                t.alive = false;
                continue;
            }
            let ran = cycles.saturating_sub(t.cycles);
            t.cycles = cycles;
            let on_cpu = ran >= busy;
            if !(t.main || on_cpu) {
                continue;
            }
            // SAFETY: the thread is suspended for the walk and resumed after it; nothing allocates meanwhile.
            let (n, phase) = unsafe {
                if SuspendThread(t.handle) == u32::MAX {
                    t.alive = false;
                    continue;
                }
                let mut ctx: Ctx = std::mem::zeroed();
                ctx.0.ContextFlags = CONTEXT_FULL_AMD64;
                let n = if GetThreadContext(t.handle, &mut ctx.0) != 0 { walk(&mut ctx.0, &modules, &mut stack) } else { 0 };
                let phase = if t.main { PHASE.load(Ordering::Relaxed) } else { 0 };
                ResumeThread(t.handle);
                (n, phase)
            };
            if n == 0 {
                continue;
            }
            *per_thread_ticks.entry(i as u32).or_default() += 1;
            *samples.entry(Key { thread: i as u32, phase, on_cpu, stack: stack[..n].into() }).or_default() += 1;
        }
        cost += work.elapsed();
        tick(1.0);
    }
    let wall = begun.elapsed().as_secs_f64();
    eprintln!("scriptc-host profile: {ticks} ticks over {wall:.1} s; symbolizing");
    let report = report(&out, &threads, &modules, &samples, ticks, wall, cost);
    match report {
        Ok(()) => eprintln!("scriptc-host profile: written to {}", out.display()),
        Err(e) => eprintln!("scriptc-host profile: writing {}: {e}", out.display()),
    }
    for t in &threads {
        // SAFETY: handles this thread opened.
        unsafe { CloseHandle(t.handle) };
    }
}

fn rdtsc() -> u64 {
    // SAFETY: an unprivileged instruction on every x64.
    unsafe { core::arch::x86_64::_rdtsc() }
}

/// The process's threads: new ones opened and named, gone ones marked.
fn refresh_threads(threads: &mut Vec<Thread>, pid: u32, me: u32, main_tid: u32) {
    // SAFETY: a Toolhelp snapshot walked with its own records, and handles opened on this process's threads.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snap == INVALID_HANDLE_VALUE {
            return;
        }
        let mut seen = HashSet::new();
        let mut e: THREADENTRY32 = std::mem::zeroed();
        e.dwSize = size_of::<THREADENTRY32>() as u32;
        let mut ok = Thread32First(snap, &mut e) != 0;
        while ok {
            if e.th32OwnerProcessID == pid && e.th32ThreadID != me {
                seen.insert(e.th32ThreadID);
                if !threads.iter().any(|t| t.tid == e.th32ThreadID && t.alive) {
                    let h = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_LIMITED_INFORMATION, 0, e.th32ThreadID);
                    if !h.is_null() {
                        let mut cycles = 0u64;
                        QueryThreadCycleTime(h, &mut cycles);
                        let main = e.th32ThreadID == main_tid;
                        let name = if main { "page (main)".to_string() } else { thread_name(h).unwrap_or_else(|| format!("tid {}", e.th32ThreadID)) };
                        threads.push(Thread { tid: e.th32ThreadID, handle: h, name, cycles, main, alive: true });
                    }
                }
            }
            ok = Thread32Next(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        for t in threads.iter_mut() {
            if !seen.contains(&t.tid) {
                t.alive = false;
            }
        }
    }
}

unsafe fn thread_name(h: HANDLE) -> Option<String> {
    let mut p: *mut u16 = std::ptr::null_mut();
    // SAFETY: GetThreadDescription allocates the string (LocalFree'd here).
    unsafe {
        if GetThreadDescription(h, &mut p) < 0 || p.is_null() {
            return None;
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, n));
        LocalFree(p.cast());
        (!s.is_empty()).then_some(s)
    }
}

/// The process's modules: each new one's .pdata copied (its PE's exception directory).
fn refresh_modules(modules: &mut Vec<Module>, pid: u32) {
    // SAFETY: a Toolhelp snapshot; each module's headers and .pdata read while it is loaded (the snapshot just saw it).
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid);
        if snap == INVALID_HANDLE_VALUE {
            return;
        }
        let mut e: MODULEENTRY32W = std::mem::zeroed();
        e.dwSize = size_of::<MODULEENTRY32W>() as u32;
        let mut ok = Module32FirstW(snap, &mut e) != 0;
        let mut fresh = false;
        while ok {
            let base = e.modBaseAddr as u64;
            let end = base + e.modBaseSize as u64;
            if !modules.iter().any(|m| m.base == base && m.end == end) {
                let n = e.szModule.iter().position(|&c| c == 0).unwrap_or(e.szModule.len());
                let name = String::from_utf16_lossy(&e.szModule[..n]);
                modules.retain(|m| m.end <= base || m.base >= end);
                modules.push(Module { base, end, name, pdata: pdata_of(base) });
                fresh = true;
            }
            ok = Module32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        if fresh {
            modules.sort_by_key(|m| m.base);
        }
    }
}

/// A loaded PE32+ image's exception directory (its RUNTIME_FUNCTIONs, sorted by start).
unsafe fn pdata_of(base: u64) -> Vec<IMAGE_RUNTIME_FUNCTION_ENTRY> {
    // SAFETY: the image's headers, mapped while it is loaded.
    unsafe {
        let b = base as *const u8;
        if *(b as *const u16) != 0x5a4d {
            return Vec::new();
        }
        let nt = b.add(*(b.add(0x3c) as *const u32) as usize);
        if *(nt as *const u32) != 0x4550 || *(nt.add(24) as *const u16) != 0x20b {
            return Vec::new();
        }
        // The optional header's data directories start 112 bytes in (PE32+); the exception directory is the 4th.
        let dir = nt.add(24 + 112 + 3 * 8);
        let (rva, size) = (*(dir as *const u32), *(dir.add(4) as *const u32));
        let n = size as usize / size_of::<IMAGE_RUNTIME_FUNCTION_ENTRY>();
        if rva == 0 || n == 0 {
            return Vec::new();
        }
        std::slice::from_raw_parts(b.add(rva as usize) as *const IMAGE_RUNTIME_FUNCTION_ENTRY, n).to_vec()
    }
}

/// The function entry covering `pc`, and its module's base.
fn lookup(modules: &[Module], pc: u64) -> Option<(u64, IMAGE_RUNTIME_FUNCTION_ENTRY)> {
    let i = modules.partition_point(|m| m.base <= pc).checked_sub(1)?;
    let m = &modules[i];
    if pc >= m.end {
        return None;
    }
    let rva = (pc - m.base) as u32;
    let j = m.pdata.partition_point(|f| f.BeginAddress <= rva).checked_sub(1)?;
    let mut f = m.pdata[j];
    if rva >= f.EndAddress {
        return None;
    }
    // SAFETY: a union of two u32s.
    let unwind = unsafe { f.Anonymous.UnwindData };
    // An indirect entry: the low bit marks the RVA of the primary entry (in the image's own .pdata).
    if unwind & 1 != 0 {
        let k = m.pdata.partition_point(|g| g.BeginAddress < (unwind & !1)).min(m.pdata.len().saturating_sub(1));
        f = m.pdata[k];
    }
    Some((m.base, f))
}

/// The suspended thread's stack, leaf first, into `out`: the frame count.
unsafe fn walk(ctx: &mut CONTEXT, modules: &[Module], out: &mut [u64; MAX_FRAMES]) -> usize {
    // The stack's committed region (a fiber's own stack included): the walk stays inside it.
    let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: a query of this process's own memory.
    if unsafe { VirtualQuery(ctx.Rsp as *const _, &mut info, size_of::<MEMORY_BASIC_INFORMATION>()) } == 0 {
        return 0;
    }
    let (lo, hi) = (info.BaseAddress as u64, info.BaseAddress as u64 + info.RegionSize as u64);
    let mut n = 0;
    while n < MAX_FRAMES {
        let pc = ctx.Rip;
        if pc == 0 || ctx.Rsp < lo || ctx.Rsp + 8 > hi {
            break;
        }
        out[n] = pc;
        n += 1;
        match lookup(modules, pc) {
            Some((base, f)) => {
                // A frame that unwinds through a frame register (RBP, say) reads memory through it: one outside the
                // stack (a frame not set up yet, a fiber's switch, garbage) faulted inside RtlVirtualUnwind. Stop there.
                // SAFETY: the unwind info of a loaded module's own function entry.
                if !unsafe { frame_register_ok(ctx, base, &f, modules, lo, hi) } {
                    break;
                }
                let mut handler = std::ptr::null_mut();
                let mut frame = 0u64;
                let sp = ctx.Rsp;
                // SAFETY: the thread is suspended; its frame's unwind codes read its own stack (checked above).
                unsafe { RtlVirtualUnwind(UNW_FLAG_NHANDLER, base, pc, &f, ctx, &mut handler, &mut frame, std::ptr::null_mut()) };
                if ctx.Rsp <= sp {
                    break;
                }
            }
            // A leaf with no frame (no unwind entry): its return address on top of the stack. Only for the leaf.
            None if n == 1 => {
                // SAFETY: inside the stack's region (checked above).
                ctx.Rip = unsafe { *(ctx.Rsp as *const u64) };
                ctx.Rsp += 8;
            }
            None => break,
        }
    }
    n
}

/// Whether the unwind info of `f` (and the entries it chains to) is inside its module and names no frame register
/// whose value lies outside the stack's region [lo, hi).
unsafe fn frame_register_ok(ctx: &CONTEXT, base: u64, f: &IMAGE_RUNTIME_FUNCTION_ENTRY, modules: &[Module], lo: u64, hi: u64) -> bool {
    let Some(m) = modules.iter().find(|m| m.base == base) else { return false };
    // SAFETY: a union of two u32s.
    let mut unwind = unsafe { f.Anonymous.UnwindData } as u64;
    for _ in 0..32 {
        let at = base + unwind;
        if at < m.base || at + 4 > m.end {
            return false;
        }
        // SAFETY: inside the module's image (checked above); UNWIND_INFO's 4-byte header.
        let (flags, codes, frame_reg) = unsafe {
            let p = at as *const u8;
            (*p >> 3, *p.add(2) as u64, *p.add(3) & 0x0f)
        };
        if frame_reg != 0 {
            let r = [ctx.Rax, ctx.Rcx, ctx.Rdx, ctx.Rbx, ctx.Rsp, ctx.Rbp, ctx.Rsi, ctx.Rdi, ctx.R8, ctx.R9, ctx.R10, ctx.R11, ctx.R12, ctx.R13, ctx.R14, ctx.R15][frame_reg as usize];
            if r < lo || r >= hi {
                return false;
            }
        }
        // UNW_FLAG_CHAININFO: a RUNTIME_FUNCTION follows the codes (their count rounded up to even).
        if flags & 0x4 == 0 {
            return true;
        }
        let chained = at + 4 + codes.div_ceil(2) * 2 * 2;
        if chained + 12 > m.end {
            return false;
        }
        // SAFETY: inside the image (checked); the chained entry's UnwindData word.
        unwind = unsafe { *((chained + 8) as *const u32) } as u64;
    }
    false
}

/// A symbolized frame: "module!function".
struct Symbols {
    names: HashMap<u64, std::rc::Rc<str>>,
}

fn symbolize(modules: &[Module], addrs: &HashSet<u64>) -> Symbols {
    let search = std::env::var("SCRIPTC_HOST_PROFILE_SYMBOLS").ok().or_else(|| {
        let exe = crate::exe_dir()?;
        Some(format!("{};{}", exe.join("symbols").display(), exe.display()))
    });
    let wide: Option<Vec<u16>> = search.map(|s| s.encode_utf16().chain(std::iter::once(0)).collect());
    let process = unsafe { GetCurrentProcess() };
    // SAFETY: dbghelp on this thread alone (nothing else in the process calls it but a crash's dump).
    let ok = unsafe {
        SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_NO_PROMPTS);
        SymInitializeW(process, wide.as_ref().map_or(std::ptr::null(), |w| w.as_ptr()), 1) != 0
    };
    if !ok {
        eprintln!("scriptc-host profile: SymInitialize failed: {}", std::io::Error::last_os_error());
    }
    let mut interned: HashMap<String, std::rc::Rc<str>> = HashMap::new();
    let mut names = HashMap::new();
    const MAX_NAME: usize = 1024;
    #[repr(C, align(8))]
    struct Buf {
        info: SYMBOL_INFOW,
        rest: [u16; MAX_NAME],
    }
    let mut buf: Box<Buf> = Box::new(unsafe { std::mem::zeroed() });
    for &a in addrs {
        let module = modules.iter().find(|m| a >= m.base && a < m.end);
        let mname = module.map_or("?", |m| m.name.as_str());
        let mut name = None;
        if ok {
            buf.info.SizeOfStruct = size_of::<SYMBOL_INFOW>() as u32;
            buf.info.MaxNameLen = MAX_NAME as u32;
            let mut disp = 0u64;
            // SAFETY: the record and its name buffer (MaxNameLen characters past Name).
            if unsafe { SymFromAddrW(process, a, &mut disp, &mut buf.info) } != 0 {
                let len = (buf.info.NameLen as usize).min(MAX_NAME);
                // SAFETY: NameLen characters written from Name on, inside the buffer.
                let s = unsafe { std::slice::from_raw_parts((&raw const *buf).cast::<u8>().add(std::mem::offset_of!(SYMBOL_INFOW, Name)).cast::<u16>(), len) };
                let n = clean(&String::from_utf16_lossy(s));
                // A module with public symbols only (the Rust code's internal functions have none in the PDB) names
                // the nearest public before the address, which may be another function: when its .pdata says the
                // function starts after that symbol, the frame is named by its start instead.
                let start = lookup(modules, a).map(|(base, f)| base + f.BeginAddress as u64);
                name = Some(match (start, module) {
                    (Some(st), Some(m)) if st > buf.info.Address && buf.info.Address != 0 => format!("fn@0x{:x} (after {n})", st - m.base),
                    _ => n,
                });
            }
        }
        let full = match (name, module) {
            (Some(n), _) => format!("{}!{n}", mname.trim_end_matches(".exe").trim_end_matches(".dll").trim_end_matches(".DLL")),
            (None, Some(m)) => format!("{}+0x{:x}", m.name, a - m.base),
            (None, None) => format!("0x{a:x}"),
        };
        let rc = interned.entry(full.clone()).or_insert_with(|| full.into()).clone();
        names.insert(a, rc);
    }
    if ok {
        // SAFETY: the session begun above.
        unsafe { SymCleanup(process) };
    }
    Symbols { names }
}

/// A Rust name's hash suffix dropped (`::h0123456789abcdef`).
fn clean(s: &str) -> String {
    if let Some(i) = s.rfind("::h") {
        let tail = &s[i + 3..];
        if tail.len() == 16 && tail.bytes().all(|b| b.is_ascii_hexdigit()) {
            return s[..i].to_string();
        }
    }
    s.to_string()
}

fn report(out: &std::path::Path, threads: &[Thread], modules: &[Module], samples: &HashMap<Key, u32>, ticks: u64, wall: f64, cost: Duration) -> std::io::Result<()> {
    // Return addresses (every frame but the leaf) point past their call: symbolized one byte back.
    let mut addrs = HashSet::new();
    for k in samples.keys() {
        for (i, &a) in k.stack.iter().enumerate() {
            addrs.insert(if i == 0 { a } else { a - 1 });
        }
    }
    let syms = symbolize(modules, &addrs);
    let name_of = |i: usize, a: u64| syms.names.get(&if i == 0 { a } else { a - 1 }).cloned().unwrap_or_else(|| "?".into());

    // Threads grouped by name (a pool's workers together), the page's thread first.
    let group_of = |t: &Thread| -> String {
        if t.main {
            return t.name.clone();
        }
        let trimmed = t.name.trim_end_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '#' || c == ' ');
        if trimmed.is_empty() || t.name.starts_with("tid ") { "unnamed threads".to_string() } else { trimmed.to_string() }
    };
    let mut text = String::new();
    let _ = writeln!(text, "scriptc-host profile: {ticks} ticks over {wall:.1} s ({:.0} Hz), sampler's own time {:.1} ms ({:.2} ms per tick)", ticks as f64 / wall.max(1e-9), cost.as_secs_f64() * 1e3, cost.as_secs_f64() * 1e3 / ticks.max(1) as f64);
    let _ = writeln!(text, "A non-page thread is sampled on a tick where it ran at least a fifth of the tick; the page thread on every tick (on-CPU or not).\n");

    let mut by_group: HashMap<String, (u64, HashSet<u32>)> = HashMap::new();
    for (k, &c) in samples {
        let g = by_group.entry(group_of(&threads[k.thread as usize])).or_default();
        g.0 += c as u64;
        g.1.insert(threads[k.thread as usize].tid);
    }
    let mut groups: Vec<_> = by_group.into_iter().collect();
    groups.sort_by(|a, b| b.1.0.cmp(&a.1.0));
    let _ = writeln!(text, "== Threads (samples ~ ms of CPU; the page thread: every tick) ==");
    for (g, (c, tids)) in &groups {
        let _ = writeln!(text, "{c:>9}  {:>5.1}% of ticks  {g} ({} threads)", *c as f64 * 100.0 / ticks.max(1) as f64, tids.len());
    }

    // The page thread's phases, on-CPU and waiting.
    let mut phases = [[0u64; 2]; 10];
    let mut page_total = 0u64;
    for (k, &c) in samples {
        if threads[k.thread as usize].main {
            phases[k.phase as usize % 10][k.on_cpu as usize] += c as u64;
            page_total += c as u64;
        }
    }
    let _ = writeln!(text, "\n== Page thread by phase (% of its samples; on-CPU / off-CPU) ==");
    for (i, p) in phases.iter().enumerate() {
        if p[0] + p[1] > 0 {
            let _ = writeln!(text, "{:>16}  {:>5.1}%  ({:>5.1}% on-CPU, {:>5.1}% off)", PHASE_NAMES[i], (p[0] + p[1]) as f64 * 100.0 / page_total.max(1) as f64, p[1] as f64 * 100.0 / page_total.max(1) as f64, p[0] as f64 * 100.0 / page_total.max(1) as f64);
        }
    }

    // Top functions for: the page thread (all samples), the page thread on-CPU, and every other thread together.
    type Filter<'a> = Box<dyn Fn(&Key) -> bool + 'a>;
    let sections: Vec<(&str, Filter)> = vec![
        ("page thread, on-CPU samples", Box::new(|k: &Key| threads[k.thread as usize].main && k.on_cpu) as Filter),
        ("page thread, every sample (waits included)", Box::new(|k: &Key| threads[k.thread as usize].main) as Filter),
        ("page thread, frame callbacks only", Box::new(|k: &Key| threads[k.thread as usize].main && k.phase == Phase::Frame as u8) as Filter),
        ("other threads, on-CPU", Box::new(|k: &Key| !threads[k.thread as usize].main) as Filter),
    ];
    for (title, keep) in &sections {
        let mut excl: HashMap<std::rc::Rc<str>, u64> = HashMap::new();
        let mut incl: HashMap<std::rc::Rc<str>, u64> = HashMap::new();
        let mut modx: HashMap<String, u64> = HashMap::new();
        let mut total = 0u64;
        for (k, &c) in samples.iter().filter(|(k, _)| keep(k)) {
            total += c as u64;
            let leaf = name_of(0, k.stack[0]);
            let module = leaf.split(['!', '+']).next().unwrap_or("?").to_string();
            *modx.entry(module).or_default() += c as u64;
            *excl.entry(leaf).or_default() += c as u64;
            let mut seen = HashSet::new();
            for (i, &a) in k.stack.iter().enumerate() {
                let n = name_of(i, a);
                if seen.insert(n.clone()) {
                    *incl.entry(n).or_default() += c as u64;
                }
            }
        }
        let _ = writeln!(text, "\n== {title}: {total} samples ==");
        let mut m: Vec<_> = modx.into_iter().collect();
        m.sort_by(|a, b| b.1.cmp(&a.1));
        let _ = writeln!(text, "-- exclusive by module --");
        for (name, c) in m.iter().take(15) {
            let _ = writeln!(text, "{c:>9} {:>6.2}%  {name}", *c as f64 * 100.0 / total.max(1) as f64);
        }
        for (label, map, n) in [("exclusive", &excl, 60), ("inclusive", &incl, 80)] {
            let mut v: Vec<_> = map.iter().collect();
            v.sort_by(|a, b| b.1.cmp(a.1));
            let _ = writeln!(text, "-- top {n} {label} --");
            for (name, c) in v.iter().take(n) {
                let _ = writeln!(text, "{c:>9} {:>6.2}%  {name}", **c as f64 * 100.0 / total.max(1) as f64);
            }
        }
    }
    std::fs::write(out, text)?;

    // Collapsed stacks: thread group; the page thread's phase; root first.
    let mut folded: HashMap<String, u64> = HashMap::new();
    for (k, &c) in samples {
        let t = &threads[k.thread as usize];
        let mut line = group_of(t).replace(';', ":");
        if t.main {
            line.push(';');
            line.push_str(PHASE_NAMES[k.phase as usize % 10]);
            if !k.on_cpu {
                line.push_str(" (off-CPU)");
            }
        }
        for i in (0..k.stack.len()).rev() {
            line.push(';');
            line.push_str(&name_of(i, k.stack[i]).replace(';', ":"));
        }
        *folded.entry(line).or_default() += c as u64;
    }
    let mut f = String::new();
    for (line, c) in folded {
        let _ = writeln!(f, "{line} {c}");
    }
    let mut path = out.as_os_str().to_owned();
    path.push(".folded");
    std::fs::write(path, f)?;

    // The same stacks with the executable's frames as `exe+0x<rva>` (a return address already one byte back), for an
    // offline symbolizer that reads the executable's DWARF with its inline frames (llvm-symbolizer on
    // symbols\<exe>.exe); other modules' frames keep dbghelp's names.
    let exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    let exe_module = modules.iter().find(|m| exe.as_deref() == Some(m.name.to_lowercase().as_str()));
    let mut raw: HashMap<String, u64> = HashMap::new();
    for (k, &c) in samples {
        let t = &threads[k.thread as usize];
        let mut line = group_of(t).replace(';', ":");
        if t.main {
            line.push(';');
            line.push_str(PHASE_NAMES[k.phase as usize % 10]);
            if !k.on_cpu {
                line.push_str(" (off-CPU)");
            }
        }
        for i in (0..k.stack.len()).rev() {
            let a = if i == 0 { k.stack[i] } else { k.stack[i] - 1 };
            line.push(';');
            match exe_module.filter(|m| a >= m.base && a < m.end) {
                Some(m) => {
                    let _ = write!(line, "exe+0x{:x}", a - m.base);
                }
                None => line.push_str(&name_of(i, k.stack[i]).replace(';', ":")),
            }
        }
        *raw.entry(line).or_default() += c as u64;
    }
    let mut r = String::new();
    for (line, c) in raw {
        let _ = writeln!(r, "{line} {c}");
    }
    let mut path = out.as_os_str().to_owned();
    path.push(".raw");
    std::fs::write(path, r)
}
