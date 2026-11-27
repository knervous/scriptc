//! Reads the host island header this crate is built against and hands its ABI to the crate: abi.rs fails to compile
//! when `SCR_HOST_ABI` differs from its own, and the `abi_layout` test checks the ops' field order against the header's.
//!
//! The header: `SCR_HOST_ISLAND_H` when set; else the runtime's own, `packages/runtime/src/scr_host_island.h` two levels
//! above this workspace (the host's place in the compiler's repository).

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=SCR_HOST_ISLAND_H");
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let workspace = manifest.join("../..");
    let candidates = [
        std::env::var_os("SCR_HOST_ISLAND_H").map(PathBuf::from),
        Some(workspace.join("../../packages/runtime/src/scr_host_island.h")),
        Some(manifest.join("abi/scr_host_island.h")),
    ];
    let Some(header) = candidates.into_iter().flatten().find(|p| p.is_file()) else {
        panic!("scr_host_island.h not found: set SCR_HOST_ISLAND_H");
    };
    if header.starts_with(manifest.join("abi")) {
        println!("cargo:warning=building against the staged copy of scr_host_island.h (abi/); set SCR_HOST_ISLAND_H to the runtime's");
    }
    println!("cargo:rerun-if-changed={}", header.display());
    let text = std::fs::read_to_string(&header).unwrap_or_else(|e| panic!("{}: {e}", header.display()));
    let abi = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("#define SCR_HOST_ABI").map(|v| v.trim().to_string()))
        .unwrap_or_else(|| panic!("{}: no SCR_HOST_ABI", header.display()));
    assert!(abi.parse::<u32>().is_ok(), "SCR_HOST_ABI is not a number: {abi}");
    println!("cargo:rustc-env=SCR_HOST_ABI_HEADER={abi}");
    // ScrHostOps's members in order: `abi`, then each `(*name)` function pointer.
    let start = text.find("typedef struct ScrHostOps").expect("no ScrHostOps");
    let body = &text[start..text[start..].find("} ScrHostOps").map(|e| start + e).expect("ScrHostOps unterminated")];
    let mut fields = vec!["abi".to_string()];
    let mut rest = body;
    while let Some(i) = rest.find("(*") {
        rest = &rest[i + 2..];
        let end = rest.find(')').unwrap();
        fields.push(rest[..end].trim().to_string());
    }
    println!("cargo:rustc-env=SCR_HOST_OPS_FIELDS={}", fields.join(","));
    println!("cargo:rustc-env=SCR_HOST_ISLAND_H_USED={}", header.display());
}
