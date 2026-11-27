//! The C side of the host island: `ScrHostVal`/`ScrHostOps` as the header lays them out, the vtable, and the
//! conversions between the wire values and the host's own `Value`.

use std::cell::RefCell;

use crate::modules;
use crate::objects::{self, Value};
use crate::timers;
use crate::values;

pub const KIND_UNDEFINED: u32 = 0;
pub const KIND_NULL: u32 = 1;
pub const KIND_BOOL: u32 = 2;
pub const KIND_NUMBER: u32 = 3;
pub const KIND_STRING: u32 = 4;
pub const KIND_OBJECT: u32 = 5;
pub const KIND_CLOSURE: u32 = 6;
pub const KIND_PROGRAM: u32 = 7;

pub const OK: i32 = 0;
pub const THREW: i32 = 1;
const ABI: u32 = 3;
/// The header this crate was built against (build.rs): its `SCR_HOST_ABI`, its `ScrHostOps` field names in order, its
/// path.
pub const HEADER_ABI: &str = env!("SCR_HOST_ABI_HEADER");
pub const HEADER_OPS_FIELDS: &str = env!("SCR_HOST_OPS_FIELDS");
pub const HEADER_PATH: &str = env!("SCR_HOST_ISLAND_H_USED");
/// The host island ABI this crate answers (`SCR_HOST_ABI`).
pub const SCR_HOST_ABI: u32 = ABI;

const fn parse_u32(s: &str) -> u32 {
    let b = s.as_bytes();
    let mut i = 0;
    let mut n = 0u32;
    while i < b.len() {
        n = n * 10 + (b[i] - b'0') as u32;
        i += 1;
    }
    n
}

// The header this crate is built against (build.rs) must be at the same ABI: a drift is a compile error.
const _: () = assert!(ABI == parse_u32(env!("SCR_HOST_ABI_HEADER")), "abi.rs answers a different ABI than scr_host_island.h's SCR_HOST_ABI");

#[repr(C)]
#[derive(Clone, Copy)]
pub struct HostVal {
    pub kind: u32,
    pub flag: u32,
    pub number: f64,
    pub str: *const u8,
    pub len: usize,
    pub r#ref: u64,
}

impl HostVal {
    pub const UNDEFINED: HostVal = HostVal { kind: KIND_UNDEFINED, flag: 0, number: 0.0, str: std::ptr::null(), len: 0, r#ref: 0 };
}

type GlobalGet = unsafe extern "C" fn(*const u8, usize, *mut HostVal) -> i32;
type GetProp = unsafe extern "C" fn(u64, *const u8, usize, *mut HostVal) -> i32;
type SetProp = unsafe extern "C" fn(u64, *const u8, usize, *const HostVal, *mut HostVal) -> i32;
type Call = unsafe extern "C" fn(u64, u64, i32, *const HostVal, *mut HostVal) -> i32;
type CallMethod = unsafe extern "C" fn(u64, *const u8, usize, i32, *const HostVal, *mut HostVal) -> i32;
type Construct = unsafe extern "C" fn(u64, i32, *const HostVal, *mut HostVal) -> i32;

#[repr(C)]
pub struct HostOps {
    pub abi: u32,
    pub global_get: GlobalGet,
    pub get_prop: GetProp,
    pub set_prop: SetProp,
    pub call: Call,
    pub call_method: CallMethod,
    pub construct: Construct,
    pub instance_of: unsafe extern "C" fn(u64, u64) -> i32,
    pub is_callable: unsafe extern "C" fn(u64) -> i32,
    pub retain: unsafe extern "C" fn(u64),
    pub release: unsafe extern "C" fn(u64),
    pub io_pending: unsafe extern "C" fn() -> bool,
    pub io_poll: unsafe extern "C" fn(f64),
    // ABI 2
    pub new_object: unsafe extern "C" fn(*mut HostVal) -> i32,
    pub new_array: unsafe extern "C" fn(i32, *const HostVal, *mut HostVal) -> i32,
    pub is_array: unsafe extern "C" fn(u64) -> i32,
    pub own_keys: unsafe extern "C" fn(u64, *mut HostVal) -> i32,
    pub has_own: unsafe extern "C" fn(u64, *const u8, usize) -> i32,
    pub define_getter: unsafe extern "C" fn(u64, *const u8, usize, *const HostVal, *mut HostVal) -> i32,
    pub get_iterator: unsafe extern "C" fn(u64, *mut HostVal) -> i32,
    pub new_bytes: unsafe extern "C" fn(u32, *const u8, usize, *mut HostVal) -> i32,
    pub bytes_view: unsafe extern "C" fn(u64, *mut u32, *mut *const u8, *mut usize) -> i32,
    pub new_error: unsafe extern "C" fn(*const u8, usize, *const u8, usize, *mut HostVal) -> i32,
    pub new_promise: unsafe extern "C" fn(*mut HostVal) -> i32,
    pub settle_promise: unsafe extern "C" fn(u64, i32, *const HostVal),
    pub promise_subscribe: unsafe extern "C" fn(u64, values::Settled, *mut std::ffi::c_void) -> i32,
    pub module_call: unsafe extern "C" fn(*const u8, usize, *const u8, usize, i32, *const HostVal, *mut HostVal) -> i32,
    pub type_probe: unsafe extern "C" fn(u64, *const u8, usize) -> i32,
    pub inspect: unsafe extern "C" fn(u64, *mut HostVal) -> i32,
    // ABI 3
    pub new_bytes_owned: unsafe extern "C" fn(u32, *const u8, usize, *mut u8, *mut std::ffi::c_void, *mut HostVal) -> i32,
}

static OPS: HostOps = HostOps {
    abi: ABI,
    global_get: op_global_get,
    get_prop: op_get_prop,
    set_prop: op_set_prop,
    call: op_call,
    call_method: op_call_method,
    construct: op_construct,
    instance_of: op_instance_of,
    is_callable: op_is_callable,
    retain: op_retain,
    release: op_release,
    io_pending: op_io_pending,
    io_poll: op_io_poll,
    new_object: op_new_object,
    new_array: op_new_array,
    is_array: op_is_array,
    own_keys: op_own_keys,
    has_own: op_has_own,
    define_getter: op_define_getter,
    get_iterator: op_get_iterator,
    new_bytes: op_new_bytes,
    bytes_view: op_bytes_view,
    new_error: op_new_error,
    new_promise: op_new_promise,
    settle_promise: op_settle_promise,
    promise_subscribe: op_promise_subscribe,
    module_call: op_module_call,
    type_probe: op_type_probe,
    inspect: op_inspect,
    new_bytes_owned: op_new_bytes_owned,
};

unsafe extern "C" {
    fn scr_remote_set_wake(wake: unsafe extern "C" fn(*mut std::ffi::c_void), ctx: *mut std::ffi::c_void);
}

/// The runtime's remote inbox wakes this instance's loop through its waker: a post from another thread (a seam call,
/// an Atomics.waitAsync settle) lands while the loop sleeps in the host (its pool's wait, the window's), which the
/// inbox's own pipe does not end. Once per instance, on the thread that runs it (the island asks for the vtable once
/// per instance).
fn remote_wake_install() {
    thread_local! { static INSTALLED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
    if INSTALLED.with(|i| i.replace(true)) {
        return;
    }
    unsafe extern "C" fn wake(ctx: *mut std::ffi::c_void) {
        calls::posted(false);
        // SAFETY: ctx is the waker leaked below, alive for the process.
        unsafe { (*(ctx as *const crate::modules::Waker)).wake() };
    }
    // The main thread's loop may sleep in the window's event queue instead: window::wake ends both waits.
    unsafe extern "C" fn wake_main(_ctx: *mut std::ffi::c_void) {
        calls::posted(true);
        crate::window::wake();
    }
    if crate::render_thread::is_main_thread() {
        crate::window::init_main_waker();
        // SAFETY: a plain function; it takes no context.
        unsafe { scr_remote_set_wake(wake_main, std::ptr::null_mut()) };
        return;
    }
    let waker = Box::into_raw(Box::new(crate::modules::waker()));
    // SAFETY: a plain function and a pointer that stays valid (never freed).
    unsafe { scr_remote_set_wake(wake, waker.cast()) };
}

/// The vtable the runtime's host island asks for on first use.
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_ops() -> *const HostOps {
    // The layer's start (an installed program's protections, its log, a staged update; Android's environment).
    crate::layer::get().prepare();
    remote_wake_install();
    if !crate::render_thread::is_main_thread() {
        crate::relay::render_entered();
    }
    #[cfg(not(target_os = "android"))]
    crash_traces();
    // A throw no callback caught, or a rejection nothing handled, is reported as a browser reports it and the page
    // goes on, where the runtime's own policy is Node's: print and exit.
    #[cfg(not(target_os = "android"))]
    unsafe {
        let hook = &raw mut scr_uncaught_exception_hook;
        if (*hook).is_none() {
            *hook = Some(report_uncaught);
        }
    }
    #[cfg(target_os = "android")]
    unsafe {
        scr_host_install_uncaught_hook(report_uncaught);
    }
    &OPS
}

unsafe extern "C" fn report_uncaught(from_promise: bool) -> i32 {
    let _op = objects::Op::enter();
    // A worker's: printed, and an `error` event on its Worker object.
    if crate::workers::in_worker() {
        crate::workers::uncaught(if from_promise { "a worker's promise" } else { "a worker's task" });
        return 1;
    }
    crate::dom::report_exception(if from_promise { "a promise" } else { "a task" });
    1
}

/// A fault in the program (a SIGSEGV or SIGBUS) prints the faulting thread's stack, symbolized, before the process
/// dies: the native program has no debugger attached and the platform writes no report for every run. (Android writes
/// its own tombstone to logcat, and its libc has no backtrace().)
#[cfg(not(any(target_os = "android", windows)))]
fn crash_traces() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        unsafe extern "C" {
            fn backtrace(buffer: *mut *mut std::ffi::c_void, size: i32) -> i32;
            fn backtrace_symbols_fd(buffer: *const *mut std::ffi::c_void, size: i32, fd: i32);
            fn _exit(status: i32) -> !;
        }
        unsafe extern "C" {
            fn write(fd: i32, buf: *const std::ffi::c_void, n: usize) -> isize;
        }
        extern "C" fn on_fault(signum: i32, info: *const std::ffi::c_void, context: *const std::ffi::c_void) {
            let mut frames = [std::ptr::null_mut(); 64];
            // SAFETY: async-signal-safe calls only (backtrace, write through backtrace_symbols_fd, _exit).
            unsafe {
                let header = b"scriptc-host: fatal signal; stack:\n";
                write(2, header.as_ptr().cast(), header.len());
                fault_registers(info, context);
                let n = backtrace(frames.as_mut_ptr(), frames.len() as i32);
                backtrace_symbols_fd(frames.as_ptr(), n, 2);
                _exit(128 + signum);
            }
        }
        const SIGBUS: i32 = 10;
        const SIGSEGV: i32 = 11;
        // SAFETY: installing a handler that only makes async-signal-safe calls.
        unsafe {
            install_fault_handler(SIGSEGV, on_fault);
            install_fault_handler(SIGBUS, on_fault);
        }
    });
}

