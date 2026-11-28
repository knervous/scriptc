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
  - Zero copy wins where it removes work: in particles the simulation writes the upload buffer in place, and the JavaScript lane is 0.76× the objects-plus-DataView baseline.
  - The generated class's accessors (`getX(i)` over a `DataView` in a class field) took a record index as a double. On WasmGC a class method had no i32 parameters, so every access ran ToIndex on a double offset (truncation, a NaN test, double bounds compares); the field load itself was not the cost. A probe of the same accessors, 2000 records × 500 rounds, took 17.1 ms as methods against 6.2 ms as free functions with an i32 index, and 13.8 ms for those functions with the i32 ABI off. Natively, a method no call site could narrow got no i32 entry, and its access took the same double path.
  - The accessors now take the integer path. On WasmGC a class method that reads or writes typed-array or DataView storage gets an i32 entry for its direct calls whose index is a proven int32 (other calls, virtual dispatch and dyn code run a double-ABI copy of the body), and a double offset that is an in-bounds int32 takes an integer bounds test on both backends. Snapshot went from 95.6 to 30.6 ms on WasmGC (23.5 ms for the object baseline) and from 43.3 to 22.2 ms natively; particles from 190 to 98.7 ms on WasmGC. Measured in this run before the change (same machine): snapshot wasmgc 95.6, native 43.3; particles wasmgc 190, native 20.4.
  - Both apps are still slower compiled than their object baselines (snapshot natively 22.2 against 5.3 ms). Natively the accessors keep a double index wherever one call site cannot prove an int32 (`rng.below(N)` in snapshot), as the WasmGC lane did before its double-ABI copy; a dual entry there, or lowering the generated accessors to direct memory operations, is the next layout item.
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
