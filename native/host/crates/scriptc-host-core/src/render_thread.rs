//! A program's second thread (a render thread: pieces that run on a thread of their own, with no window and no
//! document, as a page's worker does): which thread is the main one, what a worker-like scope does not define
//! ([`hides`]), the window's focus, and the canvases the main thread hands over (relay.rs), each a proxy here whose
//! size is the window's to read. A layer gives such a thread its view of the page (its globals: layer.rs).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::objects::{self, Value};

/// Whether the main window has focus (the main thread's window sets it; true until it says otherwise).
pub static FOCUSED: AtomicBool = AtomicBool::new(true);

/// Whether this is the process's main thread: the window's, the document's and AppKit's.
pub fn is_main_thread() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn pthread_main_np() -> i32;
        }
        // SAFETY: a plain query of the calling thread.
        unsafe { pthread_main_np() != 0 }
    }
    // Windows: the process's first thread (the earliest created), whichever thread asks first. The threaded boot runs
    // the render thread's pieces before the ui's, so the first to enter the host is the render thread there.
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::GetCurrentThreadId;
        static MAIN: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
        // SAFETY: GetCurrentThreadId has no preconditions.
        *MAIN.get_or_init(first_thread_id) == unsafe { GetCurrentThreadId() }
    }
    // Android: the thread libmatoya ran the program's `main` on (the Android entry glue, android-main.c, linked with
    // --wrap=main): the threaded boot's render thread enters the host first, so "first in" would take it for main.
    #[cfg(target_os = "android")]
    {
        unsafe extern "C" {
            fn scr_host_android_is_main() -> bool;
        }
        // SAFETY: a plain query of the calling thread.
        unsafe { scr_host_android_is_main() }
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "android")))]
    {
        // The thread that first entered the host (the program's main, or the threaded boot's ui thread, which it
        // starts before the render thread's).
        static MAIN: std::sync::OnceLock<std::thread::ThreadId> = std::sync::OnceLock::new();
        *MAIN.get_or_init(|| std::thread::current().id()) == std::thread::current().id()
    }
}

/// The id of this process's earliest-created thread (its main thread), from a snapshot of its threads; the calling
/// thread's when the snapshot fails.
#[cfg(windows)]
fn first_thread_id() -> u32 {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next};
    use windows_sys::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId, GetThreadTimes, OpenThread, THREAD_QUERY_LIMITED_INFORMATION};
    // SAFETY: a snapshot of the system's threads, read entry by entry into a sized record, each thread opened only to
    // read its times and closed again.
    unsafe {
        let me = GetCurrentThreadId();
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return me;
        }
        let pid = GetCurrentProcessId();
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut first = (u64::MAX, me);
        let mut more = Thread32First(snapshot, &mut entry) != 0;
        while more {
            if entry.th32OwnerProcessID == pid {
                let thread = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, 0, entry.th32ThreadID);
                if !thread.is_null() {
                    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
                    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
                    if GetThreadTimes(thread, &mut created, &mut exited, &mut kernel, &mut user) != 0 {
                        let at = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
                        if at < first.0 {
                            first = (at, entry.th32ThreadID);
                        }
                    }
                    CloseHandle(thread);
                }
            }
            more = Thread32Next(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        first.1
    }
}

/// What a worker's global scope does not have: the window and its document, the page's storage and layout queries,
/// and the DOM's node interfaces (a render thread reads the page only through the hooks).
pub fn hides(name: &str) -> bool {
    matches!(name, "window" | "document" | "localStorage" | "sessionStorage" | "getComputedStyle" | "matchMedia"
        | "requestIdleCallback" | "cancelIdleCallback"
        | "ResizeObserver" | "MutationObserver" | "history" | "screen" | "Node" | "Element" | "Document" | "Text" | "Comment"
        | "DocumentFragment" | "Window" | "SVGElement")
        || (name.starts_with("HTML") && name.ends_with("Element"))
}

/// SCRIPTC_HOST_TRACE_RENDER=1: each distinct global a render thread reads, once, on stderr (what its pieces still ask
/// of the page).
pub fn trace_global(name: &str) {
    static SEEN: std::sync::Mutex<Option<std::collections::HashSet<String>>> = std::sync::Mutex::new(None);
    if std::env::var_os("SCRIPTC_HOST_TRACE_RENDER").is_none() {
        return;
    }
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    if seen.get_or_insert_with(Default::default).insert(name.to_string()) {
        eprintln!("render thread reads global '{name}'{}", if hides(name) { " (not defined in a worker)" } else { "" });
    }
}