/// Windows: an unhandled exception (an access violation, a stack overflow) prints its code and address and the
/// faulting thread's stack, symbolized from the executable's PDB when one is beside it, before the process dies; so
/// does abort() (SIGABRT: the runtime's traps), which otherwise ends the process silently.
#[cfg(windows)]
fn crash_traces() {
    use windows_sys::Win32::System::Diagnostics::Debug::{EXCEPTION_POINTERS, SetUnhandledExceptionFilter};
    static ONCE: std::sync::Once = std::sync::Once::new();
    use windows_sys::Win32::System::Diagnostics::Debug::RtlCaptureStackBackTrace;
    use windows_sys::Win32::System::LibraryLoader::{
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, GetModuleFileNameW, GetModuleHandleExW,
    };
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    /// An address as `<module>+<offset>` (an image's file name and the address's distance from its base), which
    /// `llvm-symbolizer --obj=<image> --adjust-vma=<image base>` or a map file turns back into a function.
    fn place(address: usize) -> String {
        let mut module = std::ptr::null_mut();
        // SAFETY: a lookup by address that takes no reference; the name is written into the buffer given.
        unsafe {
            if address == 0
                || GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, address as *const u16, &mut module) == 0
            {
                return format!("{address:#x}");
            }
            let mut name = [0u16; 260];
            let n = GetModuleFileNameW(module, name.as_mut_ptr(), name.len() as u32) as usize;
            let path = String::from_utf16_lossy(&name[..n]);
            let file = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
            format!("{file}+{:#x}", address - module as usize)
        }
    }
    unsafe extern "system" fn on_fault(info: *const EXCEPTION_POINTERS) -> i32 {
        // SAFETY: the system's exception record for this fault, when it gave one.
        let record = unsafe { info.as_ref().and_then(|i| i.ExceptionRecord.as_ref()) };
        let (code, address) = record.map_or((0, std::ptr::null_mut()), |r| (r.ExceptionCode as u32, r.ExceptionAddress));
        // An access violation's kind (0 read, 1 write, 8 execute) and the address it touched.
        let access = record
            .filter(|r| code == 0xc000_0005 && r.NumberParameters >= 2)
            .map(|r| format!(", {} of {:#x}", match r.ExceptionInformation[0] { 0 => "read", 1 => "write", _ => "execute" }, r.ExceptionInformation[1]))
            .unwrap_or_default();
        // SAFETY: GetCurrentThreadId has no preconditions.
        let thread = unsafe { GetCurrentThreadId() };
        let which = if crate::render_thread::is_main_thread() { "the main thread" } else { "another thread" };
        eprintln!("scriptc-host: fatal exception {code:#010x} at {} ({address:?}){access}, on {which} ({thread}); frames:", place(address as usize));
        print_frames();
        // A minidump beside the logs (harden.rs), for the build's symbols.
        crate::harden::write_minidump(info);
        // EXCEPTION_CONTINUE_SEARCH: the system's own handling (Windows Error Reporting) goes on.
        0
    }
    /// The calling thread's stack: 64 raw frames as `<module>+<offset>`, then Rust's symbolized backtrace.
    fn print_frames() {
        let mut frames = [std::ptr::null_mut(); 64];
        // SAFETY: captures into the array given, at most its length.
        let n = unsafe { RtlCaptureStackBackTrace(0, frames.len() as u32, frames.as_mut_ptr(), std::ptr::null_mut()) } as usize;
        for (i, f) in frames[..n].iter().enumerate() {
            eprintln!("  {i:2}: {}", place(*f as usize));
        }
        eprintln!("{}", std::backtrace::Backtrace::force_capture());
    }
    /// abort() (the runtime's traps end in it): the C runtime raises SIGABRT, which by default ends the process
    /// with no report at all. The stack is printed first; returning lets abort finish as it would have.
    extern "C" fn on_abort(_signal: i32) {
        // SAFETY: GetCurrentThreadId has no preconditions.
        let thread = unsafe { GetCurrentThreadId() };
        let which = if crate::render_thread::is_main_thread() { "the main thread" } else { "another thread" };
        eprintln!("scriptc-host: abort() on {which} ({thread}); frames:");
        print_frames();
        crate::harden::write_minidump(std::ptr::null());
    }
    unsafe extern "C" {
        fn signal(signal: i32, handler: usize) -> usize;
    }
    const SIGABRT: i32 = 22;
    ONCE.call_once(|| {
        // SAFETY: installing a process-wide filter and an abort handler that only report.
        unsafe {
            SetUnhandledExceptionFilter(Some(on_fault));
            signal(SIGABRT, on_abort as extern "C" fn(i32) as usize);
        }
    });
}

