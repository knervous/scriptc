//! The generic host with no layer of its own (`default-entry`): what a page program reaches through the vtable, the
//! host's own identity and host modules. One test: the host's document and loop belong to the thread that first asks.

#[path = "../../../tests-support/runtime_stubs.rs"]
mod runtime_stubs;

use scriptc_host::core::abi::{HostOps, HostVal, KIND_NUMBER, KIND_OBJECT, KIND_STRING, OK, THREW};

fn text(v: &HostVal) -> String {
    unsafe { String::from_utf8_lossy(std::slice::from_raw_parts(v.str, v.len)).into_owned() }
}

#[test]
fn the_generic_host_answers_a_page() {
    // SAFETY: the host's own vtable, as the island asks for it.
    let ops: &HostOps = unsafe { &*scriptc_host::scr_host_ops() };
    let global = |name: &str| {
        let mut out = HostVal::UNDEFINED;
        let status = unsafe { (ops.global_get)(name.as_ptr(), name.len(), &mut out) };
        assert_eq!(status, OK, "global {name}");
        out
    };
    let get = |o: u64, name: &str| {
        let mut out = HostVal::UNDEFINED;
        let status = unsafe { (ops.get_prop)(o, name.as_ptr(), name.len(), &mut out) };
        assert_eq!(status, OK, "get {name}");
        out
    };
    for name in ["document", "window", "console", "performance", "navigator", "location", "localStorage", "setTimeout", "fetch"] {
        assert_eq!(global(name).kind, KIND_OBJECT, "{name} is defined");
    }
    // The empty shell (no page named), at the default page URL.
    let document = global("document").r#ref;
    let url = get(document, "URL");
    assert_eq!((url.kind, text(&url)), (KIND_STRING, "http://localhost/".to_string()));
    // Its own identity: the product the default configuration names.
    let ua = get(global("navigator").r#ref, "userAgent");
    assert!(text(&ua).ends_with(&format!(") scriptc-host/{}", env!("CARGO_PKG_VERSION"))), "{}", text(&ua));
    // No layer modules: a module the host does not know throws, naming it; its own page-import answers undefined.
    let call = |m: &str, f: &str| {
        let mut out = HostVal::UNDEFINED;
        let status = unsafe { (ops.module_call)(m.as_ptr(), m.len(), f.as_ptr(), f.len(), 0, std::ptr::null(), &mut out) };
        (status, out)
    };
    let (status, out) = call("my:module", "f");
    assert_eq!((status, text(&out)), (THREW, "my:module: 'f' has no native implementation in the host island".to_string()));
    let (status, out) = call("scriptc:page-import", "import");
    assert_eq!((status, out.kind), (OK, 0));
    // A global the generic host does not define reads undefined.
    assert_eq!(global("__noSuchHook").kind, 0);
    let _ = KIND_NUMBER;
}
