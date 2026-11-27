//! Compiles the vendored libopus (vendor/libopus, PROVENANCE.md there), the float build, decoder and encoder alike
//! (the link keeps only what the decoder reaches).
//!
//! The file lists are read from upstream's own `*_sources.mk`, so a sync picks up a new source file. For a Windows
//! cross build this runs under the host's cargo, where `CC_x86_64_pc_windows_gnullvm` and
//! `AR_...` are the Zig wrappers; any C compiler cc-rs finds works otherwise (clang, gcc, MSVC).

use std::path::{Path, PathBuf};
use std::{env, fs};

/// The make variables named, in order, from one of upstream's `*_sources.mk` files.
fn sources(root: &Path, mk: &str, vars: &[&str]) -> Vec<PathBuf> {
    let text = fs::read_to_string(root.join(mk)).unwrap_or_else(|e| panic!("vendor/libopus/{mk}: {e}"));
    let mut out = Vec::new();
    for var in vars {
        let mut lines = text.lines().skip_while(|l| l.split('=').next().map(str::trim) != Some(*var));
        let first = lines.next().unwrap_or_else(|| panic!("vendor/libopus/{mk}: no {var}"));
        // `NAME = a.c b.c \` then continuation lines, each ending in a backslash but the last.
        let mut more = first.trim_end().ends_with('\\');
        let mut words: Vec<String> = first.split_once('=').map(|(_, r)| r).unwrap_or("").split_whitespace().map(String::from).collect();
        while more {
            let Some(line) = lines.next() else { break };
            more = line.trim_end().ends_with('\\');
            words.extend(line.split_whitespace().map(String::from));
        }
        out.extend(words.into_iter().filter(|w| w != "\\").map(|w| w.split('/').fold(root.to_path_buf(), |p, c| p.join(c))));
    }
    out
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    // Not canonicalized: on Windows that gives a verbatim (\?\) path, which takes no `/` separators, and cl.exe
    // then misreads the joined source paths.
    let root = manifest.parent().and_then(Path::parent).expect("workspace root").join("vendor").join("libopus");
    assert!(root.join("COPYING").is_file(), "vendor/libopus missing at {}", root.display());
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let windows = env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    for dir in ["include", "celt", "silk", "src"] {
        println!("cargo:rerun-if-changed={}", root.join(dir).display());
    }
    for mk in ["celt_sources.mk", "silk_sources.mk", "opus_sources.mk"] {
        println!("cargo:rerun-if-changed={}", root.join(mk).display());
    }

    let mut files = sources(&root, "celt_sources.mk", &["CELT_SOURCES"]);
    files.extend(sources(&root, "silk_sources.mk", &["SILK_SOURCES", "SILK_SOURCES_FLOAT"]));
    files.extend(sources(&root, "opus_sources.mk", &["OPUS_SOURCES", "OPUS_SOURCES_FLOAT"]));

    let mut build = cc::Build::new();
    build
        .include(root.join("include"))
        .include(root.join("celt"))
        .include(root.join("silk"))
        .include(root.join("silk/float"))
        .include(root.join("src"))
        // What upstream's configure defines for a float build (config.h), given here instead of a config.h.
        .define("OPUS_BUILD", None)
        .define("USE_ALLOCA", None)
        .define("HAVE_LRINT", "1")
        .define("HAVE_LRINTF", "1")
        // The decoder reads untrusted files: upstream's hardening (on by default in its builds) turns the internal
        // assertions that guard memory into checks.
        .define("ENABLE_HARDENING", None)
        .opt_level(2)
        .warnings(false);
    if !windows {
        build.define("HAVE_ALLOCA_H", "1");
    }
    // SSE and SSE2 are the x86_64 baseline, so presumed (no run-time CPU detection); SSE4.1 and AVX2 would need
    // their own flags per file and only help the fixed-point build and the encoder.
    if arch == "x86_64" {
        files.extend(sources(&root, "celt_sources.mk", &["CELT_SOURCES_SSE", "CELT_SOURCES_SSE2"]));
        for d in ["OPUS_X86_MAY_HAVE_SSE", "OPUS_X86_PRESUME_SSE", "OPUS_X86_MAY_HAVE_SSE2", "OPUS_X86_PRESUME_SSE2"] {
            build.define(d, None);
        }
    }
    build.files(&files).compile("opus");
}