#[cfg(not(any(target_os = "android", windows)))]
type FaultHandler = extern "C" fn(i32, *const std::ffi::c_void, *const std::ffi::c_void);

/// The main image's load address (its Mach-O header), read when the handler is installed.
#[cfg(not(any(target_os = "android", windows)))]
static IMAGE_BASE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// `sigaction` with SA_SIGINFO (the handler sees the faulting address and the interrupted registers); `signal`
/// where the layout is not spelled here.
#[cfg(not(any(target_os = "android", windows)))]
unsafe fn install_fault_handler(signum: i32, handler: FaultHandler) {
    #[cfg(target_os = "macos")]
    {
        // struct __sigaction: the handler, then sa_mask (u32), then sa_flags (i32).
        #[repr(C)]
        struct SigAction {
            handler: FaultHandler,
            mask: u32,
            flags: i32,
        }
        const SA_SIGINFO: i32 = 0x40;
        unsafe extern "C" {
            fn sigaction(signum: i32, act: *const SigAction, old: *mut SigAction) -> i32;
        }
        unsafe extern "C" {
            fn _dyld_get_image_header(index: u32) -> *const std::ffi::c_void;
        }
        // SAFETY: image 0 is the main executable, loaded for the process's life.
        IMAGE_BASE.store(unsafe { _dyld_get_image_header(0) } as u64, std::sync::atomic::Ordering::Relaxed);
        let act = SigAction { handler, mask: 0, flags: SA_SIGINFO };
        // SAFETY: a valid sigaction for a handler that only makes async-signal-safe calls.
        unsafe { sigaction(signum, &act, std::ptr::null_mut()) };
    }
    #[cfg(not(target_os = "macos"))]
    {
        unsafe extern "C" {
            fn signal(signum: i32, handler: FaultHandler) -> usize;
        }
        // SAFETY: as above; the extra arguments are ignored where the handler is installed without SA_SIGINFO.
        unsafe { signal(signum, handler) };
    }
}

/// The faulting address and the interrupted pc, lr, sp and fp on stderr (macOS arm64): a frameless leaf (a
/// thread-local getter, a runtime helper) leaves its caller as the backtrace's first frame, and a fiber's chain ends
/// early; these name the instruction itself. Async-signal-safe: fixed buffers and write(2).
#[cfg(not(any(target_os = "android", windows)))]
#[cfg_attr(not(all(target_os = "macos", target_arch = "aarch64")), allow(unused_variables))]
unsafe fn fault_registers(info: *const std::ffi::c_void, context: *const std::ffi::c_void) {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        unsafe extern "C" {
            fn write(fd: i32, buf: *const std::ffi::c_void, n: usize) -> isize;
        }
        if info.is_null() || context.is_null() {
            return;
        }
        // siginfo_t: si_signo, si_errno, si_code (i32 each), si_pid (i32), si_uid (u32), si_status (i32), si_addr.
        // ucontext_t: uc_mcontext (a pointer) at 48; __darwin_mcontext64: __es (far u64, esr u32, exception u32),
        // then __ss (x0..x28, fp, lr, sp, pc).
        // SAFETY: the kernel's siginfo and ucontext for this signal, read at their documented offsets.
        let (addr, regs) = unsafe {
            let addr = *(info as *const u8).add(24).cast::<u64>();
            let mc = *(context as *const u8).add(48).cast::<*const u64>();
            let ss = mc.add(2);
            (addr, [*ss.add(29), *ss.add(30), *ss.add(31), *ss.add(32), *ss, *ss.add(1)])
        };
        let mut line = [0u8; 160];
        let mut at = 0;
        let mut put = |bytes: &[u8]| {
            for b in bytes {
                if at < line.len() {
                    line[at] = *b;
                    at += 1;
                }
            }
        };
        let hex = |v: u64| {
            let mut out = [b'0'; 18];
            out[1] = b'x';
            for i in 0..16 {
                let d = ((v >> ((15 - i) * 4)) & 0xf) as u8;
                out[2 + i] = if d < 10 { b'0' + d } else { b'a' + d - 10 };
            }
            out
        };
        // The image's load address: `atos -o <binary> -l <image> <pc>` names the source line (the compiler's DWARF,
        // through the binary's debug map).
        put(b"  image ");
        put(&hex(IMAGE_BASE.load(std::sync::atomic::Ordering::Relaxed)));
        put(b" fault address ");
        put(&hex(addr));
        for (name, v) in [(&b" fp "[..], regs[0]), (b" lr ", regs[1]), (b" sp ", regs[2]), (b" pc ", regs[3]), (b" x0 ", regs[4]), (b" x1 ", regs[5])] {
            put(name);
            put(&hex(v));
        }
        put(b"\n");
        // SAFETY: write(2) of a stack buffer.
        unsafe { write(2, line.as_ptr().cast(), at) };
    }
}

unsafe extern "C" {
    fn scr_host_closure_call(closure: u64, argc: i32, argv: *const HostVal, out: *mut HostVal) -> i32;
    fn scr_host_closure_retain(closure: u64);
    fn scr_host_closure_release(closure: u64);
    fn scr_host_take_exception(out: *mut HostVal) -> i32;
    fn scr_host_object_disposed(obj: u64);
    fn scr_on_fiber() -> bool;
    /// The runtime's uncaught handler (scr_exception.c): > 0 handled, 0 not, < 0 the handler failed.
    #[cfg(not(target_os = "android"))]
    static mut scr_uncaught_exception_hook: Option<unsafe extern "C" fn(from_promise: bool) -> i32>;
    /// Android: the same hook set through the Android uncaught-hook glue, which reaches the thread-local variable a
    /// threaded runtime has (the link refuses a plain extern of a TLS symbol on ELF).
    #[cfg(target_os = "android")]
    fn scr_host_install_uncaught_hook(hook: unsafe extern "C" fn(from_promise: bool) -> i32);
}

/// Whether the program is running on one of its async fibers (a stack of the runtime's own, not the thread's).
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn on_fiber() -> bool {
    unsafe { scr_on_fiber() }
}

/// An object's last count is gone (its ref may name another object next): the program's weak collections drop it.
pub fn object_disposed(r: u64) {
    unsafe { scr_host_object_disposed(r) }
}

/// The exception a callback left pending, moved out of the program as a value the host owns (one count held).
pub fn take_exception() -> Option<Value> {
    let mut out = HostVal::UNDEFINED;
    if unsafe { scr_host_take_exception(&mut out) } == 0 {
        return None;
    }
    Some(unsafe { from_wire(&out) })
}

pub fn closure_retain(id: u64) {
    unsafe { scr_host_closure_retain(id) }
}

pub fn closure_release(id: u64) {
    unsafe { scr_host_closure_release(id) }
}

/// Calls a compiled function the program handed over. `Err` when it threw: the exception stays pending in the
/// program, and the loop reports it.
pub fn call_closure(id: u64, args: &[Value]) -> Result<Value, ()> {
    let _trace = calls::closure_span();
    let wire: Vec<HostVal> = args.iter().map(|a| to_wire_borrowed(a)).collect();
    let mut out = HostVal::UNDEFINED;
    let status = unsafe { scr_host_closure_call(id, wire.len() as i32, wire.as_ptr(), &mut out) };
    if status != OK {
        return Err(());
    }
    // The result is the program's; its string is copied, a reference retained, before the next call.
    Ok(unsafe { from_wire(&out) })
}

