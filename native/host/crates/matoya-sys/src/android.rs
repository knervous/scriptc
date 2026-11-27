//! libmatoya's JNI entry points under their JNI names. build.rs compiles them as `mty_jni_*` (a Rust
//! cdylib exports only Rust's symbols); each is re-exported here, so `Matoya.java`'s natives and the VM's
//! `JNI_OnLoad` find them in `libmain.so`. The signatures are app.c's and system.c's.

use std::ffi::c_void;

type Env = *mut c_void;
type Obj = *mut c_void;
type JBool = u8;

macro_rules! reexport {
    ($($jni:ident => $mty:ident ( $($arg:ident : $ty:ty),* ) $(-> $ret:ty)?;)*) => {
        unsafe extern "C" {
            $(fn $mty(env: Env, obj: Obj $(, $arg: $ty)*) $(-> $ret)?;)*
        }
        $(
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn $jni(env: Env, obj: Obj $(, $arg: $ty)*) $(-> $ret)? {
                unsafe { $mty(env, obj $(, $arg)*) }
            }
        )*
    };
}

reexport! {
    Java_group_matoya_lib_Matoya_app_1start => mty_jni_app_start();
    Java_group_matoya_lib_Matoya_app_1stop => mty_jni_app_stop();
    Java_group_matoya_lib_Matoya_gfx_1resize => mty_jni_gfx_resize(w: i32, h: i32);
    Java_group_matoya_lib_Matoya_gfx_1set_1surface => mty_jni_gfx_set_surface(surface: Obj);
    Java_group_matoya_lib_Matoya_gfx_1unset_1surface => mty_jni_gfx_unset_surface();
    Java_group_matoya_lib_Matoya_app_1key => mty_jni_app_key(pressed: JBool, code: i32, text: Obj, mods: i32, soft: JBool) -> JBool;
    Java_group_matoya_lib_Matoya_app_1check_1scroller => mty_jni_app_check_scroller(check: JBool);
    Java_group_matoya_lib_Matoya_app_1unhandled_1touch => mty_jni_app_unhandled_touch(action: i32, x: f32, y: f32, fingers: i32);
    Java_group_matoya_lib_Matoya_app_1single_1tap_1up => mty_jni_app_single_tap_up(x: f32, y: f32);
    Java_group_matoya_lib_Matoya_app_1long_1press => mty_jni_app_long_press(x: f32, y: f32) -> JBool;
    // [fork] One finger's raw touch (app.c app_touch): phase 0 down, 1 move, 2 up, 3 cancel.
    Java_group_matoya_lib_Matoya_app_1touch => mty_jni_app_touch(phase: i32, id: i32, x: f32, y: f32);
    Java_group_matoya_lib_Matoya_app_1scroll => mty_jni_app_scroll(abs_x: f32, abs_y: f32, x: f32, y: f32, fingers: i32);
    Java_group_matoya_lib_Matoya_app_1mouse_1motion => mty_jni_app_mouse_motion(relative: JBool, x: f32, y: f32);
    Java_group_matoya_lib_Matoya_app_1generic_1scroll => mty_jni_app_generic_scroll(x: f32, y: f32);
    Java_group_matoya_lib_Matoya_app_1mouse_1button => mty_jni_app_mouse_button(pressed: JBool, button: i32, x: f32, y: f32);
    Java_group_matoya_lib_Matoya_app_1button => mty_jni_app_button(device_id: i32, pressed: JBool, button: i32);
    Java_group_matoya_lib_Matoya_app_1axis => mty_jni_app_axis(device_id: i32, hat_x: f32, hat_y: f32, l_x: f32, l_y: f32, r_x: f32, r_y: f32, l_t: f32, r_t: f32, l_t_alt: f32, r_t_alt: f32);
    Java_group_matoya_lib_Matoya_app_1unplug => mty_jni_app_unplug(device_id: i32);
}

unsafe extern "C" {
    fn mty_jni_on_load(vm: *mut c_void, reserved: *mut c_void) -> i32;
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn JNI_OnLoad(vm: *mut c_void, reserved: *mut c_void) -> i32 {
    unsafe { mty_jni_on_load(vm, reserved) }
}
