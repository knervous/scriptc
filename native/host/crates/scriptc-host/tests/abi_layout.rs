//! The Rust half of the ABI drift test: the host's `ScrHostOps` fields are the header's, in the header's order
//! (build.rs reads them from the header this crate is built against), and the layout this crate uses prints as JSON
//! (`cargo test -p scriptc-host --test abi_layout -- --nocapture`), for the C side's table to be compared with. Where a C
//! compiler is found (`CC`, else `cc`), the same table is printed from the header by a C probe and the two must be
//! identical.

#[path = "../../../tests-support/runtime_stubs.rs"]
mod runtime_stubs;

use scriptc_host::core::abi;

#[test]
fn abi_matches_the_header() {
    assert_eq!(abi::SCR_HOST_ABI.to_string(), abi::HEADER_ABI);
}

#[test]
fn ops_fields_are_the_headers() {
    let header: Vec<String> = abi::HEADER_OPS_FIELDS.split(',').map(str::to_string).collect();
    assert_eq!(abi::ops_field_names(), header, "ScrHostOps differs from {}", abi::HEADER_PATH);
}

#[test]
fn abi_layout() {
    let rust = abi::layout_json();
    println!("{rust}");
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".into());
    let dir = std::env::temp_dir().join(format!("scriptc-host-abi-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let probe = dir.join("probe.c");
    std::fs::write(&probe, PROBE).unwrap();
    let header_dir = std::path::Path::new(abi::HEADER_PATH).parent().unwrap().to_path_buf();
    let exe = dir.join("probe");
    let built = std::process::Command::new(&cc).arg("-I").arg(&header_dir).arg(&probe).arg("-o").arg(&exe).status();
    match built {
        Ok(s) if s.success() => {
            let out = std::process::Command::new(&exe).output().unwrap();
            let c = String::from_utf8(out.stdout).unwrap();
            assert_eq!(c.trim(), rust, "the C layout (from the header) and the Rust layout differ");
        }
        _ => eprintln!("abi_layout: no C compiler ({cc}): the C table was not compared (the Rust table is printed above)"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

const PROBE: &str = r#"
#include <stddef.h>
#include <stdio.h>
#include "scr_host_island.h"
#define F(T, f) printf("%s{\"name\":\"%s\",\"offset\":%zu}", first ? "" : ",", #f, offsetof(T, f)), first = 0
int main(void) {
  int first = 1;
  printf("{\"abi\":%d,\"ScrHostVal\":{\"size\":%zu,\"fields\":[", SCR_HOST_ABI, sizeof(ScrHostVal));
  F(ScrHostVal, kind); F(ScrHostVal, flag); F(ScrHostVal, number); F(ScrHostVal, str); F(ScrHostVal, len); F(ScrHostVal, ref);
  first = 1;
  printf("]},\"ScrHostOps\":{\"size\":%zu,\"fields\":[", sizeof(ScrHostOps));
  F(ScrHostOps, abi); F(ScrHostOps, global_get); F(ScrHostOps, get_prop); F(ScrHostOps, set_prop); F(ScrHostOps, call);
  F(ScrHostOps, call_method); F(ScrHostOps, construct); F(ScrHostOps, instance_of); F(ScrHostOps, is_callable);
  F(ScrHostOps, retain); F(ScrHostOps, release); F(ScrHostOps, io_pending); F(ScrHostOps, io_poll); F(ScrHostOps, new_object);
  F(ScrHostOps, new_array); F(ScrHostOps, is_array); F(ScrHostOps, own_keys); F(ScrHostOps, has_own); F(ScrHostOps, define_getter);
  F(ScrHostOps, get_iterator); F(ScrHostOps, new_bytes); F(ScrHostOps, bytes_view); F(ScrHostOps, new_error);
  F(ScrHostOps, new_promise); F(ScrHostOps, settle_promise); F(ScrHostOps, promise_subscribe); F(ScrHostOps, module_call);
  F(ScrHostOps, type_probe); F(ScrHostOps, inspect); F(ScrHostOps, new_bytes_owned);
  printf("]},\"constants\":{\"SCR_HV_UNDEFINED\":%d,\"SCR_HV_NULL\":%d,\"SCR_HV_BOOL\":%d,\"SCR_HV_NUMBER\":%d,\"SCR_HV_STRING\":%d,"
         "\"SCR_HV_OBJECT\":%d,\"SCR_HV_CLOSURE\":%d,\"SCR_HV_PROGRAM\":%d,\"SCR_HOST_OK\":%d,\"SCR_HOST_THREW\":%d}}\n",
         SCR_HV_UNDEFINED, SCR_HV_NULL, SCR_HV_BOOL, SCR_HV_NUMBER, SCR_HV_STRING, SCR_HV_OBJECT, SCR_HV_CLOSURE, SCR_HV_PROGRAM,
         SCR_HOST_OK, SCR_HOST_THREW);
  return 0;
}
"#;