/// A wire value read as the host's own (strings copied; references borrowed, not retained).
unsafe fn from_wire(v: &HostVal) -> Value {
    match v.kind {
        KIND_NULL => Value::Null,
        KIND_BOOL => Value::Bool(v.flag != 0),
        KIND_NUMBER => Value::Number(v.number),
        KIND_STRING => {
            calls::count("string copied in (program to host)", v.len);
            Value::Str(unsafe { wire_str(v.str, v.len) }.to_string())
        }
        KIND_OBJECT => Value::Object(v.r#ref),
        KIND_CLOSURE => Value::Closure(v.r#ref),
        KIND_PROGRAM => Value::Program(v.r#ref),
        _ => Value::Undefined,
    }
}

unsafe fn wire_str<'a>(ptr: *const u8, len: usize) -> &'a str {
    if ptr.is_null() || len == 0 {
        return "";
    }
    // The program's strings are UTF-8 (scriptc's string representation).
    unsafe { std::str::from_utf8_unchecked(std::slice::from_raw_parts(ptr, len)) }
}

thread_local! {
    /// A string handed to the runtime stays readable until the next call (the runtime copies it at once).
    static SCRATCH: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// A value for the runtime to borrow (arguments to a callback, a settlement).
pub fn to_wire_borrowed(v: &Value) -> HostVal {
    let mut out = HostVal::UNDEFINED;
    match v {
        Value::Undefined => {}
        Value::Null => out.kind = KIND_NULL,
        Value::Bool(b) => { out.kind = KIND_BOOL; out.flag = *b as u32; }
        Value::Number(n) => { out.kind = KIND_NUMBER; out.number = *n; }
        Value::Str(s) => { out.kind = KIND_STRING; out.str = s.as_ptr(); out.len = s.len(); }
        Value::Object(r) => { out.kind = KIND_OBJECT; out.r#ref = *r; }
        Value::Closure(r) => { out.kind = KIND_CLOSURE; out.r#ref = *r; }
        Value::Program(r) => { out.kind = KIND_PROGRAM; out.r#ref = *r; }
    }
    out
}

/// A result for the runtime to own: a reference gains the count the runtime's cell will hold.
fn to_wire_owned(v: Value) -> HostVal {
    match v {
        Value::Object(r) => { objects::retain(r); to_wire_borrowed(&Value::Object(r)) }
        Value::Closure(r) => { closure_retain(r); to_wire_borrowed(&Value::Closure(r)) }
        Value::Program(r) => { closure_retain(r); to_wire_borrowed(&Value::Program(r)) }
        Value::Str(s) => SCRATCH.with(|scratch| {
            calls::count("string handed out (host to program)", s.len());
            let mut scratch = scratch.borrow_mut();
            if scratch.len() > 64 { scratch.drain(..32); }
            scratch.push(s);
            to_wire_borrowed(&Value::Str(String::new())).with_str(scratch.last().unwrap())
        }),
        other => to_wire_borrowed(&other),
    }
}

impl HostVal {
    fn with_str(mut self, s: &str) -> HostVal {
        self.kind = KIND_STRING;
        self.str = s.as_ptr();
        self.len = s.len();
        self
    }
}

fn finish(out: *mut HostVal, result: Result<Value, String>) -> i32 {
    // Fresh objects handed out keep only the count the runtime's cell now holds once the operation (objects::Op) ends.
    match result {
        Ok(v) => { unsafe { *out = to_wire_owned(v) }; OK }
        // A value the operation threw (`throw`) rather than a TypeError's message.
        Err(_) if THROWN.with(|t| t.borrow().is_some()) => finish_throw(out, THROWN.with(|t| t.borrow_mut().take()).unwrap()),
        Err(msg) => { unsafe { *out = to_wire_owned(Value::Str(msg)) }; THREW }
    }
}

thread_local! {
    static THROWN: RefCell<Option<Value>> = const { RefCell::new(None) };
}

/// An operation's failure that throws `v` (an Error object of another name than TypeError): the Err to return.
pub fn throw(v: Value) -> String {
    THROWN.with(|t| *t.borrow_mut() = Some(v));
    String::new()
}

/// A thrown host value (an Error object) rather than a TypeError message.
fn finish_throw(out: *mut HostVal, v: Value) -> i32 {
    unsafe { *out = to_wire_owned(v) };
    THREW
}

unsafe fn args<'a>(argc: i32, argv: *const HostVal) -> Vec<Value> {
    if argc <= 0 || argv.is_null() {
        return Vec::new();
    }
    calls::count("argument vector allocated", argc as usize);
    unsafe { std::slice::from_raw_parts(argv, argc as usize) }.iter().map(|v| unsafe { from_wire(v) }).collect()
}

/// A global read is a property read off the global object (the engine island's contract): a name the host does not
/// supply is undefined, so `typeof X` of an absent global answers "undefined". SCRIPTC_HOST_TRACE_GLOBALS=1 names
/// each absent one once on stderr.
unsafe extern "C" fn op_global_get(name: *const u8, len: usize, out: *mut HostVal) -> i32 {
    let name = unsafe { wire_str(name, len) };
    let _trace = calls::span(|| format!("global {name}"));
    let _op = objects::Op::enter();
    let value = objects::global(name).or_else(|_| {
        if std::env::var_os("SCRIPTC_HOST_TRACE_GLOBALS").is_some() {
            thread_local! { static NOTED: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) }; }
            NOTED.with(|n| {
                let mut n = n.borrow_mut();
                if !n.iter().any(|k| k == name) {
                    eprintln!("host: global '{name}' is not supplied (undefined)");
                    n.push(name.into());
                }
            });
        }
        Ok::<Value, String>(Value::Undefined)
    });
    finish(out, value)
}

unsafe extern "C" fn op_get_prop(obj: u64, name: *const u8, len: usize, out: *mut HostVal) -> i32 {
    let name = unsafe { wire_str(name, len) };
    let _trace = calls::span(|| format!("get {}.{}", objects::trace_label(obj), calls::member(name)));
    let _op = objects::Op::enter();
    finish(out, objects::get(obj, name))
}

unsafe extern "C" fn op_set_prop(obj: u64, name: *const u8, len: usize, value: *const HostVal, out: *mut HostVal) -> i32 {
    let name = unsafe { wire_str(name, len) };
    let _trace = calls::span(|| format!("set {}.{}", objects::trace_label(obj), calls::member(name)));
    let _op = objects::Op::enter();
    let value = unsafe { from_wire(&*value) };
    finish(out, objects::set(obj, name, value).map(|()| Value::Undefined))
}

unsafe extern "C" fn op_call(f: u64, this: u64, argc: i32, argv: *const HostVal, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| format!("call {}", objects::trace_label(f)));
    let _op = objects::Op::enter();
    finish(out, objects::call(f, (this != 0).then_some(this), &unsafe { args(argc, argv) }))
}

unsafe extern "C" fn op_call_method(obj: u64, name: *const u8, len: usize, argc: i32, argv: *const HostVal, out: *mut HostVal) -> i32 {
    let name = unsafe { wire_str(name, len) };
    let _trace = calls::span(|| format!("call {}.{}()", objects::trace_label(obj), name));
    let _op = objects::Op::enter();
    finish(out, objects::call_method(obj, name, &unsafe { args(argc, argv) }))
}

unsafe extern "C" fn op_construct(ctor: u64, argc: i32, argv: *const HostVal, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| format!("new {}", objects::trace_label(ctor)));
    let _op = objects::Op::enter();
    finish(out, objects::construct(ctor, &unsafe { args(argc, argv) }))
}

unsafe extern "C" fn op_instance_of(obj: u64, ctor: u64) -> i32 {
    let _trace = calls::span(|| "instanceof".to_string());
    objects::instance_of(obj, ctor) as i32
}

unsafe extern "C" fn op_is_callable(obj: u64) -> i32 {
    let _trace = calls::span(|| "is_callable".to_string());
    objects::is_callable(obj) as i32
}

unsafe extern "C" fn op_retain(obj: u64) {
    calls::count("retain (program)", 0);
    objects::retain(obj)
}

unsafe extern "C" fn op_release(obj: u64) {
    let _trace = calls::span(|| "release (program)".to_string());
    objects::release(obj)
}

unsafe extern "C" fn op_io_pending() -> bool {
    timers::pending()
        || values::jobs_pending()
        || modules::pending()
        || crate::layer::get().io_pending()
        || crate::page::popstate_owed()
        || crate::render_thread::canvases_pending()
        || crate::channels::pending()
        || rtc_pending()
        || audio_pending()
}

/// Web Audio's tasks wait, or a playing source has `ended` listeners (audio.rs).
fn audio_pending() -> bool {
    #[cfg(all(windows, feature = "audio"))]
    {
        crate::audio::pending()
    }
    #[cfg(not(all(windows, feature = "audio")))]
    {
        false
    }
}

/// Web Audio's tasks wait to be run now (audio.rs): the loop does not sleep.
fn audio_due() -> bool {
    #[cfg(all(windows, feature = "audio"))]
    {
        crate::audio::due()
    }
    #[cfg(not(all(windows, feature = "audio")))]
    {
        false
    }
}

/// Takes the audio engines' events and runs Web Audio's due tasks (audio.rs); true when a handler threw.
fn audio_run() -> bool {
    #[cfg(all(windows, feature = "audio"))]
    {
        crate::audio::run()
    }
    #[cfg(not(all(windows, feature = "audio")))]
    {
        false
    }
}

/// WebRTC's posts wait, or a connection is open (rtc.rs).
fn rtc_pending() -> bool {
    #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
    {
        crate::rtc::pending()
    }
    #[cfg(not(all(any(windows, target_os = "android"), feature = "webrtc")))]
    {
        false
    }
}

/// WebRTC's posts wait to be run now (rtc.rs): the loop does not sleep.
fn rtc_due() -> bool {
    #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
    {
        crate::rtc::due()
    }
    #[cfg(not(all(any(windows, target_os = "android"), feature = "webrtc")))]
    {
        false
    }
}

/// Runs WebRTC's due posts (rtc.rs); true when a handler threw.
fn rtc_run() -> bool {
    #[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
    {
        crate::rtc::run()
    }
    #[cfg(not(all(any(windows, target_os = "android"), feature = "webrtc")))]
    {
        false
    }
}

/// The longest a loop turn sleeps while a GPU ticket is waited for: the device is polled once per turn
/// (modules.rs `settle_ticket_waits`), so this bounds how late a readback is seen.
const TICKET_TURN_MS: f64 = 1.0;

/// One loop turn: promise reactions due now, then a sleep (on the module workers' completions when any are in
/// flight) no longer than the loop allows nor past the earliest timer, then the due timers and what they queued.
unsafe extern "C" fn op_io_poll(max_wait_ms: f64) {
    let _op = objects::Op::enter();
    values::run_jobs();
    // history.back/forward/go's popstate: a task of its own.
    if crate::page::popstate_owed() {
        crate::page::deliver_popstate();
        values::run_jobs();
        return;
    }
    // Another launch's link (launch.rs): a fragment navigation, a task of its own.
    if crate::page::fragment_owed() {
        crate::page::deliver_fragment();
        values::run_jobs();
        return;
    }
    // A message task (channels.rs) waits: no sleep.
    let mut wait = if values::jobs_pending() || crate::channels::pending() || rtc_due() || audio_due() { 0.0 } else { max_wait_ms.max(0.0) };
    if let Some(t) = timers::until_next_ms() {
        wait = wait.min(t);
    }
    let tickets = crate::layer::get().io_pending();
    if tickets {
        wait = wait.min(TICKET_TURN_MS);
    }
    if modules::pending() {
        // A worker's long wait (a layer's thread waits) is nearly always in flight: with a window open the wait
        // ends by the window's next frame, so the next turn takes the window's input and frames (it stalled up to the
        // loop's whole deadline, seconds, between frames).
        modules::wait(crate::window::frame_wait_ms().map_or(wait, |p| wait.min(p)));
    } else if wait > 0.0 && timers::pending() {
        timers::sleep(wait);
    } else if wait > 0.0 && (crate::render_thread::canvases_pending() || tickets) {
        // A render thread waits on the page's canvas: the hand-over wakes it. A ticket wait sleeps the short turn.
        modules::sleep(wait);
    }
    crate::render_thread::poll_canvases();
    // GPU ticket waits (a layer's GPU waits): the device polled, the completed ones settled.
    crate::layer::get().io_poll();
    // A throw is pending in the program: the loop reports it before anything else runs.
    if crate::channels::run() || rtc_run() || audio_run() || crate::page::poll_visual_viewport() || timers::run_due() {
        return;
    }
    // Once more after the turn's tasks and its frame ([`settle_after_frame`]).
    if settle_after_frame() {
        crate::layer::get().io_poll();
    }
    values::run_jobs();
}

/// The GPU's ticket waits are settled again at the end of the turn, after its timers and its window frame, and the
/// reactions they settle run then (SCRIPTC_HOST_SETTLE_AFTER_FRAME=0: only before them, as before). Settled only
/// before, a frame's `onSubmittedWorkDone` (a renderer's frames-in-flight count) was seen two
/// turns after the GPU finished: the program's reactions to it (an async function's `await`, then its caller's `then`)
/// ran only after the next frame's callbacks. With two frames counted in flight, every third refresh was skipped as
/// "GPU behind" while the GPU sat idle (the swapchain's acquire never waits): 31-41% of presented frames carried no new
/// scene. Settled here, they run before the next frame's callbacks, as a browser's run before its next rendering step.
/// A render thread's frame (timers::run_due's render_frame) gets the same.
fn settle_after_frame() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("SCRIPTC_HOST_SETTLE_AFTER_FRAME").as_deref() != Ok("0"))
}

