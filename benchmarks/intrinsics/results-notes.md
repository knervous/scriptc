## Reading the results

- **Correctness held everywhere.** Each app's six lanes, plus the extra ones, printed the same checksums, sizes and hashes: physics' state hashes, the codecs' round trips and the blur's image on every thread lane (JavaScript, WasmGC under Node and in Chromium, native) and through the task ring.
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
  - Natively the accessors then stayed real calls: past LLVM's cost threshold, and with more call sites than the loop-callee rule took (two). A one-statement leaf called only from loops now inlines at up to 32 call sites, so no accessor call is left in the snapshot binary: 22.2 to 13.3 ms. Particles, whose accessors were already inlined, is unchanged (21.1 ms). A dual int32 entry for the accessors was measured first and dropped (25.0 against 22.5 ms): the integer test for double offsets already covered it.
  - Both apps are still slower compiled than their object baselines: snapshot 29.9 against 21.4 ms on WasmGC and 13.3 against 5.2 ms natively, particles 98.7 against 82.6 and 21.1 against 12.4 ms. Each access still reads the view's base and length through the class field and tests its bounds; lowering the generated accessors to direct memory operations, or hoisting those reads out of the caller's loop, is the next layout item.
- **f16 (f16-mesh).**
  - The engine's `Float16Array` (the `js` lane) is the fastest conversion: V8 converts in C++. The library's JavaScript entry uses it (`js+fallback (engine)`, 1.7×).
  - The software path in plain JavaScript is 10×, and WasmGC's conversion in wasm is 8.8×. It works on the double's bits with `i64.reinterpret`; a first version through a Float64Array scratch word took 1072 ms.
  - Natively, the runtime's C conversion is 2.7×; F16C and NEON instructions are a later item.
  - The baseline has no compiled lanes: neither backend lowers `Float16Array` or `Math.f16round` (SC2020). This gap is why the library exists.
- **atomics (blur).** The Threads table has the thread lanes, each the median of three runs on this 4-core machine, against single-threaded JavaScript run the same way (137 ms for both `baseline.ts` and `main.ts`).
  - JavaScript with four worker threads over `SharedArrayBuffer`s ran at 0.39× (53 ms).
  - The task ring's owner-thread drain (threads=off) gives the same image at 1.25×.
  - WasmGC threads=shared: one instance of `shared.ts` per worker, every instance importing one shared `WebAssembly.Memory` that holds the image, the scratch rows and the counter cell, which the host passes to the link exports as byte spans. Under Node it scales 562, 286 and 149 ms for 1, 2 and 4 workers (1.9× and 3.8×). In headless Chromium 158, cross-origin isolated with one module Worker per thread, it is 432, 219 and 120 ms.
  - Four WasmGC workers only reach single-threaded JavaScript (1.08× under Node, 0.87× in Chromium), because the WasmGC kernel is about 4× slower than V8's JavaScript on one thread. The cost is in the kernel's typed-array element access (the single-thread finding), not in the atomics or the threads: the threads=off build is about as slow (658 ms).
  - Native threads: `shared.ts` built as a thread-instanced library (`abi.instance_per_thread`), with a small pthreads host (`native-host.c`) that keeps the buffers in its own memory and passes them as `mutable-bytes`. One thread runs at the native executable's speed (66 against 69 ms), and 2 and 4 threads at 34 and 22 ms (0.25× and 0.16× of JavaScript, 3.0× over one thread at four).
  - Three compiler gaps stood in the way and are fixed, each with its test. A link build on a shared memory recorded `threads=off`; it now records `threads=shared`, and so does `--explain-capabilities`. Instances on one shared memory each kept their own allocator heap top, so they could hand out the same blocks. And a library build left its module constants as globals inside every loop, which made the native kernel 3× slower as a library (212 ms) than as an executable (72 ms).
  - The native lane is a library, not `workers.ts` compiled: the native frontend does not lower `worker_threads` yet (SC2020 on `new Worker`).
- **Sizes.** The libraries add little to a module: the hash app is 6.5 KiB of WasmGC with the int library against 7.8 KiB for its baseline, because lowered calls emit no bodies. Native binaries are dominated by the runtime (about 440 KiB).

## What was not measured

- Thread lanes for the other apps. None of them splits without changing its output: xxHash32 and LZ4 over independent chunks or blocks give different hashes and streams than over the whole input, so their checksums could not match the single-threaded lanes.
- Browsers: apart from the blur's Chromium row, every WasmGC lane ran under Node 24's V8.
- Other machines: these are runs on one 4-core x64 Linux container, single runs except in the Threads table, with timing noise of about ±10% (the `js` lanes vary most between runs: the blur's single run took 161 ms, and its three runs 128 to 140).
