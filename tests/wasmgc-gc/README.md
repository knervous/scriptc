# GC measurement tools (GC_DISCOVERY.md)

Phase-robust and unit-level GC measurements for WasmGC builds against their JS lanes.

- `gcloop.mjs <stage> <file.wasm|file.js> <op> <n> [warm]` runs n back-to-back graph ops (mount = start+stop,
  reorder, context, increment) under jsdom with no checks. `PAD=<MB>` allocates U(0, PAD) MB of dead objects before
  each op so the op starts at a uniformly random nursery phase; only GCs that start inside op windows are counted
  (an unbiased amortized per-op GC estimate). Run with `--single-threaded-gc --min-semi-space-size=16
  --max-semi-space-size=16 --trace-gc-nvp`, then `gcwin.mjs <output>` picks the in-window nvp lines: scavenges,
  scavenge ms, survived and promoted MB, mark-compact ms per op.
- `gcunit.mjs [n] [reps]` (with `--expose-gc --single-threaded-gc`): GC cost per object for one live linked list
  of n objects in each layout (split header + slot array, inline slots, slim struct, struct + number box, JS
  object): ns per object for allocation, the copying scavenge, the promoting scavenge and a full mark.
- `gcwork.js` + `gcbench.ts` + `mbrun.mjs`: generic object-heavy workloads (short-lived records, retained records,
  map-like objects with computed keys, element trees with closures); `mbrun.mjs <dir> <file> <op> <reps>`
  prints allocation and GC per op. Bundle the JS lane with esbuild (`gcbench.js`) next to the wasm builds.
- `livesnap.mjs` / `snapdiff.mjs`: heap snapshots before and after a mount and their difference by node type
  (wasm types labelled from the build's .wat; V8's canonical type index is the module index plus an offset).
- `classes.mjs`: per-op allocation census grouped into lifetime/escape classes.
Heap snapshots crash Node 26.7 (V8 SIGSEGV) on experimentalDynI31 builds.