/// SCRIPTC_HOST_TRACE_CALLS=1 (or `=<frames>`, default 300): the traffic between the compiled program and the host,
/// on stderr every that many window frames (observers.rs `deliver` counts them): each host operation keyed by what it
/// touched (`get CSSStyleDeclaration.transform`, `call node <div>.getBoundingClientRect()`, `module my:module.f`,
/// a document `resolve (...)`), with its count and its own time per frame (a nested operation's time is its own, not
/// its caller's); a callback into the program (`closure`) is the program's time. Counters beside: strings and typed
/// arrays copied across, retains and releases, document mutations. Off, each operation pays one relaxed load.
pub mod calls {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
    use std::time::Instant;

    static STATE: AtomicU8 = AtomicU8::new(0);
    static EVERY: AtomicU64 = AtomicU64::new(300);

    /// Whether the trace is on (read once).
    #[inline]
    pub fn on() -> bool {
        match STATE.load(Ordering::Relaxed) {
            1 => false,
            2 => true,
            _ => init(),
        }
    }

    #[cold]
    fn init() -> bool {
        let v = std::env::var("SCRIPTC_HOST_TRACE_CALLS").ok();
        let on = v.as_deref().is_some_and(|v| !v.is_empty() && v != "0");
        if let Some(n) = v.as_deref().and_then(|v| v.parse::<u64>().ok()).filter(|n| *n > 1) {
            EVERY.store(n, Ordering::Relaxed);
        }
        STATE.store(if on { 2 } else { 1 }, Ordering::Relaxed);
        on
    }

    #[derive(Default, Clone, Copy)]
    struct Stat {
        count: u64,
        self_ns: u64,
        incl_ns: u64,
    }

