## Reading the results

- **Correctness held everywhere.** Each app's six lanes, plus the extra ones, printed the same checksums, sizes and hashes: physics' state hashes, the codecs' round trips and the blur's image under four threads, one thread and the task ring.
- **int (hash, bitset, lz4, qoi).**
  - On WasmGC the library pays off where the baseline's JavaScript idiom compiles badly (per-kernel tables):
    - xxHash32's rotates: 317.9 ms as shift pairs, 89.4 ms as `i32.rotl`;
    - the bitset scan's popcount and ctz: 367.5 to 187.8 ms;
    - LZ4's compressor, whose match extension uses `ctz` over 4-byte words: 127.1 to 74.9 ms.
  - xxHash64 over bigints: 23.7 ms in the WasmGC baseline and 8.4 ms with the library, against 12.9 ms in V8's JavaScript. Natively, 7.5 against 1.7 ms. A 64-bit chain of library calls stays in i64 registers and crosses to a bigint only at its ends.
  - Natively the 32-bit baselines were already close: LLVM recognises shift-pair rotates itself. The library still gains on xxHash32 (63.2 to 45.6 ms) and on LZ4's compressor (71.6 to 51.1 ms).
  - QOI's work is byte loads and branches, which the library does not change. It is in the set as a control.
- **math (physics).**
  - The strict-math library gave the same doubles on every lane. Here the `Math` baseline happens to agree too: V8 and the native runtime both ship V8's fdlibm, and the step's `pow` arguments happened to round the same. Only the library guarantees it, on other engines, CPUs and inputs.
  - The library costs about 1.3× V8's built-in Math as plain JavaScript (one call per function, typed-array word access), and nothing on WasmGC, where it calls the same in-module routines `Math` uses.
  - Natively it runs at 0.58× of JavaScript, against 0.39× for `Math`: the runtime's C port is faster than the generated TypeScript bodies compiled.
- **layout (snapshot, particles).** Two effects pull in opposite directions.
  - Zero copy wins where it removes work: in particles the simulation writes the upload buffer in place, and the JavaScript lane is 0.66× the objects-plus-DataView baseline.
  - Compiled, both layout apps are slower than their object baselines: 130 against 24 ms (snapshot, WasmGC) and 64.5 against 7.3 ms (native). The cause is the generated class's `DataView` held in a class field. A probe of the same accessors, 2000 records × 500 rounds, took 34.4 ms through a field-held DataView and 8.9 ms through a module-level one on WasmGC; natively, 3.0 ms (generated class), 20.6 ms (`RecordView`) and 0.7 ms (a local DataView).
  - The accessors do compile to fixed-offset loads and stores. The overhead is the view object's base, length and bounds held behind a field on every access. Caching them, or lowering the generated accessors to direct memory operations, is the next layout item.
- **f16 (f16-mesh).**
  - The engine's `Float16Array` (the `js` lane) is the fastest conversion: V8 converts in C++. The library's JavaScript entry uses it (`js+fallback (engine)`, 1.7×).
  - The software path in plain JavaScript is 10×, and WasmGC's conversion in wasm is 8.8×. It works on the double's bits with `i64.reinterpret`; a first version through a Float64Array scratch word took 1072 ms.
  - Natively, the runtime's C conversion is 2.7×; F16C and NEON instructions are a later item.
  - The baseline has no compiled lanes: neither backend lowers `Float16Array` or `Math.f16round` (SC2020). This gap is why the library exists.
- **atomics (blur).**
  - Four worker threads over shared memory, claiming bands from a `WorkCounter`, ran at 0.31× of the one-thread JavaScript lane. That lane was slow in this receipt (258 ms; 141 ms in an earlier run), so the speedup against `js+fallback` (147 ms), 0.54×, is the steadier figure.
  - The task ring's owner-thread drain (threads=off) gives the same image at 0.65×.
  - The compiled lanes run the claim loop on one thread. Atomic adds on unshared memory cost nothing measurable (native 90.5 against 76.7 ms, near the run-to-run noise).
  - The WasmGC blur is slow in both versions (3×), from typed-array element access in the inner loop, not from the atomics.
- **Sizes.** The libraries add little to a module: the hash app is 6.5 KiB of WasmGC with the int library against 7.8 KiB for its baseline, because lowered calls emit no bodies. Native binaries are dominated by the runtime (about 440 KiB).

## What was not measured

- The WasmGC threads=shared lane: a WasmGC module with shared memory needs a wasm link (`wasmLink.memory.shared`) and worker instances, and the blur app does not build that. Its WasmGC lane is threads=off.
- Browsers: every WasmGC lane ran under Node 24's V8, and no page lane ran (no app needs the DOM).
- Other machines: these are single runs on one 4-core x64 Linux container, with timing noise of about ±10% (the `js` lanes vary most between runs).
