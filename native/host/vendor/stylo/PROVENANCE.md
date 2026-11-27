# Stylo (vendored)

Source: crates.io `stylo` 0.22.0 (the version every native crate resolves), MPL-2.0. Copied unchanged from the
registry, then patched; native/Cargo.toml's `[patch.crates-io]` points the dependency here. This fork's changes are
marked `[fork]`; each is meant to go upstream:

- `background-clip: text` parses in Servo builds too (values/specified/background.rs), so `@supports
  (background-clip: text)` passes and blitz-paint clips the background to the element's glyphs.
- `mask-border-source`, `-slice`, `-width`, `-outset`, `-repeat`, `-mode` and the `mask-border` shorthand, with the
  `-webkit-mask-box-image*` aliases (properties/longhands.toml, shorthands.toml), using the border-image value types;
  blitz-paint draws them in its mask layer.
