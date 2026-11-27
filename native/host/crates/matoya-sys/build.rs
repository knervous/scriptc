//! Builds the vendored libmatoya and generates its bindings.
//!
//! The file lists mirror upstream's GNUmakefile (the common objects plus the
//! Darwin/macosx section) and Android.mk. When syncing libmatoya, diff the
//! makefiles' sources against these lists.
//!
//! Android: compiled with the NDK's clang (`CC_<target>`, which native/android/build.mjs sets),
//! with libmatoya's JNI entry points renamed to `mty_jni_*` (`JNI_RENAMES`): a Rust cdylib exports
//! only Rust's symbols, so src/android.rs re-exports each under its JNI name.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, fs};

const COMMON_C: &[&str] = &[
    "src/app.c",
    "src/async.c",
    "src/crypto.c",
    "src/dtls.c",
    "src/file.c",
    "src/hash.c",
    "src/http.c",
    "src/image.c",
    "src/json.c",
    "src/list.c",
    "src/log.c",
    "src/memory.c",
    "src/queue.c",
    "src/resample.c",
    "src/system.c",
    "src/thread.c",
    "src/tlocal.c",
    "src/version.c",
    "src/hid/utils.c",
    "src/unix/compress.c",
    "src/unix/file.c",
    "src/unix/memory.c",
    "src/unix/thread.c",
    "src/unix/time.c",
    "src/unix/system.c",
];

const MACOS_C: &[&str] = &[
    "src/hid/hid.c",
    "src/unix/apple/image.c",
    "src/unix/apple/macosx/hid.c",
    "src/unix/apple/audio.c",
    "src/unix/apple/crypto.c",
    "src/unix/apple/dtls.c",
    "src/unix/apple/macosx/aes-gcm.c",
];

const MACOS_M: &[&str] = &[
    "src/unix/apple/macosx/gfx/metal-ctx.m",
    "src/unix/apple/base64.m",
    "src/unix/apple/request.m",
    "src/unix/apple/webview.m",
    "src/unix/apple/ws.m",
    "src/unix/apple/gfx/metal.m",
    "src/unix/apple/gfx/metal-ui.m",
    "src/unix/apple/macosx/app.m",
    "src/unix/apple/macosx/dialog.m",
    "src/unix/apple/macosx/system.m",
];

const MACOS_FRAMEWORKS: &[&str] = &["AppKit", "Carbon", "IOKit", "Metal", "QuartzCore", "WebKit"];

// libmatoya's own GL and Vulkan renderers (its GFX tables name both): unused by the host, which draws
// with wgpu (`Gfx::External`), but linked. Their shader headers share names, so each set compiles with
// its own generated include directory.
const ANDROID_GL_C: &[&str] = &["src/gfx/gl/gl.c", "src/gfx/gl/gl-ui.c"];
const ANDROID_VK_C: &[&str] = &["src/gfx/vk/vk.c", "src/gfx/vk/vk-ctx.c", "src/gfx/vk/vk-ui.c"];

const ANDROID_C: &[&str] = &[
    "src/unix/linux/ws.c",
    "src/unix/linux/dialog.c",
    "src/unix/linux/android/aes-gcm.c",
    "src/unix/linux/android/app.c",
    "src/unix/linux/android/audio.c",
    "src/unix/linux/android/crypto.c",
    "src/unix/linux/android/dtls.c",
    "src/unix/linux/android/image.c",
    "src/unix/linux/android/jnih.c",
    "src/unix/linux/android/net.c",
    "src/unix/linux/android/request.c",
    "src/unix/linux/android/system.c",
    "src/unix/linux/android/webview.c",
    "src/unix/linux/android/gfx/gl-ctx.c",
];

