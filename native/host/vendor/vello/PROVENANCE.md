# vello 0.11.0 (vendored)

crates.io `vello` 0.11.0 as published, wired in by the host's `[patch.crates-io]`
(with `vendor/vello_shaders`, which holds the Mali shader fixes: see its PROVENANCE.md). Every change in this fork is
marked `[fork]`.

## `VELLO_GPU_FROM=<stage>` (src/wgpu_engine.rs)

A bisect tool for a driver that fails under Vello. With CPU stages on (`VELLO_CPU=1` in blitz-ui's
gpu_paint), the named stage and every stage registered after it run on the GPU instead. Vello's engine uploads
CPU-written buffers into GPU stages but never reads GPU results back, so only a CPU prefix and a GPU suffix
work. Stage names are the shader names without `vello.`, in registration order: `pathtag_reduce`,
`pathtag_reduce2`, `pathtag_scan1`, `pathtag_scan_small`, `pathtag_scan_large`, `bbox_clear`, `flatten`,
`draw_reduce`, `draw_leaf`, `clip_reduce`, `clip_leaf`, `binning`, `tile_alloc`, `path_count_setup`,
`path_count`, `backdrop_dyn`, `coarse`, `path_tiling_setup`, `path_tiling`, `fine_area`.

A lost device is silent in wgpu (the front end drops `DeviceLost` errors): the only sign is
"Buffer with 'vello.scene' label is invalid" on the next frame, and a black screen.

## `VELLO_TIMING=1` (src/wgpu_engine.rs, `stage_timing`)

Every GPU stage dispatch timed by timestamp queries (the device needs TIMESTAMP_QUERY), read back without waiting,
and every two seconds each stage's GPU ms per paint printed (a paint counted by its fine dispatch), e.g. on the
Pixel 8 on a heavy scene (2026-11-09): `11.17 ms GPU per paint: fine_area 9.54, coarse 0.47, backdrop_dyn 0.32, ...`.

## Transient images dropped, not destroyed (src/wgpu_engine.rs, `destroy_images`)

A recording's transient images (the gradient ramps, the image atlas) are dropped at its end instead of
`destroy()`ed: wgpu-core's `Texture::destroy` takes the device's snatch lock for writing, so on a device another
thread is submitting on (the Windows host's GPU executor thread) every UI paint waited for that thread's open
submit; a profile of a busy animated scene (2026-11-19) had 38% of the page's paint samples there. A dropped texture
is freed once the GPU has finished with it. `VELLO_DESTROY=1` destroys them as upstream does.

- `src/render.rs` `render_encoding_coarse` [fork]: a scene that resolves no images keeps the persistent image atlas.
  Upstream replaced it with a 1x1 atlas (freeing the texture) while the image cache kept its residents as clean, so the
  next scene's images drew from an empty atlas.
