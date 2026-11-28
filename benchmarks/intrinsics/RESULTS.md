# Results

One receipt per benchmark, written by `run.mjs` (receipts/*.json). Machine: linux-x64, 4 × Intel(R) Xeon(R) Processor @ 2.30GHz, Node v24.22.1. Date: 2026-11-28.

Times are milliseconds measured inside each program around the work only (no startup, no compilation). Ratios are the lane's time over the `js` lane's (lower is faster). Every lane's result lines (checksums, sizes, hashes) were compared with the `js` lane's; ✓ means byte-identical. Single runs: differences under about 10% are noise.

| App | js | js+fallback | wasmgc-base | wasmgc | native-base | native | extra lanes |
|---|---|---|---|---|---|---|---|
| hash | 131 (1.00×) ✓ | 147 (1.12×) ✓ | 425 (3.25×) ✓ | 198 (1.51×) ✓ | 198 (1.51×) ✓ | 119 (0.91×) ✓ |  |
| qoi | 37.7 (1.00×) ✓ | 32.5 (0.86×) ✓ | 104 (2.76×) ✓ | 106 (2.81×) ✓ | 26.0 (0.69×) ✓ | 21.0 (0.56×) ✓ |  |
| lz4 | 268 (1.00×) ✓ | 305 (1.14×) ✓ | 297 (1.11×) ✓ | 249 (0.93×) ✓ | 199 (0.74×) ✓ | 272 (1.01×) ✓ |  |
| bitset | 121 (1.00×) ✓ | 94.8 (0.78×) ✓ | 430 (3.55×) ✓ | 362 (2.99×) ✓ | 87.8 (0.72×) ✓ | 80.5 (0.66×) ✓ |  |
| physics | 82.5 (1.00×) ✓ | 165 (2.00×) ✓ | 218 (2.65×) ✓ | 233 (2.82×) ✓ | 43.5 (0.53×) ✓ | 64.9 (0.79×) ✓ |  |
| snapshot | 23.4 (1.00×) ✓ | 28.9 (1.24×) ✓ | 15.2 (0.65×) ✓ | 25.1 (1.07×) ✓ | 9.5 (0.41×) ✓ | 17.2 (0.74×) ✓ |  |
| particles | 65.4 (1.00×) ✓ | 48.6 (0.74×) ✓ | 139 (2.13×) ✓ | 163 (2.48×) ✓ | 14.7 (0.22×) ✓ | 26.5 (0.41×) ✓ |  |
| f16-mesh | 34.1 (1.00×) ✓ | 365 (10.71×) ✓ | n/a | 219 (6.41×) ✓ | n/a | 114 (3.35×) ✓ | js+fallback (engine): 72.3 (2.12×) ✓ |
| blur | 216 (1.00×) ✓ | 256 (1.19×) ✓ | 247 (1.15×) ✓ | 156 (0.72×) ✓ | 68.3 (0.32×) ✓ | 69.1 (0.32×) ✓ |  |

## Threads

Machine: 4 cores (Intel(R) Xeon(R) Processor @ 2.30GHz). Every lane here is the median of its recorded runs (`runs` in the receipt), and each ratio is over the JS column: `baseline.ts` under Node, run the same way. The JS 4 workers, WasmGC and native lanes run the kernel of `main.ts` (the JS (main.ts) column: bands claimed from a WorkCounter) on one shared image, except WasmGC threads=off and native, which are the main table's single runs of main.ts; the WasmGC shared lanes run under Node's worker_threads, and the Chromium row runs the same module in headless Chromium, cross-origin isolated, one module Worker per thread.

| App | JS | JS (main.ts) | JS 4 workers | WasmGC threads=off | WasmGC shared 1 | WasmGC shared 2 | WasmGC shared 4 | native | native threads 1 | native threads 2 | native threads 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| blur | 147 (1.00×) ✓ | 148 (1.01×) ✓ | 74.2 (0.51×) ✓ | 156 (1.06×) ✓ | 155 (1.06×) ✓ | 70.1 (0.48×) ✓ | 37.9 (0.26×) ✓ | 69.1 (0.47×) ✓ | 75.3 (0.51×) ✓ | 46.3 (0.32×) ✓ | 24.7 (0.17×) ✓ |
| blur, Chromium | 147 (1.00×) ✓ |  |  |  | 142 (0.97×) ✓ | 82.5 (0.56×) ✓ | 45.0 (0.31×) ✓ |  |  |  |  |

- **blur**: the WasmGC shared build records `wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=shared`. The task ring's owner-thread drain (threads=off): 157 ms (1.07×) ✓.


## Per kernel

**hash**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| xxh32 | 28.5 | 36.6 | 290 | 79.8 | 95.0 | 29.5 |
| crc32 | 90.1 | 93.9 | 112 | 112 | 91.3 | 88.2 |
| xxh64 | 12.3 | 16.6 | 23.2 | 6.2 | 11.3 | 1.5 |

**qoi**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| encode | 19.6 | 15.7 | 49.6 | 49.7 | 12.8 | 7.4 |
| decode | 18.0 | 16.8 | 54.4 | 56.3 | 13.2 | 13.6 |

**lz4**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| compress | 61.2 | 57.1 | 118 | 67.8 | 63.6 | 59.0 |
| decompress | 207 | 248 | 179 | 181 | 135 | 213 |

**bitset**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| sieve | 26.3 | 28.8 | 129 | 203 | 27.0 | 26.5 |
| scan | 95.0 | 66.0 | 302 | 159 | 60.8 | 54.0 |

## Results each lane printed

- **hash**: `xxh32 2799302071 crc32 3593467393 xxh64 64066dcfcdb4c131 / xxh32 of 'abc' 852579327 xxh64 of 'abc' 44bc2cf5ad770999`
- **qoi**: `qoi bytes 553732 of 1048576 encoded 4085297757 round trip exact`
- **lz4**: `lz4 bytes 1008099 of 2097152 packed 858022416 round trip exact`
- **bitset**: `primes below 4000000 283146 odd primes 283145 sum 544501644261`
- **physics**: `state hashes b92cc968 c3416bc8 e97dc6b5 51db6ee6 / body 0 25.646762624708504 4.742620337933584 -0.5632975382999408`
- **snapshot**: `packets 300 bytes 1125685 per packet 3752 hash 3139431730 mirror equal`
- **particles**: `vertex bytes 640000 frames 120 hash 4115759411`
- **f16-mesh**: `bytes 5120000 -> 2560000 max position error 0.00390625 packed 4278791832`
- **blur**: `bands 24 jobs 192 blurred 3658215008`

## Binary sizes

| App | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|
| hash | 7.8 KiB | 6.6 KiB | 447.1 KiB | 428.2 KiB |
| qoi | 13.5 KiB | 13.0 KiB | 407.2 KiB | 402.5 KiB |
| lz4 | 8.6 KiB | 8.4 KiB | 425.6 KiB | 425.7 KiB |
| bitset | 2.9 KiB | 2.6 KiB | 391.2 KiB | 381.2 KiB |
| physics | 17.3 KiB | 20.2 KiB | 377.1 KiB | 470.1 KiB |
| snapshot | 6.9 KiB | 8.4 KiB | 435.2 KiB | 433.7 KiB |
| particles | 3.8 KiB | 4.2 KiB | 356.3 KiB | 406.5 KiB |
| f16-mesh | n/a | 8.8 KiB | n/a | 435.8 KiB |
| blur | 3.3 KiB | 3.7 KiB | 390.9 KiB | 402.2 KiB |

## Lanes that did not run

- f16-mesh wasmgc-base: SC2020 'Float16Array<ArrayBuffer>' is part of the standard library types but has no scriptc lowering yet; SC2020 'new Float16Array' is part of the standard library types but has no scriptc lowering yet; SC1090 assignment to non-array elements are not supported yet; SC2004 uses of 'half' inherit the blocker on its declaration
- f16-mesh native-base: SC2020 'Float16Array<ArrayBuffer>' is part of the standard library types but has no scriptc lowering yet; SC2020 'new Float16Array' is part of the standard library types but has no scriptc lowering yet; SC1090 assignment to non-array elements are not supported yet; SC2004 uses of 'half' inherit the blocker on its declaration

## Reading the results

- **Correctness held everywhere.** Each app's six lanes, plus the extra ones, printed the same checksums, sizes and hashes: physics' state hashes, the codecs' round trips and the blur's image on every thread lane (JavaScript, WasmGC under Node and in Chromium, native) and through the task ring.
- **int (hash, bitset, lz4, qoi).**
  - On WasmGC the library pays off where the baseline's JavaScript idiom compiles badly (per-kernel tables):
    - xxHash32's rotates: 290 ms as shift pairs, 79.8 ms as `i32.rotl`;
    - the bitset scan's popcount and ctz: 302 to 159 ms;
    - LZ4's compressor, whose match extension uses `ctz` over 4-byte words: 118 to 67.8 ms.
  - xxHash64 over bigints: 23.2 ms in the WasmGC baseline and 6.2 ms with the library, against 12.3 ms in V8's JavaScript. Natively, 11.3 against 1.5 ms. A 64-bit chain of library calls stays in i64 registers and crosses to a bigint only at its ends.
  - Natively the 32-bit baselines were already close: LLVM recognises shift-pair rotates itself. The library still gains on xxHash32 (95.0 to 29.5 ms here; 63.2 to 45.6 in an earlier receipt) and less clearly on LZ4's compressor (63.6 to 59.0 ms).
  - QOI's work is byte loads and branches, which the library does not change. It is in the set as a control.
- **math (physics).**
  - The strict-math library gave the same doubles on every lane. Here the `Math` baseline happens to agree too: V8 and the native runtime both ship V8's fdlibm, and the step's `pow` arguments happened to round the same. Only the library guarantees it, on other engines, CPUs and inputs.
  - The library costs 1.3× to 2× V8's built-in Math as plain JavaScript (one call per function, typed-array word access; 2.0× in this receipt), and nothing on WasmGC, where it calls the same in-module routines `Math` uses.
  - Natively it runs at 0.79× of JavaScript, against 0.53× for `Math`: the runtime's C port is faster than the generated TypeScript bodies compiled.
- **layout (snapshot, particles).** Two effects pull in opposite directions.
  - Zero copy wins where it removes work: in particles the simulation writes the upload buffer in place, and the JavaScript lane is 0.76× the objects-plus-DataView baseline.
  - The generated class's accessors (`getX(i)` over a `DataView` in a class field) took a record index as a double. On WasmGC a class method had no i32 parameters, so every access ran ToIndex on a double offset (truncation, a NaN test, double bounds compares); the field load itself was not the cost. A probe of the same accessors, 2000 records × 500 rounds, took 17.1 ms as methods against 6.2 ms as free functions with an i32 index, and 13.8 ms for those functions with the i32 ABI off. Natively, a method no call site could narrow got no i32 entry, and its access took the same double path.
  - The accessors now take the integer path. On WasmGC a class method that reads or writes typed-array or DataView storage gets an i32 entry for its direct calls whose index is a proven int32 (other calls, virtual dispatch and dyn code run a double-ABI copy of the body), and a double offset that is an in-bounds int32 takes an integer bounds test on both backends. Snapshot went from 95.6 to 30.6 ms on WasmGC (23.5 ms for the object baseline) and from 43.3 to 22.2 ms natively; particles from 190 to 98.7 ms on WasmGC. Measured in this run before the change (same machine): snapshot wasmgc 95.6, native 43.3; particles wasmgc 190, native 20.4.
  - Natively the accessors then stayed real calls: past LLVM's cost threshold, and with more call sites than the loop-callee rule took (two). A one-statement leaf called only from loops now inlines at up to 32 call sites, so no accessor call is left in the snapshot binary: 22.2 to 13.3 ms. Particles, whose accessors were already inlined, is unchanged (21.1 ms). A dual int32 entry for the accessors was measured first and dropped (25.0 against 22.5 ms): the integer test for double offsets already covered it.
  - Both apps are still slower compiled than their object baselines: snapshot 25.1 against 15.2 ms on WasmGC and 17.2 against 9.5 ms natively, particles 163 against 139 and 26.5 against 14.7 ms. Each access still reads the view's base and length through the class field and tests its bounds; lowering the generated accessors to direct memory operations, or hoisting those reads out of the caller's loop, is the next layout item.
- **f16 (f16-mesh).**
  - The engine's `Float16Array` (the `js` lane) is the fastest conversion: V8 converts in C++. The library's JavaScript entry uses it (`js+fallback (engine)`, 2.1×).
  - The software path in plain JavaScript is 10.7×, and WasmGC's conversion in wasm is 6.4× (8.8× before the WasmGC integer work below). It works on the double's bits with `i64.reinterpret`; a first version through a Float64Array scratch word took 1072 ms.
  - Natively, the runtime's C conversion is 3.4×; F16C and NEON instructions are a later item.
  - The baseline has no compiled lanes: neither backend lowers `Float16Array` or `Math.f16round` (SC2020). This gap is why the library exists.
- **atomics (blur).** The Threads table has the thread lanes, each the median of three runs on this 4-core machine, against single-threaded JavaScript run the same way (147 ms for `baseline.ts`, 148 for `main.ts`).
  - JavaScript with four worker threads over `SharedArrayBuffer`s ran at 0.51× (74 ms).
  - The task ring's owner-thread drain (threads=off) gives the same image at 1.07×.
  - WasmGC threads=shared: one instance of `shared.ts` per worker, every instance importing one shared `WebAssembly.Memory` that holds the image, the scratch rows and the counter cell, which the host passes to the link exports as byte spans. Under Node it runs 155, 70 and 38 ms for 1, 2 and 4 workers (4.1× at four), and in headless Chromium 158, cross-origin isolated with one module Worker per thread, 142, 83 and 45 ms. Four WasmGC workers run at 0.26× of single-threaded JavaScript, ahead of four JavaScript workers (0.51×).
  - Single-threaded, the WasmGC kernel is now level with V8's JavaScript (threads=off 156 ms, 1.06×; it was 4.8× before the WasmGC integer work below).
  - Native threads: `shared.ts` built as a thread-instanced library (`abi.instance_per_thread`), with a small pthreads host (`native-host.c`) that keeps the buffers in its own memory and passes them as `mutable-bytes`. One thread runs at the native executable's speed (75 against 69 ms), and 2 and 4 threads at 46 and 25 ms (0.32× and 0.17× of JavaScript).
  - Three compiler gaps stood in the way and are fixed, each with its test. A link build on a shared memory recorded `threads=off`; it now records `threads=shared`, and so does `--explain-capabilities`. Instances on one shared memory each kept their own allocator heap top, so they could hand out the same blocks. And a library build left its module constants as globals inside every loop, which made the native kernel 3× slower as a library (212 ms) than as an executable (72 ms).
  - The native lane is a library, not `workers.ts` compiled: the native frontend does not lower `worker_threads` yet (SC2020 on `new Worker`).
- **WasmGC integer typed-array access.** The blur's WasmGC lane went from 658 ms to 156 ms (4.8× to 1.06× of JavaScript) through five compiler changes, each with its test:
  - The WasmGC copy of the integer-range analysis read a `for` loop's update from the loop header's facts, where the counter's range runs to 2^53, so `for (let k = -R; k <= R; k++)` kept an f64 counter. The update now sees what the condition proved, as the shared analysis does.
  - Atomics results are the element's exact int32 (uint32 for `Uint32Array`), and a method reaching storage through Atomics, or calling such a method, takes the i32 call ABI like a storage accessor: the work counter's `claim` reaches `blurBand` as an int32.
  - An index its range proves in [0, 2^31) is that i32, with no double round trip or integrality test, and `Math.min`/`Math.max` over int32 operands compare and select in i32 (in i64 for a clamp over wider exact integers, such as an i64-shadowed row counter). In the horizontal pass alone this was 185 to 60 ms.
  - Typed-array bounds versioning now also versions a region whose indexes have ranges only when a never-assigned number parameter is an integer (`y0 = band * BAND`), with `band === (band | 0)` in its guard, so the kernel's reads run without bounds checks.
  - Wasm has no on-stack replacement, and single-caller inlining had folded `runJobs` and `blurBand` into the program's top level, which runs once: the kernel ran in V8's baseline tier (Liftoff) for the whole program, 290 ms against 108 ms with Liftoff off. A function holding a loop that the top level calls now stays out of line, and its later calls run optimized code: 290 to 136 ms.
  - Elsewhere, the WasmGC baselines that run their work from the top level gained most: bitset's sieve 205 to 129 ms, blur's baseline 683 to 247 ms, f16-mesh 344 to 219 ms. The other apps' differences are within this machine's noise (an interleaved before-and-after of particles, snapshot and bitset showed no regression).
- **Sizes.** The libraries add little to a module: the hash app is 6.5 KiB of WasmGC with the int library against 7.8 KiB for its baseline, because lowered calls emit no bodies. Native binaries are dominated by the runtime (about 440 KiB).

## What was not measured

- Thread lanes for the other apps. None of them splits without changing its output: xxHash32 and LZ4 over independent chunks or blocks give different hashes and streams than over the whole input, so their checksums could not match the single-threaded lanes.
- Browsers: apart from the blur's Chromium row, every WasmGC lane ran under Node 24's V8.
- Other machines: these are runs on one 4-core x64 Linux container, single runs except in the Threads table. Timing noise is often ±10% and sometimes much more: the blur's single `js` run took 216 ms here and its three runs 130 to 147, and particles' WasmGC lane alternates between about 120 and 200 ms across runs of one build.