/// libmatoya's JNI entry points (Matoya.java's natives, and JNI_OnLoad), compiled under these names.
const JNI_RENAMES: &[(&str, &str)] = &[
    ("JNI_OnLoad", "mty_jni_on_load"),
    ("Java_group_matoya_lib_Matoya_app_1start", "mty_jni_app_start"),
    ("Java_group_matoya_lib_Matoya_app_1stop", "mty_jni_app_stop"),
    ("Java_group_matoya_lib_Matoya_gfx_1resize", "mty_jni_gfx_resize"),
    ("Java_group_matoya_lib_Matoya_gfx_1set_1surface", "mty_jni_gfx_set_surface"),
    ("Java_group_matoya_lib_Matoya_gfx_1unset_1surface", "mty_jni_gfx_unset_surface"),
    ("Java_group_matoya_lib_Matoya_app_1key", "mty_jni_app_key"),
    ("Java_group_matoya_lib_Matoya_app_1check_1scroller", "mty_jni_app_check_scroller"),
    ("Java_group_matoya_lib_Matoya_app_1unhandled_1touch", "mty_jni_app_unhandled_touch"),
    ("Java_group_matoya_lib_Matoya_app_1single_1tap_1up", "mty_jni_app_single_tap_up"),
    ("Java_group_matoya_lib_Matoya_app_1long_1press", "mty_jni_app_long_press"),
    ("Java_group_matoya_lib_Matoya_app_1touch", "mty_jni_app_touch"),
    ("Java_group_matoya_lib_Matoya_app_1scroll", "mty_jni_app_scroll"),
    ("Java_group_matoya_lib_Matoya_app_1mouse_1motion", "mty_jni_app_mouse_motion"),
    ("Java_group_matoya_lib_Matoya_app_1generic_1scroll", "mty_jni_app_generic_scroll"),
    ("Java_group_matoya_lib_Matoya_app_1mouse_1button", "mty_jni_app_mouse_button"),
    ("Java_group_matoya_lib_Matoya_app_1button", "mty_jni_app_button"),
    ("Java_group_matoya_lib_Matoya_app_1axis", "mty_jni_app_axis"),
    ("Java_group_matoya_lib_Matoya_app_1unplug", "mty_jni_app_unplug"),
];

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest.join("../../vendor/libmatoya").canonicalize().expect("vendor/libmatoya");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    println!("cargo:rerun-if-changed={}", root.join("src").display());

    match target_os.as_str() {
        "macos" => {}
        "android" => return android(&root, &out),
        _ => panic!("matoya-sys: no libmatoya build for target_os = {target_os} yet"),
    }

    let sdk = macos_sdk();
    let generated = out.join("generated");
    for name in ["quad", "ui"] {
        embed_metal(
            &root.join(format!("src/unix/apple/gfx/shaders/{name}.metal")),
            &generated.join(format!("shaders/{name}.h")),
        );
    }

    let base = |files: &[&str]| {
        let mut b = cc::Build::new();
        b.compiler(clang())
            .include(&generated) // shaders/*.h, found after the including file's own directory
            .include(root.join("deps"))
            .include(root.join("src"))
            .include(root.join("src/unix"))
            .include(root.join("src/unix/apple"))
            .include(root.join("src/unix/apple/macosx"))
            .flag("-std=c99")
            .flag("-fvisibility=hidden")
            .flag("-mmacosx-version-min=10.15")
            .flag("-isysroot")
            .flag(&sdk)
            .flag("-Wno-unused-parameter")
            .flag("-Wno-missing-field-initializers")
            .flag("-Wno-switch")
            .warnings(false);
        for f in files {
            b.file(root.join(f));
        }
        b
    };

    let mut c_files = COMMON_C.to_vec();
    c_files.extend_from_slice(MACOS_C);
    base(&c_files).compile("matoya_c");
    base(MACOS_M).flag("-fobjc-arc").compile("matoya_objc");

    for fw in MACOS_FRAMEWORKS {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
    // The Objective-C `@available` checks call ___isPlatformVersionAtLeast,
    // which lives in clang's compiler runtime; link it explicitly (a release
    // LTO link does not pick it up by itself).
    if let Some(rt) = Command::new(clang()).arg("-print-file-name=libclang_rt.osx.a").output().ok()
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
        .filter(|p| p.is_file())
    {
        println!("cargo:rustc-link-search=native={}", rt.parent().unwrap().display());
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }

    let bindings = bindgen::Builder::default()
        .header(root.join("src/matoya.h").to_string_lossy())
        .clang_arg("-isysroot")
        .clang_arg(&sdk)
        .allowlist_function("MTY_.*")
        .allowlist_type("MTY_.*")
        .allowlist_var("MTY_.*")
        .prepend_enum_name(false)
        .derive_default(true)
        .layout_tests(false)
        .generate()
        .expect("bindgen: matoya.h");
    bindings.write_to_file(out.join("bindings.rs")).expect("write bindings.rs");
}

