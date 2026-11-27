//! Who the host is running as: the application's name (its folders, its thread names), the prefix of the environment
//! variables it reads, its window's title and class, and the product its user agent names. An embedder's
//! [`Layer`](crate::layer::Layer) supplies them; the defaults are the generic host's own.
//!
//! Every setting the host reads from the environment is `<env_prefix><NAME>` ([`var`], [`var_os`]): `PAGE_URL`,
//! `FETCH_ROOT`, `API_ORIGIN`, `LOCAL_STORAGE`, `SESSION_STORAGE`, `OPFS_DIR`, `TOUCH_POINTS`, `HTTP_CACHE`,
//! `NET_TRACE`, `AUDIO`, `AUDIO_TRACE`, `SHARPEN`, `UI_CPU`, `GPU_TIMING`. The ones named `SCRIPTC_HOST_*` (the page,
//! traces, the profiler) are the host's own and keep their names whatever the prefix.

use std::ffi::OsString;
use std::path::PathBuf;

pub struct Config {
    /// The application's name: its folders (`%APPDATA%\<name>`, `~/Library/Application Support/<name>`, the caches').
    pub app_name: &'static str,
    /// The prefix of the environment variables the host reads (`SCRIPTC_HOST_` by default).
    pub env_prefix: &'static str,
    /// The product the page's `navigator.userAgent` names (`Mozilla/5.0 (<platform>) <product>/<version>`).
    pub product: &'static str,
    /// Its version.
    pub version: &'static str,
    /// The window's title when the page has none.
    pub window_title: &'static str,
    /// The window's class (Windows: another launch finds the running window by it).
    pub window_class: &'static str,
    /// The page's API origin when `<PREFIX>API_ORIGIN` is unset (a build's own, compiled in).
    pub api_origin: Option<&'static str>,
    /// The window's colours (Windows: the client area before the first frame, the title bar's); None for the system's.
    pub window_colours: Option<WindowColours>,
    /// An installed program's page, beside the executable, when `SCRIPTC_HOST_PAGE` is unset.
    pub installed_page: &'static str,
    /// An installed program's document root, beside the executable, when `<PREFIX>FETCH_ROOT` is unset.
    pub installed_root: &'static str,
}

/// A window's colours, each a COLORREF (0x00bbggrr).
#[derive(Clone, Copy)]
pub struct WindowColours {
    pub background: u32,
    pub caption: u32,
    pub caption_text: u32,
    pub border: u32,
}

/// The generic host's own identity.
pub const DEFAULT: Config = Config {
    app_name: "scriptc-host",
    env_prefix: "SCRIPTC_HOST_",
    product: "scriptc-host",
    version: env!("CARGO_PKG_VERSION"),
    window_title: "scriptc native",
    window_class: "ScriptcHostWindow",
    api_origin: None,
    window_colours: None,
    installed_page: "index.html",
    installed_root: "public",
};

/// The configuration in force (the layer's).
pub fn get() -> &'static Config {
    crate::layer::get().config()
}

fn name(key: &str) -> String {
    format!("{}{key}", get().env_prefix)
}

/// `<env_prefix><key>`'s value (as `std::env::var`).
pub fn var(key: &str) -> Result<String, std::env::VarError> {
    std::env::var(name(key))
}

/// `<env_prefix><key>`'s value (as `std::env::var_os`).
pub fn var_os(key: &str) -> Option<OsString> {
    std::env::var_os(name(key))
}

/// The full name of the variable `key` (for a message, or a variable the host sets for a child).
pub fn var_name(key: &str) -> String {
    name(key)
}

/// A thread's name: `<app>-<what>`, the app's name in lower case.
pub fn thread_name(what: &str) -> String {
    format!("{}-{what}", get().app_name.to_lowercase())
}

/// The app's roaming data folder: `%APPDATA%\<app>` on Windows, else `~/Library/Application Support/<app>` (macOS;
/// Android's HOME is the app's files directory).
pub fn app_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        return std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(get().app_name));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support").join(get().app_name))
}

/// The app's local folder on Windows: `%LOCALAPPDATA%\<app>`.
pub fn local_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(get().app_name))
}

/// The app's caches folder on macOS: `~/Library/Caches/<app>`.
pub fn caches_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Caches").join(get().app_name))
}
