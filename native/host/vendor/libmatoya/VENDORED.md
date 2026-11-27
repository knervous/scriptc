# libmatoya (vendored)

Upstream: https://github.com/matoya/libmatoya, commit `952f2a22bdb4cf832db110c00aa3e57952358eae` (2024-11-11), MIT (see LICENSE).
Vendored 2026-10-14 for a native host. Unmodified except for one patch, raw touch input on Android, whose edits
are marked `[fork]`:

- `src/matoya.h`: a new event type `MTY_EVENT_TOUCH` (27) and an `MTY_TouchEvent` struct (pointer id, x, y,
  phase: 0 down, 1 move, 2 up, 3 cancel), added to the `MTY_Event` union as `touch`.
- `src/unix/linux/android/Matoya.java`: `onTouchEvent` reports each finger's down, moves and up (and cancel) by
  pointer id through a new native `app_touch`, instead of feeding the gesture detector's taps and scrolls. Mouse
  events keep upstream's path.
- `src/unix/linux/android/app.c`: `Java_group_matoya_lib_Matoya_app_1touch` pushes an `MTY_EVENT_TOUCH`, so the
  app sees fingers (a drag is a held pointer and several fingers act at once).

Built by the `matoya-sys` crate's `build.rs` (cc crate, macOS file list from upstream's GNUmakefile Darwin section). The Metal shader headers (`shaders/*.h`) are generated into the build's OUT_DIR, not into this tree.

Upstream's own make also works on macOS when xcrun is pointed at CommandLineTools:

    DEVELOPER_DIR=/Library/Developer/CommandLineTools make ARCH=arm64

To sync: clone upstream, diff against this directory, re-apply any `[fork]` edits, update the commit above.

Removed from upstream: `deps/bin/glslangValidator.exe` (a prebuilt Windows binary, used only to regenerate Vulkan shader headers; install glslang separately if that is ever needed).