/// Android.mk's build: the common sources and the Android backend, GL ES and Vulkan contexts, with the
/// NDK's compiler (the cc crate takes it from `CC_<target>`); bindings against the NDK's sysroot.
fn android(root: &Path, out: &Path) {
    // GL shaders: the source text as a NUL-terminated array (the makefile's .vert.h / .frag.h rules).
    let gl = out.join("gl");
    for (name, var) in [("vs.vert", "VERT"), ("vsui.vert", "VERT"), ("fs.frag", "FRAG"), ("fsui.frag", "FRAG")] {
        let bytes = fs::read(root.join("src/gfx/gl/shaders").join(name)).expect("read GL shader");
        let mut h = format!("static const GLchar {var}[]={{");
        for b in bytes {
            h.push_str(&format!("0x{b:02x},"));
        }
        h.push_str("0x00};\n");
        let stem = name.split('.').next().unwrap();
        fs::create_dir_all(gl.join("shaders")).unwrap();
        fs::write(gl.join(format!("shaders/{stem}.h")), h).unwrap();
    }
    // Vulkan shaders: SPIR-V from glslangValidator (the .vertvk.h / .fragvk.h rules).
    let vk = out.join("vk");
    fs::create_dir_all(vk.join("shaders")).unwrap();
    for (name, stage, var) in [("vs.vertvk", "vert", "VERT"), ("vsui.vertvk", "vert", "VERT"), ("fs.fragvk", "frag", "FRAG"), ("fsui.fragvk", "frag", "FRAG")] {
        let stem = name.split('.').next().unwrap();
        let ok = Command::new(env::var("GLSLANG_VALIDATOR").unwrap_or_else(|_| "glslangValidator".into()))
            .args(["-S", stage, "-V", "--vn", var])
            .arg(root.join("src/gfx/vk/shaders").join(name))
            .arg("-o")
            .arg(vk.join(format!("shaders/{stem}.h")))
            .status()
            .is_ok_and(|s| s.success());
        assert!(ok, "matoya-sys: glslangValidator (Vulkan SDK, or `brew install glslang`) compiles libmatoya's Vulkan shaders");
    }

    let configure = |b: &mut cc::Build| {
        b.include(root.join("deps"))
        .include(root.join("src"))
        .include(root.join("src/unix"))
        .include(root.join("src/unix/linux"))
        .include(root.join("src/unix/linux/android"))
        .define("MTY_VK_ANDROID", None)
        .define("MTY_GL_ES", None)
        .define("MTY_GL_EXTERNAL", None)
        .flag("-std=c99")
        .flag("-fvisibility=hidden")
        .flag("-Wno-unused-parameter")
        .flag("-Wno-missing-field-initializers")
        .flag("-Wno-switch")
        .flag("-Wno-atomic-alignment")
        .warnings(false);
        for (from, to) in JNI_RENAMES {
            b.define(from, Some(*to));
        }
    };
    let mut b = cc::Build::new();
    configure(&mut b);
    for f in COMMON_C.iter().chain(ANDROID_C) {
        b.file(root.join(f));
    }
    b.compile("matoya_c");
    for (dir, files, lib) in [(&gl, ANDROID_GL_C, "matoya_gl"), (&vk, ANDROID_VK_C, "matoya_vk")] {
        let mut b = cc::Build::new();
        b.include(dir);
        configure(&mut b);
        for f in files {
            b.file(root.join(f));
        }
        b.compile(lib);
    }
    for lib in ["android", "log", "aaudio", "EGL", "GLESv3", "jnigraphics"] {
        println!("cargo:rustc-link-lib={lib}");
    }

    let target = env::var("TARGET").unwrap();
    let api = env::var("ANDROID_API").unwrap_or_else(|_| "28".into());
    let mut builder = bindgen::Builder::default()
        .header(root.join("src/matoya.h").to_string_lossy())
        .clang_arg(format!("--target={target}{api}"));
    if let Ok(sysroot) = env::var("ANDROID_SYSROOT") {
        builder = builder.clang_arg(format!("--sysroot={sysroot}"));
    }
    let bindings = builder
        .allowlist_function("MTY_.*")
        .allowlist_type("MTY_.*")
        .allowlist_var("MTY_.*")
        .prepend_enum_name(false)
        .derive_default(true)
        .layout_tests(false)
        .generate()
        .expect("bindgen: matoya.h");
    bindings.write_to_file(out.join("bindings.rs")).expect("write bindings.rs");
}

/// Upstream's `.metal.h` rule: the source's bytes as a NUL-terminated C array.
fn embed_metal(src: &Path, dst: &Path) {
    let bytes = fs::read(src).expect("read .metal");
    let mut s = String::from("static const char MTL_LIBRARY[]={");
    for b in bytes {
        s.push_str(&format!("0x{b:02x},"));
    }
    s.push_str("0x00};\n");
    fs::create_dir_all(dst.parent().unwrap()).unwrap();
    fs::write(dst, s).unwrap();
}

/// The macOS SDK path. This Mac's Xcode is broken, so when xcrun answers
/// nothing through it, ask again through the CommandLineTools.
fn macos_sdk() -> String {
    if let Ok(s) = env::var("SDKROOT") {
        return s;
    }
    xcrun(&["--sdk", "macosx", "--show-sdk-path"]).expect("no macOS SDK found (set SDKROOT)")
}

fn clang() -> String {
    env::var("CC").ok().or_else(|| xcrun(&["-f", "clang"])).unwrap_or_else(|| "clang".into())
}

fn xcrun(args: &[&str]) -> Option<String> {
    let run = |dev: Option<&str>| {
        let mut cmd = Command::new("xcrun");
        cmd.args(args);
        if let Some(d) = dev {
            cmd.env("DEVELOPER_DIR", d);
        }
        cmd.output().ok().filter(|o| o.status.success()).and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            (!s.is_empty()).then_some(s)
        })
    };
    run(None).or_else(|| run(Some("/Library/Developer/CommandLineTools")))
}
