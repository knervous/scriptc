# Results

One receipt per benchmark, written by `run.mjs` (receipts/*.json). Machine: linux-x64, 4 × Intel(R) Xeon(R) Processor @ 2.10GHz, Node v24.22.3. Date: 2026-11-28.

Times are milliseconds measured inside each program around the work only (no startup, no compilation). Ratios are the lane's time over the `js` lane's (lower is faster). Every lane's result lines (checksums, sizes, hashes) were compared with the `js` lane's; ✓ means byte-identical. Single runs: differences under about 10% are noise.

| App | js | js+fallback | wasmgc-base | wasmgc | native-base | native | extra lanes |
|---|---|---|---|---|---|---|---|
| hash | 146 (1.00×) ✓ | 154 (1.06×) ✓ | 472 (3.24×) ✓ | 230 (1.58×) ✓ | 167 (1.15×) ✓ | 143 (0.98×) ✓ |  |
| qoi | 32.8 (1.00×) ✓ | 37.6 (1.15×) ✓ | 109 (3.33×) ✓ | 117 (3.55×) ✓ | 34.2 (1.04×) ✓ | 23.2 (0.71×) ✓ |  |
| lz4 | 322 (1.00×) ✓ | 289 (0.90×) ✓ | 354 (1.10×) ✓ | 319 (0.99×) ✓ | 223 (0.69×) ✓ | 222 (0.69×) ✓ |  |
| bitset | 137 (1.00×) ✓ | 112 (0.81×) ✓ | 572 (4.18×) ✓ | 390 (2.85×) ✓ | 119 (0.87×) ✓ | 120 (0.88×) ✓ |  |
| physics | 128 (1.00×) ✓ | 170 (1.33×) ✓ | 206 (1.61×) ✓ | 212 (1.66×) ✓ | 49.8 (0.39×) ✓ | 74.8 (0.58×) ✓ |  |
| snapshot | 18.0 (1.00×) ✓ | 21.5 (1.19×) ✓ | 21.4 (1.19×) ✓ | 29.9 (1.66×) ✓ | 5.2 (0.29×) ✓ | 13.3 (0.74×) ✓ |  |
| particles | 49.3 (1.00×) ✓ | 35.8 (0.73×) ✓ | 82.6 (1.68×) ✓ | 98.7 (2.00×) ✓ | 12.4 (0.25×) ✓ | 21.1 (0.43×) ✓ |  |
| f16-mesh | 39.2 (1.00×) ✓ | 407 (10.39×) ✓ | n/a | 344 (8.78×) ✓ | n/a | 106 (2.70×) ✓ | js+fallback (engine): 66.3 (1.69×) ✓ |
| blur | 258 (1.00×) ✓ | 147 (0.57×) ✓ | 776 (3.01×) ✓ | 809 (3.14×) ✓ | 76.7 (0.30×) ✓ | 90.5 (0.35×) ✓ | js threads=shared: 79.0 (0.31×) ✓<br>js threads=off (task ring): 167 (0.65×) ✓ |

## Per kernel

**hash**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| xxh32 | 34.9 | 38.6 | 318 | 89.4 | 63.2 | 45.6 |
| crc32 | 97.8 | 96.8 | 130 | 132 | 96.2 | 96.1 |
| xxh64 | 12.9 | 18.3 | 23.7 | 8.4 | 7.5 | 1.7 |

**qoi**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| encode | 16.5 | 18.0 | 51.3 | 55.5 | 20.2 | 8.6 |
| decode | 16.3 | 19.5 | 58.0 | 61.1 | 14.0 | 14.6 |

**lz4**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| compress | 82.8 | 65.3 | 127 | 74.9 | 71.6 | 51.1 |
| decompress | 239 | 224 | 227 | 244 | 151 | 171 |

**bitset**

| Kernel | js | js+fallback | wasmgc-base | wasmgc | native-base | native |
|---|---|---|---|---|---|---|
| sieve | 29.9 | 29.2 | 205 | 202 | 44.2 | 46.1 |
| scan | 107 | 82.3 | 368 | 188 | 74.6 | 73.9 |

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
| hash | 7.8 KiB | 6.5 KiB | 447.1 KiB | 428.2 KiB |
| qoi | 13.4 KiB | 12.9 KiB | 407.2 KiB | 402.5 KiB |
| lz4 | 8.6 KiB | 8.4 KiB | 425.5 KiB | 425.0 KiB |
| bitset | 2.9 KiB | 2.6 KiB | 391.2 KiB | 381.2 KiB |
| physics | 17.3 KiB | 20.0 KiB | 377.1 KiB | 470.1 KiB |
| snapshot | 6.8 KiB | 8.2 KiB | 435.2 KiB | 433.7 KiB |
| particles | 3.8 KiB | 4.2 KiB | 356.3 KiB | 406.5 KiB |
| f16-mesh | n/a | 8.6 KiB | n/a | 435.8 KiB |
| blur | 2.6 KiB | 3.3 KiB | 390.8 KiB | 402.2 KiB |

## Lanes that did not run

- f16-mesh wasmgc-base: SC2020 'Float16Array<ArrayBuffer>' is part of the standard library types but has no scriptc lowering yet; SC2020 'new Float16Array' is part of the standard library types but has no scriptc lowering yet; SC1090 assignment to non-array elements are not supported yet; SC2004 uses of 'half' inherit the blocker on its declaration
- f16-mesh native-base: SC2020 'Float16Array<ArrayBuffer>' is part of the standard library types but has no scriptc lowering yet; SC2020 'new Float16Array' is part of the standard library types but has no scriptc lowering yet; SC1090 assignment to non-array elements are not supported yet; SC2004 uses of 'half' inherit the blocker on its declaration

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
  - Natively the accessors then stayed real calls: past LLVM's cost threshold, and with more call sites than the loop-callee rule took (two). A one-statement leaf called only from loops now inlines at up to 32 call sites, so no accessor call is left in the snapshot binary: 22.2 to 13.3 ms. Particles, whose accessors were already inlined, is unchanged (21.1 ms). A dual int32 entry for the accessors was measured first and dropped (25.0 against 22.5 ms): the integer test for double offsets already covered it.
  - Both apps are still slower compiled than their object baselines: snapshot 29.9 against 21.4 ms on WasmGC and 13.3 against 5.2 ms natively, particles 98.7 against 82.6 and 21.1 against 12.4 ms. Each access still reads the view's base and length through the class field and tests its bounds; lowering the generated accessors to direct memory operations, or hoisting those reads out of the caller's loop, is the next layout item.
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
