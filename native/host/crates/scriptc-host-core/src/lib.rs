//! The native host for scriptc's LLVM-native programs: the host island ABI (`packages/runtime/src/scr_host_island.h`)
//! answered in Rust. A program compiled straight to native code reaches `document`, `console`, timers, `fetch` and
//! the rest of a page's platform here, through one vtable, with no JavaScript engine linked.
//!
//! Host objects are reference-counted entries in one table; a reference is the entry's index + 1 and stays the same
//! for the object's life (identity: `a === b` is reference equality). Compiled functions the program hands over are
//! closure references the host calls back through `scr_host_closure_call`.
//!
//! An embedder adds its own modules, globals, scene and process life through a [`layer::Layer`] (the facade's
//! `export_host!`). The modules are public for the layer's use; the host's API proper is the layer trait.

#![allow(clippy::all)]

pub mod abi;
pub mod abort;
// AudioContext and its nodes on the native Web Audio graph (audio-engine, audio-decode; Windows for now).
#[cfg(all(windows, feature = "audio"))]
pub mod audio;
pub mod bitmap;
pub mod channels;
pub mod config;
pub mod dom;
pub mod relay;
#[cfg(windows)]
pub mod harden;
pub mod intl;
pub mod launch;
pub mod layer;
// One launch's log held under a cap.
#[cfg(windows)]
pub mod log_cap;
pub mod modules;
pub mod net;
pub mod objects;
pub mod observers;
pub mod opfs;
pub mod page;
#[cfg(windows)]
pub mod profile;
// RTCPeerConnection and RTCDataChannel on webrtc-rs (the webrtc feature; Windows and Android).
#[cfg(all(any(windows, target_os = "android"), feature = "webrtc"))]
pub mod rtc;
pub mod streams;
pub mod timers;
pub mod values;
pub mod web;
pub mod window;
pub mod workers;
pub mod render_thread;

pub use abi::scr_host_ops;
#[cfg(feature = "gpu")]
pub use gpu_stream_wgpu;
pub use {blitz_dom, blitz_traits, url};

/// Where the host keeps its own files by default (the local storage, OPFS): the app's folder (config.rs).
pub fn app_dir() -> Option<std::path::PathBuf> {
    config::app_dir()
}

/// The directory the executable is in. An installed build's read-only files are named as if they were beside it
/// (the page, its document root); a layer may carry them instead ([`layer::Layer::carries_files`]).
pub fn exe_dir() -> Option<std::path::PathBuf> {
    static DIR: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
    DIR.get_or_init(|| std::env::current_exe().ok().and_then(|e| e.parent().map(std::path::Path::to_path_buf))).clone()
}

/// `rel` beside the executable, when it is there: an input's default when its environment variable is unset (the
/// variables win). A layer that carries its files answers from them alone (a file or a directory of them), never from
/// the disk.
pub fn installed(rel: &str) -> Option<std::path::PathBuf> {
    let layer = layer::get();
    if layer.carries_files() {
        return layer.carries(rel).then(|| beside_exe(rel));
    }
    exe_dir().map(|d| d.join(rel)).filter(|p| p.exists())
}

/// `rel` beside the executable, whether or not it is there (a default to name in an error).
pub fn beside_exe(rel: &str) -> std::path::PathBuf {
    exe_dir().unwrap_or_default().join(rel)
}

/// The user's home folder: HOME, else (Windows) USERPROFILE.
pub fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").or_else(|| if cfg!(windows) { std::env::var_os("USERPROFILE") } else { None }).map(std::path::PathBuf::from)
}

/// A page file's bytes, as the layer reads them (its carried files, else the disk).
pub fn read(path: &std::path::Path) -> std::io::Result<Vec<u8>> {
    layer::get().files().read(path)
}

/// Whether `path` is a page file, as the layer reads them.
pub fn is_file(path: &std::path::Path) -> bool {
    layer::get().files().is_file(path)
}

/// A page file's text, as the layer reads them.
pub fn read_to_string(path: &std::path::Path) -> std::io::Result<String> {
    String::from_utf8(read(path)?).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}
