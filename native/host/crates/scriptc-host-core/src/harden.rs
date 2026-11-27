//! Windows: the process's own protections, set first thing at its start (the layer's `prepare`), and the crash files.
//!
//! - **DLL search** (release builds, the `embedded` feature): `SetDefaultDllDirectories` limits every load by name to
//!   the executable's folder and System32, so `dxcompiler.dll`, `dxil.dll` and anything a library loads by name never
//!   comes from the working directory or `PATH` (a planted DLL there would run as the program).
//! - **Image loads** (release builds): no images from remote (network) shares and none marked low integrity
//!   (`ProcessImageLoadPolicy`). Not "prefer System32": a `dxcompiler.dll` there (an SDK's, older) would win over
//!   the one the program ships. Not dynamic-code prohibition (GPU drivers compile shaders to machine code) and not the
//!   extension-point policy (it disables input method editors, which text fields need).
//! - **Crash files:** a fatal exception or `abort()` (abi.rs `crash_traces`, which also logs the stack) writes a small
//!   minidump (threads, stacks, modules: no heap) to `crashes\` beside the logs, and a Rust panic writes a note (the
//!   message, where, the backtrace) there, since a panic that aborts ends the process without the exception filter.
//!   Logs rotate after a few launches; the newest [`CRASHES_KEPT`] crash files stay. Each start logs the newest
//!   crash file left since the last start. The symbols are the build's (`OUT/symbols`); nothing leaves the machine.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_WRITE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{CREATE_ALWAYS, CreateFileW, FILE_ATTRIBUTE_NORMAL};
use windows_sys::Win32::System::Diagnostics::Debug::{
    EXCEPTION_POINTERS, MINIDUMP_EXCEPTION_INFORMATION, MiniDumpNormal, MiniDumpWithThreadInfo, MiniDumpWithUnloadedModules, MiniDumpWriteDump,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId};

/// How many crash files (dumps and panic notes) are kept.
const CRASHES_KEPT: usize = 10;

/// The process's protections and the panic note, first thing at its start (once).
pub fn at_start() {
    #[cfg(feature = "release-hardening")]
    // SAFETY: process-wide settings with no preconditions, made before anything else runs or loads.
    unsafe {
        use windows_sys::Win32::System::LibraryLoader::{LOAD_LIBRARY_SEARCH_APPLICATION_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32, SetDefaultDllDirectories};
        use windows_sys::Win32::System::Threading::{ProcessImageLoadPolicy, SetProcessMitigationPolicy};
        if SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32) == 0 {
            eprintln!("scriptc-host: the DLL search could not be limited: {}", std::io::Error::last_os_error());
        }
        // PROCESS_MITIGATION_IMAGE_LOAD_POLICY: NoRemoteImages (bit 0), NoLowMandatoryLabelImages (bit 1).
        let policy: u32 = 0b11;
        if SetProcessMitigationPolicy(ProcessImageLoadPolicy, (&raw const policy).cast(), size_of::<u32>()) == 0 {
            eprintln!("scriptc-host: the image load policy could not be set: {}", std::io::Error::last_os_error());
        }
    }
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default(info);
        write_panic_note(info);
    }));
}

/// The crash files' folder: `crashes` in the log folder (the layer's `log_dir`), made when needed.
fn crash_dir() -> Option<PathBuf> {
    let dir = crate::layer::get().log_dir()?.join("crashes");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// `<kind>-<unix seconds>-<pid>.<ext>` in the crash folder, the oldest beyond [`CRASHES_KEPT`] removed first.
fn crash_file(kind: &str, ext: &str) -> Option<PathBuf> {
    let dir = crash_dir()?;
    prune(&dir, CRASHES_KEPT.saturating_sub(1));
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // SAFETY: no preconditions.
    let pid = unsafe { GetCurrentProcessId() };
    Some(dir.join(format!("{kind}-{secs}-{pid}.{ext}")))
}

/// The crash folder down to its newest `keep` files.
fn prune(dir: &std::path::Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

/// A minidump of this process (the fault's thread and record when given) into the crash folder; its path, logged.
/// From the exception filter or the abort handler: nothing here allocates much or takes a lock the faulting thread
/// could hold, beyond the file name.
pub fn write_minidump(exception: *const EXCEPTION_POINTERS) {
    let Some(path) = crash_file("crash", "dmp") else { return };
    let wide: Vec<u16> = path.as_os_str().encode_wide_nul();
    // SAFETY: a new file of this process's own, written by dbghelp from this thread and closed.
    unsafe {
        let file = CreateFileW(wide.as_ptr(), GENERIC_WRITE, 0, std::ptr::null(), CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, std::ptr::null_mut());
        if file == INVALID_HANDLE_VALUE {
            return;
        }
        let info = MINIDUMP_EXCEPTION_INFORMATION { ThreadId: GetCurrentThreadId(), ExceptionPointers: exception as *mut EXCEPTION_POINTERS, ClientPointers: 0 };
        let with_exception = if exception.is_null() { std::ptr::null() } else { &raw const info };
        let ok = MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), file, MiniDumpNormal | MiniDumpWithThreadInfo | MiniDumpWithUnloadedModules, with_exception, std::ptr::null(), std::ptr::null());
        CloseHandle(file);
        if ok != 0 {
            eprintln!("scriptc-host: crash dump written to {}", path.display());
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// A panic's note (message, place, backtrace) into the crash folder.
fn write_panic_note(info: &std::panic::PanicHookInfo<'_>) {
    let Some(path) = crash_file("panic", "txt") else { return };
    let thread = std::thread::current();
    let text = format!(
        "{}\nthread: {}\n\n{}\n\nbacktrace:\n{}\n",
        std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default(),
        thread.name().unwrap_or("(unnamed)"),
        info,
        std::backtrace::Backtrace::force_capture()
    );
    if std::fs::write(&path, text).is_ok() {
        eprintln!("scriptc-host: panic note written to {}", path.display());
    }
}

/// The newest crash file of the last week, for the start's log line.
pub fn report_last_crash() {
    let Some(dir) = crate::layer::get().log_dir().map(|d| d.join("crashes")) else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let newest = entries.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).max_by(|a, b| a.0.cmp(&b.0));
    if let Some((at, path)) = newest {
        let ago = SystemTime::now().duration_since(at).map(|d| d.as_secs()).unwrap_or(0);
        if ago < 7 * 24 * 3600 {
            eprintln!("scriptc-host: the newest crash file is {} ({} min ago)", path.display(), ago / 60);
        }
    }
}

trait EncodeWideNul {
    fn encode_wide_nul(&self) -> Vec<u16>;
}

impl EncodeWideNul for std::ffi::OsStr {
    fn encode_wide_nul(&self) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        self.encode_wide().chain(std::iter::once(0)).collect()
    }
}
