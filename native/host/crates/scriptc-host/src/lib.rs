//! The native host for scriptc's LLVM-native programs: what a program linked against the host island reaches for
//! `document`, timers, `fetch` and the rest (scriptc-host-core), and the seam an embedder adds its own through.
//!
//! - As the default link (`default-entry`, on by default): the archive this crate builds is the host, with no layer.
//! - As an embedder: depend on this crate with `default-features = false`, implement [`Layer`] (every method has the
//!   generic host's default), and name it once in the link:
//!
//! ```ignore
//! struct MyHost;
//! impl scriptc_host::Layer for MyHost {
//!     fn module_call(&self, module: &str, name: &str, args: &[scriptc_host::Value]) -> Option<Result<scriptc_host::Value, scriptc_host::Failure>> {
//!         (module == "my:module").then(|| Ok(scriptc_host::Value::Number(42.0)))
//!     }
//! }
//! static MY_HOST: MyHost = MyHost;
//! scriptc_host::export_host!(MY_HOST);
//! ```

pub use scriptc_host_core as core;
pub use scriptc_host_core::config::Config;
pub use scriptc_host_core::layer::{Disk, Generic, Layer, PageFiles};
pub use scriptc_host_core::modules::Failure;
pub use scriptc_host_core::objects::Value;
pub use scriptc_host_core::scr_host_ops;

pub use scriptc_host_core::export_host;

#[cfg(feature = "default-entry")]
static GENERIC: Generic = Generic;
#[cfg(feature = "default-entry")]
export_host!(GENERIC);