/// An OffscreenCanvas: one the page handed this (render) thread, its buffer in relay.rs (the window reads it), or
/// one the program made, its own.
pub struct Canvas {
    handed: Option<String>,
    own: Cell<(u32, u32)>,
}

impl Canvas {
    fn size(&self) -> (u32, u32) {
        self.handed.as_deref().and_then(crate::relay::buffer).unwrap_or(self.own.get())
    }

    /// The handed canvas's id (a layer's scene attach draws for it).
    pub fn handed_id(&self) -> Option<&str> {
        self.handed.as_deref()
    }
}

thread_local! {
    /// The handed canvases' objects, one per id (identity), held for the thread's life.
    static HANDED: RefCell<HashMap<String, u64>> = RefCell::new(HashMap::new());
    /// [`page_canvas`] promises waiting for their canvas, by id.
    static AWAITING: RefCell<Vec<(String, u64)>> = const { RefCell::new(Vec::new()) };
    /// The hand-over count this thread's waker was last registered at (each hand-over spends the registered wakers).
    static REGISTERED: Cell<Option<u64>> = const { Cell::new(None) };
}

pub fn handed_canvas(id: &str) -> Value {
    let r = HANDED.with(|h| {
        *h.borrow_mut().entry(id.to_string()).or_insert_with(|| {
            let Value::Object(r) = objects::new_canvas(Canvas { handed: Some(id.to_string()), own: Cell::new((0, 0)) }) else { unreachable!() };
            objects::retain(r);
            r
        })
    });
    Value::Object(r)
}

/// A promise of the canvas the page hands over as `id`: settled now when it has been, else once it is
/// ([`poll_canvases`]).
pub fn page_canvas(id: String) -> Value {
    let promise = crate::values::new_promise();
    let Value::Object(p) = promise else { unreachable!() };
    if crate::relay::is_handed(&id) {
        crate::values::settle(p, false, &handed_canvas(&id));
    } else {
        // Held until the page hands it over (poll_canvases).
        objects::retain(p);
        AWAITING.with(|a| a.borrow_mut().push((id, p)));
        poll_canvases();
    }
    promise
}

pub fn canvases_pending() -> bool {
    AWAITING.with(|a| !a.borrow().is_empty())
}

/// Settles the waiting [`page_canvas`] promises whose canvas the page has handed over (each loop turn).
pub fn poll_canvases() {
    if !canvases_pending() {
        return;
    }
    // The waker goes in before the check: a hand-over after it wakes this thread, one before it is seen.
    let hands = crate::relay::hands();
    if REGISTERED.get() != Some(hands) {
        crate::relay::wait_for_canvas();
        REGISTERED.set(Some(hands));
    }
    let ready: Vec<(String, u64)> = AWAITING.with(|a| {
        let mut a = a.borrow_mut();
        let (ready, waiting) = std::mem::take(&mut *a).into_iter().partition(|(id, _)| crate::relay::is_handed(id));
        *a = waiting;
        ready
    });
    for (id, p) in ready {
        crate::values::settle(p, false, &handed_canvas(&id));
        crate::values::release_value(Value::Object(p));
    }
}

/// `new OffscreenCanvas(width, height)`: the program's own (no context natively: getContext answers null).
pub fn construct_canvas(args: &[Value]) -> Value {
    let dim = |i: usize| match args.get(i) {
        Some(Value::Number(n)) if n.is_finite() && *n >= 0.0 => *n as u32,
        _ => 0,
    };
    objects::new_canvas(Canvas { handed: None, own: Cell::new((dim(0), dim(1))) })
}

pub fn canvas_get(c: &Canvas, name: &str) -> Option<Value> {
    let (w, h) = c.size();
    Some(match name {
        "width" => Value::Number(f64::from(w)),
        "height" => Value::Number(f64::from(h)),
        _ => return None,
    })
}

/// Its width or height: a handed canvas's buffer is the one the window reads (it sizes the scene).
pub fn canvas_set(c: &Canvas, name: &str, value: &Value) -> Result<(), String> {
    let n = match value {
        Value::Number(n) if n.is_finite() && *n >= 0.0 => *n as u32,
        _ => 0,
    };
    let (width, height) = match name {
        "width" => (Some(n), None),
        "height" => (None, Some(n)),
        _ => return Err(format!("cannot set '{name}' on an OffscreenCanvas")),
    };
    match c.handed.as_deref() {
        Some(id) => crate::relay::set_buffer(id, width, height),
        None => {
            let (w, h) = c.own.get();
            c.own.set((width.unwrap_or(w), height.unwrap_or(h)));
        }
    }
    Ok(())
}
