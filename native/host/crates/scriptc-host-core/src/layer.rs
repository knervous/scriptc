//! What an embedder adds to the host: one [`Layer`], found at link time ([`get`]), every method with the generic
//! host's own default. The facade's `export_host!` defines it; its `default-entry` feature links the default
//! ([`Generic`]).
//!
//! The seams, cold paths all (the host's hot calls, property reads and writes and method calls on its objects,
//! dispatch on the object's kind as before and never reach the layer):
//! - **host modules and globals**: a module call is the layer's first ([`Layer::module_call`]; `None` falls through
//!   to the host's own); a global is the layer's first ([`Layer::global`]), as are the functions it names
//!   ([`Layer::global_function`], [`Layer::call_global`]);
//! - **the loop**: work the layer waits on ([`Layer::io_pending`], [`Layer::io_poll`]) and the turn's frame hook
//!   ([`Layer::before_frame`]);
//! - **the scene**: what the window composites under the document, from the layer's GPU stream ([`Layer::scene`] and
//!   the rest of the scene methods); none by default (the document alone);
//! - **the page's files**: where they are read ([`Layer::files`]: the disk by default) and what is done to the page's
//!   HTML before it is parsed ([`Layer::page_html`]);
//! - **the process's life**: its start ([`Layer::prepare`]), the window's heartbeat, first frame and close, its log
//!   folder, how a child process is started;
//! - **the network**: [`Layer::net_user_agent`], [`Layer::net_cache_key`], [`Layer::net_redact`],
//!   [`Layer::net_in_scope`], [`Layer::net_middleware`], [`Layer::remote_for`] (net.rs).

use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(feature = "gpu")]
use gpu_stream_wgpu::{SceneFrame, wgpu};

use crate::config::Config;
use crate::modules::Failure;
use crate::objects::Value;

/// Where the page's files are read: the disk ([`Disk`]), or a host's own store.
pub trait PageFiles: Sync {
    fn read(&self, path: &Path) -> std::io::Result<Vec<u8>>;
    fn is_file(&self, path: &Path) -> bool;
    /// Every file under `dir`, at any depth.
    fn files_under(&self, dir: &Path) -> Vec<PathBuf>;
}

/// The page's files on disk.
pub struct Disk;

impl PageFiles for Disk {
    fn read(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        std::fs::read(path)
    }
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
    fn files_under(&self, dir: &Path) -> Vec<PathBuf> {
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            let Ok(entries) = std::fs::read_dir(dir) else { return };
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, &mut out);
        out
    }
}

