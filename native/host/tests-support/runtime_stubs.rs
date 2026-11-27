//! The runtime's side of the host island, stubbed, for a test or example that links the host without a compiled program:
//! no closure is ever handed over, so no callback runs. Include it with `#[path]`.
#![allow(dead_code, non_upper_case_globals)]

// The runtime's side of the island, stubbed (abi.rs, values.rs, workers.rs import these).
#[unsafe(no_mangle)]
pub extern "C" fn scr_remote_set_wake(_wake: unsafe extern "C" fn(*mut std::ffi::c_void), _ctx: *mut std::ffi::c_void) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_closure_call(_c: u64, _argc: i32, _argv: *const std::ffi::c_void, _out: *mut std::ffi::c_void) -> i32 {
    0
}
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_closure_retain(_c: u64) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_closure_release(_c: u64) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_take_exception(_out: *mut std::ffi::c_void) -> i32 {
    0
}
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_object_disposed(_obj: u64) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_on_fiber() -> bool {
    false
}
#[unsafe(no_mangle)]
pub static mut scr_uncaught_exception_hook: Option<unsafe extern "C" fn(bool) -> i32> = None;
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_bytes_release(_owner: *mut std::ffi::c_void) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_instance_remote() -> *mut std::ffi::c_void {
    std::ptr::null_mut()
}
#[unsafe(no_mangle)]
pub extern "C" fn scr_remote_post(_remote: *mut std::ffi::c_void, _task: unsafe extern "C" fn(*mut std::ffi::c_void), _arg: *mut std::ffi::c_void) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_remote_hold(_delta: i32) {}
#[unsafe(no_mangle)]
pub extern "C" fn scr_thread_run_loop() -> i32 {
    0
}

