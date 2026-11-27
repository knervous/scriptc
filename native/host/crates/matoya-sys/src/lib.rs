//! Raw bindings to libmatoya, generated from the vendored `matoya.h`.
//!
//! Everything here is `unsafe` C. The safe surface the host uses lives in
//! the host crate; keep this crate a plain binding.

#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, clippy::all)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

#[cfg(target_os = "android")]
pub mod android;