    #[derive(Default)]
    struct Trace {
        stats: HashMap<String, Stat>,
        counters: HashMap<&'static str, (u64, u64)>,
        /// Open spans: key, start, time of the spans nested in it.
        stack: Vec<(String, Instant, u64)>,
        frames: u64,
        since: Option<Instant>,
        /// This frame's host time (own time of every span but the program's), and each frame's, for percentiles.
        frame_host_ns: u64,
        frame_program_ns: u64,
        per_frame: Vec<(u64, u64)>,
        /// What one span costs the trace itself (measured once).
        span_ns: f64,
        /// This frame's host operations (spans but the program's), and each frame's.
        frame_ops: u64,
        ops_per_frame: Vec<u64>,
        /// A render thread's frame callbacks ([`callback`]): this frame's wall time and the thread's own CPU cycles in
        /// them, and each frame's. Wall minus CPU is time the thread was off the CPU inside its own frame: the
        /// lock-step seam calls' waits (seam-threads.c ui_frame/ui_events), a lock, a page fault.
        frame_cb: (u64, u64),
        per_frame_cb: Vec<(u64, u64)>,
        /// The process's cross-thread posts ([`posted`]) at this thread's last report.
        posts_seen: [u64; 2],
    }

    thread_local! {
        static T: RefCell<Trace> = RefCell::new(Trace::default());
    }

    /// One timed operation; ends when dropped.
    pub struct Span(bool);

    #[inline]
    pub fn span(key: impl FnOnce() -> String) -> Span {
        if !on() {
            return Span(false);
        }
        open(key())
    }

    fn open(key: String) -> Span {
        T.with(|t| t.borrow_mut().stack.push((key, Instant::now(), 0)));
        Span(true)
    }

    /// A callback into the program: a task's (nothing of the host's open) or one a host operation runs.
    pub fn closure_span() -> Span {
        if !on() {
            return Span(false);
        }
        let key = T.with(|t| match t.borrow().stack.last() {
            None => "closure (a task)".to_string(),
            Some((parent, ..)) if parent.starts_with("closure") => "closure (from the program)".to_string(),
            Some((parent, ..)) => format!("closure (from {parent})"),
        });
        open(key)
    }

    impl Drop for Span {
        fn drop(&mut self) {
            if !self.0 {
                return;
            }
            let end = Instant::now();
            T.with(|t| {
                let mut t = t.borrow_mut();
                let Some((key, start, child)) = t.stack.pop() else { return };
                let incl = (end - start).as_nanos() as u64;
                let own = incl.saturating_sub(child);
                if key.starts_with("closure") {
                    t.frame_program_ns += own;
                } else {
                    t.frame_host_ns += own;
                    t.frame_ops += 1;
                }
                let s = t.stats.entry(key).or_default();
                s.count += 1;
                s.incl_ns += incl;
                s.self_ns += own;
                if let Some(p) = t.stack.last_mut() {
                    p.2 += incl;
                }
            });
        }
    }

    /// An event counted (with a size: bytes copied, say).
    #[inline]
    pub fn count(what: &'static str, size: usize) {
        if !on() {
            return;
        }
        T.with(|t| {
            let mut t = t.borrow_mut();
            let c = t.counters.entry(what).or_default();
            c.0 += 1;
            c.1 += size as u64;
        });
    }

    /// The runtime's remote inbox was posted a task (abi.rs `remote_wake_install`: every `scr_remote_post` rings its
    /// target's doorbell once): to the main thread's loop (a lock-step seam call) or to
    /// another's (a piece's mail, an Atomics.waitAsync settle). Counted process-wide.
    static POSTS: [AtomicU64; 2] = [AtomicU64::new(0), AtomicU64::new(0)];

    #[inline]
    pub fn posted(to_main: bool) {
        if on() {
            POSTS[usize::from(!to_main)].fetch_add(1, Ordering::Relaxed);
        }
    }

