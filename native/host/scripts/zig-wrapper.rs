// Zig as one executable per tool, for cargo's C builds (cc-rs) of the native host's dependencies for
// x86_64-pc-windows-gnullvm: compiled once (`rustc -O --edition 2024 zig-wrapper.rs -o zig-cc`) and copied as zig-c++
// and zig-ar, the tool named by the executable's own name (build-host-pack.mjs does this for a gnullvm pack).
//
// cc-rs takes CC as one program (its compiler probe ran `zig -E` without `cc`) and adds `--target=<rust triple>`,
// which Zig's target parser refuses (x86_64-pc-windows-gnu). The wrapper drops that flag and gives Zig its own
// target, ZIG_WRAPPER_TARGET. ZIG_WRAPPER_ZIG is the Zig to run.
//
// As rustc's linker for the target (a dependency's cdylib) it also drops what Zig's driver refuses or has its own
// answer for: the exports file rustc hands lld (`-Wl,<list>.def`; a dependency's DLL is never loaded), and
// `-lmsvcrt`, which in llvm-mingw (the target's toolchain) names its configured CRT: Zig links its own UCRT. rustc
// passes a long link line as an `@file` (GNU quoting: a backslash escapes the next character, one argument per line),
// so those are read, filtered, and handed on as a file of the same form.
use std::process::{Command, exit};

/// The arguments of a GNU-style response file.
fn response_args(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut arg = String::new();
        let mut chars = line.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                if let Some(next) = chars.next() {
                    arg.push(next);
                }
            } else {
                arg.push(c);
            }
        }
        if !line.is_empty() {
            out.push(arg);
        }
    }
    out
}

fn expand(args: impl Iterator<Item = String>, out: &mut Vec<String>, from_file: &mut bool) {
    for a in args {
        if let Some(path) = a.strip_prefix('@') {
            if let Ok(text) = std::fs::read_to_string(path) {
                *from_file = true;
                expand(response_args(&text).into_iter(), out, from_file);
                continue;
            }
        }
        out.push(a);
    }
}

fn main() {
    let me = std::env::current_exe().ok().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned())).unwrap_or_default();
    let tool = me.strip_prefix("zig-").unwrap_or("cc").to_string();
    let zig = std::env::var("ZIG_WRAPPER_ZIG").unwrap_or_else(|_| "zig".into());
    let mut given = Vec::new();
    let mut from_file = false;
    expand(std::env::args().skip(1), &mut given, &mut from_file);
    let mut args: Vec<String> = Vec::new();
    if tool != "ar" {
        args.push("-target".into());
        args.push(std::env::var("ZIG_WRAPPER_TARGET").unwrap_or_else(|_| "x86_64-windows-gnu".into()));
    }
    let mut rest = given.into_iter();
    while let Some(a) = rest.next() {
        if a.starts_with("--target=") || a == "-lmsvcrt" || (a.starts_with("-Wl,") && a.ends_with(".def")) {
            continue;
        }
        if a == "-target" || a == "--target" {
            rest.next();
            continue;
        }
        args.push(a);
    }
    // A link (rustc's: it names an output DLL or executable) also takes ZIG_WRAPPER_LINK_EXTRA, the objects Zig's
    // MinGW lacks (zig-mingw-shims.c).
    let linking = tool == "cc" && args.iter().any(|a| a == "-shared") && !args.iter().any(|a| a == "-c");
    if linking {
        if let Ok(extra) = std::env::var("ZIG_WRAPPER_LINK_EXTRA") {
            args.extend(std::env::split_paths(&extra).map(|p| p.display().to_string()));
        }
    }
    let mut command = Command::new(&zig);
    command.arg(&tool);
    let mut file = None;
    if from_file {
        let path = std::env::temp_dir().join(format!("zig-wrapper-{}.rsp", std::process::id()));
        let escaped: Vec<String> = args.iter().map(|a| a.chars().flat_map(|c| if c == '\\' || c == ' ' || c == '"' { vec!['\\', c] } else { vec![c] }).collect()).collect();
        if std::fs::write(&path, escaped.join("\n")).is_ok() {
            command.arg(format!("@{}", path.display()));
            file = Some(path);
        } else {
            command.args(&args);
        }
    } else {
        command.args(&args);
    }
    let status = command.status();
    if let Some(path) = file {
        let _ = std::fs::remove_file(path);
    }
    match status {
        Ok(s) => exit(s.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("zig-wrapper: {zig}: {e}");
            exit(1);
        }
    }
}
