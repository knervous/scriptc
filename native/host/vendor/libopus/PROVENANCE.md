# libopus, vendored

Upstream: libopus 1.6.1, the Xiph.Org release tarball
https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz
(sha256 `6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1`, as listed in
https://downloads.xiph.org/releases/opus/SHA256SUMS.txt). BSD 3-clause (COPYING; the patent grants it names are in
COPYING's notice).

Used by `audio-decode` (decodeAudioData for the native host), whose build.rs compiles the float
library from the lists in `celt_sources.mk`, `silk_sources.mk` and `opus_sources.mk` (CELT_SOURCES, SILK_SOURCES,
SILK_SOURCES_FLOAT, OPUS_SOURCES, OPUS_SOURCES_FLOAT; on x86_64 also CELT_SOURCES_SSE and CELT_SOURCES_SSE2, with SSE
and SSE2 presumed). No deep PLC, DRED, OSCE or QEXT: those are off by default upstream too.

Copied unchanged from the tarball: `include/`, `celt/`, `silk/`, `src/`, the `*_sources.mk` and `*_headers.mk` lists,
COPYING, AUTHORS, README, NEWS and package_version. Not vendored:

- `dnn/` (23 MB: the deep PLC, DRED and OSCE models and code, compiled only with ENABLE_DEEP_PLC, ENABLE_DRED or
  ENABLE_OSCE);
- the fixed-point SILK sources (`silk/fixed/`) and the ARM and MIPS optimizations (`celt/arm/`, `celt/mips/`,
  `silk/arm/`, `silk/mips/`);
- tests (`tests/`, `celt/tests/`, `silk/tests/`), demos and tools (`src/opus_demo.c`, `src/opus_compare.c`,
  `src/qext_compare.c`, `src/repacketizer_demo.c`, `celt/opus_custom_demo.c`, `celt/dump_modes/`), and docs;
- the build systems (autotools, CMake, Meson): build.rs is the build.

When syncing: replace these directories from the new tarball, delete what is listed above, and diff the `*.mk` lists
(build.rs reads them, so a new source file is picked up; a new list or define is not).