    /// The calling thread's CPU cycles so far (QueryThreadCycleTime); 0 where there is none.
    fn thread_cycles() -> u64 {
        #[cfg(windows)]
        {
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn QueryThreadCycleTime(thread: *mut std::ffi::c_void, cycles: *mut u64) -> i32;
                fn GetCurrentThread() -> *mut std::ffi::c_void;
            }
            let mut c = 0u64;
            // SAFETY: the calling thread's pseudo handle and a u64 to write.
            unsafe { QueryThreadCycleTime(GetCurrentThread(), &mut c) };
            c
        }
        #[cfg(not(windows))]
        {
            0
        }
    }

    /// Thread cycles per nanosecond (the TSC's rate, which QueryThreadCycleTime counts in), measured once over a 3 ms
    /// spin.
    fn cycles_per_ns() -> f64 {
        static RATE: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
        *RATE.get_or_init(|| {
            let (t0, c0) = (Instant::now(), thread_cycles());
            while t0.elapsed().as_micros() < 3000 {
                std::hint::spin_loop();
            }
            let ns = t0.elapsed().as_nanos() as f64;
            ((thread_cycles() - c0) as f64 / ns).max(1e-9)
        })
    }

    /// A render thread's frame callback (timers.rs): its wall time and the thread's CPU time in it.
    pub struct Callback(Option<(Instant, u64)>);

    #[inline]
    pub fn callback() -> Callback {
        if !on() {
            return Callback(None);
        }
        Callback(Some((Instant::now(), thread_cycles())))
    }

    impl Drop for Callback {
        fn drop(&mut self) {
            let Some((start, cycles)) = self.0 else { return };
            let wall = start.elapsed().as_nanos() as u64;
            let cpu = thread_cycles().saturating_sub(cycles);
            T.with(|t| {
                let mut t = t.borrow_mut();
                t.frame_cb.0 += wall;
                t.frame_cb.1 += cpu;
            });
        }
    }

    /// A render thread's frame begins (timers.rs): its report counts these, as the window's counts its own frames.
    #[inline]
    pub fn render_frame() {
        if on() && !crate::render_thread::is_main_thread() {
            frame();
        }
    }

    /// A member's name as a key: an index is `[i]`.
    pub fn member(name: &str) -> &str {
        if !name.is_empty() && name.bytes().all(|b| b.is_ascii_digit()) { "[i]" } else { name }
    }

    /// One window frame ended (its callbacks ran): every `EVERY` frames, the report.
    pub fn frame() {
        if !on() {
            return;
        }
        let every = EVERY.load(Ordering::Relaxed);
        // The trace's own cost per span (a key of the usual size made, the span opened and closed), measured once,
        // with no span open.
        let calibrate = T.with(|t| {
            let t = t.borrow();
            t.span_ns == 0.0 && t.stack.is_empty()
        });
        let span_ns = calibrate.then(|| {
            let start = Instant::now();
            for i in 0..2000 {
                drop(span(|| format!("get trace calibration.key{}", i & 1)));
            }
            (start.elapsed().as_nanos() as f64 / 2000.0).max(1.0)
        });
        let report = T.with(|t| {
            let mut t = t.borrow_mut();
            if let Some(ns) = span_ns {
                t.span_ns = ns;
                t.frame_host_ns = 0;
                t.frame_ops = 0;
                t.frame_cb = (0, 0);
                t.posts_seen = [POSTS[0].load(Ordering::Relaxed), POSTS[1].load(Ordering::Relaxed)];
                t.since = Some(Instant::now());
                t.stats.clear();
                t.counters.clear();
                return None;
            }
            t.frames += 1;
            let f = (t.frame_host_ns, t.frame_program_ns);
            t.per_frame.push(f);
            t.frame_host_ns = 0;
            t.frame_program_ns = 0;
            let ops = std::mem::take(&mut t.frame_ops);
            t.ops_per_frame.push(ops);
            let cb = std::mem::take(&mut t.frame_cb);
            t.per_frame_cb.push(cb);
            if t.frames % every != 0 {
                return None;
            }
            let secs = t.since.map_or(0.0, |s| s.elapsed().as_secs_f64());
            t.since = Some(Instant::now());
            let stats: Vec<(String, Stat)> = std::mem::take(&mut t.stats).into_iter().collect();
            let counters: Vec<(&'static str, (u64, u64))> = std::mem::take(&mut t.counters).into_iter().collect();
            let per_frame = std::mem::take(&mut t.per_frame);
            let ops_per_frame = std::mem::take(&mut t.ops_per_frame);
            let per_frame_cb = std::mem::take(&mut t.per_frame_cb);
            let posts_now = [POSTS[0].load(Ordering::Relaxed), POSTS[1].load(Ordering::Relaxed)];
            let posts = [posts_now[0] - t.posts_seen[0], posts_now[1] - t.posts_seen[1]];
            t.posts_seen = posts_now;
            Some((t.frames, secs, stats, counters, per_frame, t.span_ns, (ops_per_frame, per_frame_cb, posts)))
        });
        let Some((frames, secs, mut stats, mut counters, per_frame, span_ns, (ops_per_frame, per_frame_cb, posts))) = report else { return };
        let n = per_frame.len().max(1) as f64;
        let ms = |ns: u64| ns as f64 / 1e6;
        let pct = |mut v: Vec<u64>, q: f64| {
            v.sort_unstable();
            v.get(((v.len() as f64 * q) as usize).min(v.len().saturating_sub(1))).copied().unwrap_or(0)
        };
        let host: Vec<u64> = per_frame.iter().map(|f| f.0).collect();
        let program: Vec<u64> = per_frame.iter().map(|f| f.1).collect();
        let ops: u64 = stats.iter().filter(|(k, _)| !k.starts_with("closure")).map(|(_, s)| s.count).sum();
        let mut out = String::new();
        use std::fmt::Write;
        let _ = writeln!(
            out,
            "host calls: frames to {frames}, {} in {secs:.1} s ({:.1} fps): per frame {:.0} host ops; host own time mean {:.3} ms, p50 {:.3}, p95 {:.3}, max {:.3}; program (closures) mean {:.3} ms, p95 {:.3}; trace overhead ~{:.3} ms/frame ({span_ns:.0} ns/span)",
            per_frame.len(),
            per_frame.len() as f64 / secs.max(1e-9),
            ops as f64 / n,
            ms(host.iter().sum::<u64>()) / n,
            ms(pct(host.clone(), 0.5)),
            ms(pct(host.clone(), 0.95)),
            ms(host.iter().copied().max().unwrap_or(0)),
            ms(program.iter().sum::<u64>()) / n,
            ms(pct(program, 0.95)),
            ops as f64 / n * span_ns / 1e6,
        );
        let thread = if crate::render_thread::is_main_thread() { "main" } else { "render" };
        let _ = writeln!(
            out,
            "  [{thread}] host ops per frame p50 {}, p95 {}, max {}; cross-thread posts per frame: to main {:.2}, to other loops {:.2}",
            pct(ops_per_frame.clone(), 0.5),
            pct(ops_per_frame.clone(), 0.95),
            ops_per_frame.iter().copied().max().unwrap_or(0),
            posts[0] as f64 / n,
            posts[1] as f64 / n,
        );
        if per_frame_cb.iter().any(|c| c.0 > 0) {
            let rate = cycles_per_ns();
            let wall: Vec<u64> = per_frame_cb.iter().map(|c| c.0).collect();
            let cpu: Vec<u64> = per_frame_cb.iter().map(|c| ((c.1 as f64 / rate) as u64).min(c.0)).collect();
            let off: Vec<u64> = wall.iter().zip(&cpu).map(|(w, c)| w - c).collect();
            let _ = writeln!(
                out,
                "  [{thread}] frame callbacks: wall mean {:.3} ms p50 {:.3} p95 {:.3}; on CPU mean {:.3} p50 {:.3}; off CPU (waits) mean {:.3} p50 {:.3} p95 {:.3}",
                ms(wall.iter().sum::<u64>()) / n,
                ms(pct(wall.clone(), 0.5)),
                ms(pct(wall, 0.95)),
                ms(cpu.iter().sum::<u64>()) / n,
                ms(pct(cpu, 0.5)),
                ms(off.iter().sum::<u64>()) / n,
                ms(pct(off.clone(), 0.5)),
                ms(pct(off, 0.95)),
            );
        }
        stats.sort_by(|a, b| b.1.self_ns.cmp(&a.1.self_ns));
        let _ = writeln!(out, "  by own time (per frame: count, own ms, incl ms; mean own us):");
        for (k, s) in stats.iter().take(40) {
            let _ = writeln!(out, "    {:>9.2} {:>8.3} {:>8.3} {:>8.2}  {k}", s.count as f64 / n, ms(s.self_ns) / n, ms(s.incl_ns) / n, s.self_ns as f64 / 1e3 / s.count.max(1) as f64);
        }
        stats.sort_by(|a, b| b.1.count.cmp(&a.1.count));
        let _ = writeln!(out, "  by count (per frame: count, own ms; mean own us):");
        for (k, s) in stats.iter().take(40) {
            let _ = writeln!(out, "    {:>9.2} {:>8.3} {:>8.2}  {k}", s.count as f64 / n, ms(s.self_ns) / n, s.self_ns as f64 / 1e3 / s.count.max(1) as f64);
        }
        counters.sort_by(|a, b| b.1.0.cmp(&a.1.0));
        let _ = writeln!(out, "  counters (per frame: events, bytes):");
        for (k, (c, b)) in &counters {
            let _ = writeln!(out, "    {:>9.2} {:>10.0}  {k}", *c as f64 / n, *b as f64 / n);
        }
        eprint!("{out}");
    }
}

unsafe fn name_of<'a>(ptr: *const u8, len: usize) -> &'a str {
    unsafe { wire_str(ptr, len) }
}

unsafe extern "C" fn op_new_object(out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "new_object".to_string());
    let _op = objects::Op::enter();
    finish(out, Ok(values::new_object()))
}

unsafe extern "C" fn op_new_array(argc: i32, argv: *const HostVal, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "new_array".to_string());
    let _op = objects::Op::enter();
    finish(out, Ok(values::new_array(&unsafe { args(argc, argv) })))
}

unsafe extern "C" fn op_is_array(obj: u64) -> i32 {
    let _trace = calls::span(|| "is_array".to_string());
    values::is_array(obj) as i32
}

unsafe extern "C" fn op_own_keys(obj: u64, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| format!("own_keys {}", objects::trace_label(obj)));
    let _op = objects::Op::enter();
    let keys: Vec<Value> = objects::own_keys(obj).into_iter().map(Value::Str).collect();
    finish(out, Ok(values::new_array(&keys)))
}

unsafe extern "C" fn op_has_own(obj: u64, name: *const u8, len: usize) -> i32 {
    let _trace = calls::span(|| "has_own".to_string());
    values::has_own(obj, unsafe { name_of(name, len) }) as i32
}

unsafe extern "C" fn op_define_getter(obj: u64, name: *const u8, len: usize, getter: *const HostVal, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "define_getter".to_string());
    let _op = objects::Op::enter();
    let getter = unsafe { from_wire(&*getter) };
    finish(out, values::define_getter(obj, unsafe { name_of(name, len) }, getter).map(|()| Value::Undefined))
}

unsafe extern "C" fn op_get_iterator(obj: u64, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| format!("get_iterator {}", objects::trace_label(obj)));
    let _op = objects::Op::enter();
    finish(out, objects::iterator(obj))
}

unsafe extern "C" fn op_new_bytes(elem: u32, data: *const u8, len: usize, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "new_bytes (typed array copied in)".to_string());
    calls::count("typed array copied in", len);
    let _op = objects::Op::enter();
    let bytes = if data.is_null() || len == 0 { Vec::new() } else { unsafe { std::slice::from_raw_parts(data, len) }.to_vec() };
    finish(out, Ok(values::new_bytes(elem, bytes)))
}

