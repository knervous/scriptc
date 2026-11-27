# anyrender_vello_cpu (vendored)

- **Upstream:** crates.io `anyrender_vello_cpu` 0.18.0 (https://github.com/dioxuslabs/anyrender), `MIT OR Apache-2.0`.
  The licence texts (`LICENSE-MIT`, `LICENSE-APACHE`) are the upstream repository's.
- **Why vendored:** one rendering fix, patched in through the workspace's `[patch.crates-io]`.
- **Changes** (marked `[fork]` in the source; the diff against the crates.io package touches only this file):
  - `src/scene.rs`: a clip is pushed as a clip layer rather than an isolated layer, as Vello on the GPU clips: what
    draws inside composites straight onto what is below it.
