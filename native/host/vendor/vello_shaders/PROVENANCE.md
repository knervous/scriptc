# vello_shaders 0.11.0 (vendored)

crates.io `vello_shaders` 0.11.0 as published, wired in by the host's `[patch.crates-io]`.
Every change in this fork is marked `[fork]` in the WGSL.

## Mali: no `select()` over a workgroup read at `[i - 1u]`

On the Pixel 8 (Mali-G715, Vulkan driver r54p3) Vello's GPU stages lost the device on the first non-empty
scene (seen 2026-10-23 and 2026-11-08). A cut-point bisect (`VELLO_GPU_FROM`, vendor/vello) put the
loss in `coarse`, then in `backdrop_dyn`. Each has the binary-search fix-up

```wgsl
let seq_ix = ix - select(0u, sh_tile_count[el_ix - 1u], el_ix > 0u);
```

`select` evaluates both arms, so with `el_ix == 0` it reads the workgroup array at `0u - 1u`. wgpu's Vulkan
backend clamps that index (naga `BoundsCheckPolicy::Restrict`), so the read is in bounds on paper, yet the
driver loses the device. Rewriting the select as a branch fixed `backdrop_dyn` alone (with
`workgroupUniformLoad` left as it was, which naga lowers as barrier, load, barrier anyway) and then the whole
pipeline. All five such sites are rewritten:

- `coarse.wgsl`: the partition fix-up (`sh_part_count[part_ix - 1u]`) and the tile fix-up (`sh_tile_count[el_ix - 1u]`);
- `backdrop_dyn.wgsl`: `sh_row_count[el_ix - 1u]`;
- `tile_alloc.wgsl`: `sh_tile_count[local_id.x - 1u]`;
- `fine.wgsl`: the two MSAA paths' `sh_count[el_ix - 1u]` (not used by area AA; changed for the same reason).

The results are unchanged (a branch computes what the select did). A heavy scene on the Pixel 8 went from 14–16 fps
(Vello's stages on the CPU) to 20 fps with all of Vello on the GPU.

Related driver erratum (a different shape, also out-of-bounds reads in branches never taken):
https://community.arm.com/support-forums/f/mobile-graphics-and-gaming-forum/54204/device-lost-due-to-oob-accesses-in-not-taken-branches