#[allow(unused_variables)]
pub trait Layer: Sync + 'static {
    /// Who the host runs as (config.rs).
    fn config(&self) -> &Config {
        &crate::config::DEFAULT
    }

    /// The process's start: the vtable's first request (`scr_host_ops`), before anything else the host does. Once per
    /// process is the layer's to ensure (it is asked again by each instance).
    fn prepare(&self) {}

    // Host modules and globals.

    /// A host module's function (`import { f } from "<module>"`): `None` when the layer has no such module.
    fn module_call(&self, module: &str, name: &str, args: &[Value]) -> Option<Result<Value, Failure>> {
        None
    }
    /// A global the layer defines (asked before the host's own, on every thread but a worker's).
    fn global(&self, name: &str) -> Option<Value> {
        None
    }
    /// Whether `name` is one of the layer's global functions ([`Layer::call_global`] answers its calls).
    fn global_function(&self, name: &str) -> bool {
        false
    }
    /// A call of one of the layer's global functions.
    fn call_global(&self, name: &str, args: &[Value]) -> Result<Value, String> {
        Err(format!("{name} is not a function"))
    }

    // The loop.

    /// Whether the layer waits on something the loop must keep turning for.
    fn io_pending(&self) -> bool {
        false
    }
    /// One look at what the layer waits on (each loop turn, after the host's own I/O).
    fn io_poll(&self) {}
    /// Before a frame's callbacks run (and before a timer armed as a frame).
    fn before_frame(&self) {}

    // The scene (the layer's GPU stream, composited under the document).

    /// The scene's last finished frame.
    #[cfg(feature = "gpu")]
    fn scene(&self) -> Option<SceneFrame> {
        None
    }
    /// The canvas the scene is drawn for: its drawing buffer's size and its box (x, y, w, h in CSS pixels).
    fn canvas_frame(&self) -> Option<((u32, u32), [f32; 4])> {
        None
    }
    /// The views' scenes, each with its canvas's box.
    #[cfg(feature = "gpu")]
    fn view_frames(&self) -> Vec<([f32; 4], SceneFrame)> {
        Vec::new()
    }
    /// The window's size changed (device pixels).
    fn resize(&self, width: u32, height: u32) {}
    /// Waits up to `max` for a stream that is executing to finish; whether one did.
    fn await_streams(&self, max: Duration) -> bool {
        false
    }
    /// The render thread's executor asks for a composite.
    fn request_composite(&self) {}
    /// Whether a render thread's executor drives the window's presents.
    fn render_executor_ready(&self) -> bool {
        false
    }
    /// The window's device was made: the layer may watch it (lost, uncaptured errors).
    #[cfg(feature = "gpu")]
    fn watch_window_device(&self, device: &wgpu::Device) {}
    /// Features the window's device asks for beyond the web's, for the layer's pipeline cache under `dir`.
    #[cfg(feature = "gpu")]
    fn pipeline_cache_features(&self, adapter: &wgpu::Adapter, dir: &Path) -> wgpu::Features {
        wgpu::Features::empty()
    }
    /// Writes the pipeline cache (each so often, and at the end: `force`).
    fn save_pipeline_cache(&self, force: bool) {}
    /// A periodic trace line about the scene's stream, when tracing.
    fn trace_report(&self) -> Option<String> {
        None
    }

    // The page's files.

    /// Where the page and the files it names are read.
    fn files(&self) -> &dyn PageFiles {
        &Disk
    }
    /// Whether the files beside the executable are the layer's alone ([`Layer::carries`]), never the disk's.
    fn carries_files(&self) -> bool {
        false
    }
    /// Whether the layer carries `rel` (a path relative to the executable's folder).
    fn carries(&self, rel: &str) -> bool {
        false
    }
    /// The page's HTML before it is parsed (its stylesheets linked, say); `path` is the page's file.
    fn page_html(&self, html: &str, path: &Path) -> String {
        html.to_string()
    }

    // The process's life.

    /// The window's heartbeat (each turn of its loop).
    fn heartbeat(&self) {}
    /// The window showed its first frame.
    fn shown(&self) {}
    /// The window closed.
    fn closed(&self) {}
    /// Where logs and crash files go.
    fn log_dir(&self) -> Option<PathBuf> {
        None
    }
    /// Starts a child process (a layer may hand it the process's own standard handles).
    fn spawn(&self, command: &mut std::process::Command) -> std::io::Result<std::process::Child> {
        command.spawn()
    }
    /// What follows the product and version in `navigator.userAgent` (a store's name, say).
    fn user_agent_suffix(&self) -> String {
        String::new()
    }

    // The network.

    /// The HTTP client's User-Agent header.
    fn net_user_agent(&self) -> String {
        let c = self.config();
        format!("{}/{}", c.product, c.version)
    }
    /// The HTTP cache's key for a request.
    fn net_cache_key(&self, method: &str, uri: &str) -> String {
        format!("{method}:{uri}")
    }
    /// `text` with what must stay out of logs replaced.
    fn net_redact(&self, text: &str) -> String {
        text.to_string()
    }
    /// Whether `url` is inside the scope a redirect may not leave.
    fn net_in_scope(&self, url: &url::Url) -> bool {
        false
    }
    /// The HTTP client's middleware below the cache.
    #[cfg(feature = "net")]
    fn net_middleware(&self, builder: reqwest_middleware::ClientBuilder) -> reqwest_middleware::ClientBuilder {
        builder
    }
    /// The remote URL a file missing from the document root streams from.
    fn remote_for(&self, root: &Path, path: &Path, query: Option<&str>) -> Option<url::Url> {
        None
    }
}

/// The generic host with no layer: every default.
pub struct Generic;

impl Layer for Generic {}

unsafe extern "Rust" {
    /// The layer, defined once in the link (the facade's `export_host!`, or its `default-entry` feature).
    safe fn __scriptc_host_layer() -> &'static dyn Layer;
}

/// The layer in force.
#[inline]
pub fn get() -> &'static dyn Layer {
    __scriptc_host_layer()
}

/// Names the program's layer: a `static` whose type implements [`Layer`]. Exactly one in a link.
#[macro_export]
macro_rules! export_host {
    ($layer:path) => {
        #[doc(hidden)]
        #[unsafe(no_mangle)]
        pub fn __scriptc_host_layer() -> &'static dyn $crate::layer::Layer {
            &$layer
        }
    };
}