/// A compiled typed array crossing in: the host's copy, which also holds the compiled array's storage (`owner` +1) for
/// a host function that writes its caller's array in place ([`values::bytes_storage`]).
unsafe extern "C" fn op_new_bytes_owned(elem: u32, data: *const u8, len: usize, storage: *mut u8, owner: *mut std::ffi::c_void, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "new_bytes_owned (typed array copied in)".to_string());
    calls::count("typed array copied in", len);
    let _op = objects::Op::enter();
    let bytes = if data.is_null() || len == 0 { Vec::new() } else { unsafe { std::slice::from_raw_parts(data, len) }.to_vec() };
    finish(out, Ok(values::new_bytes_owned(elem, bytes, values::Storage { at: storage, len, owner })))
}

unsafe extern "C" fn op_bytes_view(obj: u64, elem: *mut u32, data: *mut *const u8, len: *mut usize) -> i32 {
    let _trace = calls::span(|| "bytes_view".to_string());
    match values::bytes_view(obj) {
        Some((e, p, n)) => {
            unsafe { *elem = e; *data = p; *len = n };
            1
        }
        None => 0,
    }
}

unsafe extern "C" fn op_new_error(name: *const u8, name_len: usize, message: *const u8, message_len: usize, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "new_error".to_string());
    let _op = objects::Op::enter();
    finish(out, Ok(values::new_error(unsafe { name_of(name, name_len) }, unsafe { name_of(message, message_len) })))
}

unsafe extern "C" fn op_new_promise(out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "new_promise".to_string());
    let _op = objects::Op::enter();
    finish(out, Ok(values::new_promise()))
}

unsafe extern "C" fn op_settle_promise(promise: u64, rejected: i32, value: *const HostVal) {
    let _trace = calls::span(|| "settle_promise".to_string());
    let _op = objects::Op::enter();
    values::settle(promise, rejected != 0, &unsafe { from_wire(&*value) });
}

unsafe extern "C" fn op_promise_subscribe(obj: u64, settled: values::Settled, ctx: *mut std::ffi::c_void) -> i32 {
    let _trace = calls::span(|| "promise_subscribe".to_string());
    values::subscribe(obj, settled, ctx as usize) as i32
}

unsafe extern "C" fn op_module_call(module: *const u8, module_len: usize, name: *const u8, name_len: usize, argc: i32, argv: *const HostVal, out: *mut HostVal) -> i32 {
    let (module, name) = unsafe { (name_of(module, module_len), name_of(name, name_len)) };
    let _trace = calls::span(|| format!("module {module}.{name}"));
    let _op = objects::Op::enter();
    match modules::call(module, name, &unsafe { args(argc, argv) }) {
        Ok(v) => finish(out, Ok(v)),
        Err(modules::Failure::Message(m)) => finish(out, Err(m)),
        Err(modules::Failure::Thrown(v)) => finish_throw(out, v),
    }
}

unsafe extern "C" fn op_type_probe(obj: u64, probe: *const u8, len: usize) -> i32 {
    let _trace = calls::span(|| "type_probe".to_string());
    values::type_probe(obj, unsafe { name_of(probe, len) }) as i32
}

unsafe extern "C" fn op_inspect(obj: u64, out: *mut HostVal) -> i32 {
    let _trace = calls::span(|| "inspect".to_string());
    let _op = objects::Op::enter();
    let v = Value::Object(obj);
    finish(out, Ok(Value::Str(values::inspect(&v, 0).unwrap_or_else(|| objects::to_display(&v)))))
}

/// The layout of `ScrHostVal` and `ScrHostOps` as this crate lays them out: sizes, each field's offset in order, and the
/// value kinds, as JSON (the C side prints the same from the header: the ABI drift test compares the two).
pub fn layout_json() -> String {
    use std::mem::{offset_of, size_of};
    let val = [
        ("kind", offset_of!(HostVal, kind)),
        ("flag", offset_of!(HostVal, flag)),
        ("number", offset_of!(HostVal, number)),
        ("str", offset_of!(HostVal, str)),
        ("len", offset_of!(HostVal, len)),
        ("ref", offset_of!(HostVal, r#ref)),
    ];
    let ops = [
        ("abi", offset_of!(HostOps, abi)),
        ("global_get", offset_of!(HostOps, global_get)),
        ("get_prop", offset_of!(HostOps, get_prop)),
        ("set_prop", offset_of!(HostOps, set_prop)),
        ("call", offset_of!(HostOps, call)),
        ("call_method", offset_of!(HostOps, call_method)),
        ("construct", offset_of!(HostOps, construct)),
        ("instance_of", offset_of!(HostOps, instance_of)),
        ("is_callable", offset_of!(HostOps, is_callable)),
        ("retain", offset_of!(HostOps, retain)),
        ("release", offset_of!(HostOps, release)),
        ("io_pending", offset_of!(HostOps, io_pending)),
        ("io_poll", offset_of!(HostOps, io_poll)),
        ("new_object", offset_of!(HostOps, new_object)),
        ("new_array", offset_of!(HostOps, new_array)),
        ("is_array", offset_of!(HostOps, is_array)),
        ("own_keys", offset_of!(HostOps, own_keys)),
        ("has_own", offset_of!(HostOps, has_own)),
        ("define_getter", offset_of!(HostOps, define_getter)),
        ("get_iterator", offset_of!(HostOps, get_iterator)),
        ("new_bytes", offset_of!(HostOps, new_bytes)),
        ("bytes_view", offset_of!(HostOps, bytes_view)),
        ("new_error", offset_of!(HostOps, new_error)),
        ("new_promise", offset_of!(HostOps, new_promise)),
        ("settle_promise", offset_of!(HostOps, settle_promise)),
        ("promise_subscribe", offset_of!(HostOps, promise_subscribe)),
        ("module_call", offset_of!(HostOps, module_call)),
        ("type_probe", offset_of!(HostOps, type_probe)),
        ("inspect", offset_of!(HostOps, inspect)),
        ("new_bytes_owned", offset_of!(HostOps, new_bytes_owned)),
    ];
    let fields = |f: &[(&str, usize)]| f.iter().map(|(n, o)| format!("{{\"name\":\"{n}\",\"offset\":{o}}}")).collect::<Vec<_>>().join(",");
    let kinds = [
        ("SCR_HV_UNDEFINED", KIND_UNDEFINED),
        ("SCR_HV_NULL", KIND_NULL),
        ("SCR_HV_BOOL", KIND_BOOL),
        ("SCR_HV_NUMBER", KIND_NUMBER),
        ("SCR_HV_STRING", KIND_STRING),
        ("SCR_HV_OBJECT", KIND_OBJECT),
        ("SCR_HV_CLOSURE", KIND_CLOSURE),
        ("SCR_HV_PROGRAM", KIND_PROGRAM),
    ];
    format!(
        "{{\"abi\":{ABI},\"ScrHostVal\":{{\"size\":{},\"fields\":[{}]}},\"ScrHostOps\":{{\"size\":{},\"fields\":[{}]}},\"constants\":{{{},\"SCR_HOST_OK\":{OK},\"SCR_HOST_THREW\":{THREW}}}}}",
        size_of::<HostVal>(),
        fields(&val),
        size_of::<HostOps>(),
        fields(&ops),
        kinds.iter().map(|(n, v)| format!("\"{n}\":{v}")).collect::<Vec<_>>().join(","),
    )
}

/// The names of `ScrHostOps`'s fields in this crate's order.
pub fn ops_field_names() -> Vec<String> {
    let json = layout_json();
    let ops = &json[json.find("\"ScrHostOps\"").unwrap()..];
    ops.match_indices("\"name\":\"").map(|(i, m)| {
        let rest = &ops[i + m.len()..];
        rest[..rest.find('"').unwrap()].to_string()
    }).collect()
}
