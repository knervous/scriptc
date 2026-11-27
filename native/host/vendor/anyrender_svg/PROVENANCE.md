# anyrender_svg (vendored)

- **Upstream:** crates.io `anyrender_svg` 0.15.0 (https://github.com/dioxuslabs/anyrender), `MIT OR Apache-2.0`. The
  licence texts (`LICENSE-MIT`, `LICENSE-APACHE`) are the upstream repository's.
- **Why vendored:** two rendering fixes, patched in through the workspace's `[patch.crates-io]`.
- **Changes** (each marked `[fork]` in the source; the diff against the crates.io package touches only these files):
  - `src/render.rs`: a filtered group (SVG filter effects, which this renderer does not draw) is skipped rather than
    drawn without its filter (which shows as a wrong fill); a raster image's decode is kept per encoded source, so an unchanged large image is
    not decoded and uploaded again on every paint.
  - `src/util.rs`: the decode cache behind that (`decode_raw_raster_image` plus `into_image`, keyed by the identity of
    the encoded bytes).
