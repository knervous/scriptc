# Intrinsic libraries

The intrinsic layer gives TypeScript programs language-level features that hold on both compiled targets, WasmGC and native (LLVM), and that still run as plain JavaScript. Each feature is a library: a TypeScript module whose bodies are exact JavaScript, and which the compiler lowers to instructions when it compiles a program that imports it.

| Library | npm subpath | Repository source | Compiled (WasmGC) | Compiled (native) | Uncompiled |
|---|---|---|---|---|---|
| int | `scriptw/int` | `packages/intrinsics/int.ts` | i32/i64 instructions | LLVM integer intrinsics | the module's JavaScript |
| math | `scriptw/math` | `packages/intrinsics/math.ts` (generated) | the in-module fdlibm routines | the module's bodies, word access as bit casts | the module's JavaScript |
| layout | `scriptw/layout` | `packages/intrinsics/layout.ts` | DataView loads and stores on module memory | loads and stores | the module's JavaScript |
| f16 | `scriptw/f16` | `packages/intrinsics/f16.ts` | bit-level conversion in wasm at load and store | the runtime's binary16 conversion | the engine's conversion where it has one, else software |
| atomics | `scriptw/atomics` | `packages/intrinsics/atomics.ts` | atomic instructions | the runtime's atomics | `Atomics` |
| simd | `scriptw/simd` | `packages/simd/simd.intrinsics.ts` | SIMD128 instructions | the module's bodies | the module's scalar JavaScript |

Results are identical across the three columns. The differential corpus programs `tests/corpus/4729` to `4732` check this on every lane: each runs under Node, as a WasmGC module and as a native binary, and must print the same bytes.

## How a library is recognised

A library module's leading comment holds the pragma `@scriptc-intrinsics <library>/<version>`, for example `/* @scriptc-intrinsics int/1 */`. The frontend reads it from the module's text (`packages/compiler/src/ir/intrinsic-libraries.ts`) and records the module in `IrModule.intrinsics` with the prefix its members' IR names carry. Recognition never depends on a file name or a path, so a library works from the repository, from `node_modules`, or copied into a project.

A backend lowers the calls it knows. Any member it does not lower compiles from the module's own body, so a missing lowering costs speed, never correctness. A module that names a library or version the compiler does not know compiles as ordinary code.

The npm package ships each library three ways under one subpath:

```json
"./int": {
  "wasmgc": "./intrinsics/int.ts",
  "types": "./intrinsics/int.d.ts",
  "default": "./intrinsics/int.mjs"
}
```

`scriptw build` (both targets) adds the `wasmgc` condition, so the compiler reads the TypeScript source. Node and bundlers take `default`, plain JavaScript generated from the same source. Editors take `types`. The `wasmgc` key comes first because resolvers match conditions in object order.

## Capabilities

Each module's capability record (the `scriptc.capabilities` section and `<out>.wasm.capabilities.json`) lists the libraries it imports:

```json
"intrinsics": ["atomics", "f16", "int", "layout", "math", "simd"]
```

`--explain-capabilities` prints one line per library: how the build provides it and what the fallback is. The libraries add no engine requirement beyond the ones the record already names: every engine with WasmGC has the instructions they use. `atomics` across threads needs `threads=shared`, which records `shared-memory` and `cross-origin-isolation` as before. One mode is new, `math`; see below. [capabilities.md](capabilities.md) §5.9 lists the changes to the capability modes.

## int: fixed-width integers and bit operations

The 32-bit functions take numbers and read them as the bitwise operators do (ToInt32, or ToUint32 for the `U` forms). Results that are bit patterns are signed int32s, like `x | 0`. The 64-bit functions (suffix `64`) take bigints and read their low 64 bits. Their wrapping and bit-pattern results are unsigned (`Uint64`), and the signed forms (`mulhi64`, `addSat64`, `subSat64`, `mulSat64`) return `Int64`.

| Operation | 32-bit | 64-bit | WasmGC | Native |
|---|---|---|---|---|
| leading/trailing zeros, set bits | `clz`, `ctz`, `popcnt` | `clz64`, `ctz64`, `popcnt64` | `i32.clz` ..., `i64.clz` ... | `llvm.ctlz`, `llvm.cttz`, `llvm.ctpop` |
| rotate | `rotl`, `rotr` | `rotl64`, `rotr64` | `i32.rotl`, `i64.rotr` | `llvm.fshl`, `llvm.fshr` |
| byte swap | `bswap` | `bswap64` | shifts and masks | `llvm.bswap` |
| high half of the product | `mulhi`, `mulhiU` | `mulhi64`, `mulhiU64` | i64 multiply, or 32-bit halves | 64- or 128-bit multiply |
| wrapping | `addWrap`, `subWrap`, `mulWrap` | `addWrap64`, `subWrap64`, `mulWrap64` | `i32.add` ... | `add`, `sub`, `mul` |
| saturating | `addSat`, `subSat`, `mulSat`, `addSatU`, `subSatU`, `mulSatU` | the same with `64` | through i64 with a clamp (32-bit); overflow tests (64-bit) | `llvm.sadd.sat`, `llvm.smul.fix.sat` (scale 0) ... |
| narrowing | `toInt8`, `toUint8`, `toInt16`, `toUint16`, `toInt32`, `toUint32` | `toInt64`, `toUint64`, `lo32`, `hi32`, `join64` | `i32.extend8_s`, masks | `trunc`/`sext`, masks |

On WasmGC, a 64-bit call nested in another 64-bit call stays in an i64, and a bigint literal becomes a constant. Any other bigint argument crosses with one host call (`bigint.toI64`), and a bigint result with one more (`bigint.fromI64`). Native code reads a bigint with `scr_bigint_to_i64` and builds the result with `scr_bigint_from_u64` or `scr_bigint_from_i64`.

### Contract types

`scriptw/int` and `@scriptc/types` declare `Int32`, `Uint32`, `Int8`, `Uint8`, `Int16`, `Uint16`, `Int64` and `Uint64`. Each is an alias that TypeScript erases (`number`, or `bigint` for the 64-bit types). The compiler checks them with the rest of the contract types (`NoThrow`, `Immutable`, `Acyclic`, `ProgramLifetime`, `Int32[]`), in the contract checker ported from upstream scriptc (`packages/compiler/src/contracts/check.ts`, `docs/content/docs/contracts.mdx`). It runs on the lowered program before any backend, so WasmGC and native builds check the same contracts. Every value written to an annotated local, parameter, result or class instance field must be a value of the type.

- **Number types.** Upstream's Int32 check, extended to each kind's range. The proof assumes every contract slot holds its type and shows that each write stays in range. It uses the integer range analysis with the contract slots as facts. A write is accepted when it is:
  - an in-range literal;
  - a bitwise result (`x | 0`, `x & 0xff`, `x >>> 0`, `>> k`), `Math.imul` or `Math.clz32`;
  - a length (taken as `[0, 2^31 - 1]`: every compiled representation stores lengths in 32 signed bits; upstream's analysis bounds an array length as a uint32 and refuses it for `Int32`);
  - another slot of a type in range, or an `int` result (`clz`, `ctz` and `popcnt` in `[0, 32]`, their 64-bit forms in `[0, 64]`);
  - arithmetic the analysis bounds, such as `i + 1` under `i < xs.length`.
- **Bigint types.** A write is accepted when it is an in-range literal, `BigInt.asIntN(64, x)` or `BigInt.asUintN(64, x)`, a 64-bit `int` result, another slot of the same type, or `&`, `|`, `^` and `>>` of such values.
- **Slots it cannot check** (SC7003): a parameter of a function used as a value, a field of a generic class or of a class whose instances reach `any` values, a binding that is not a plain `number` or `bigint`.
- **Positions.** A contract written anywhere but a parameter, variable, field or result annotation (a type alias, an interface member, `Int32 | undefined`, `Uint8[]`) is reported with SC7006. Only `Int32` is checked as an array element type.
- **Generated helpers.** The fork lowers some array methods (`fill`, `map`, ...) and inspection into generated helper functions. A helper's number parameters take the join of its call sites' argument ranges, so `xs.fill(0)` on an `Int32[]` is proven, and a diagnostic inside a helper is reported at the call.
- **Refusal.** Anything else fails the build with SC7002, with upstream's message and a hint that shows the conversion:

```text
error SC7002: the value stored into 'x' (Int32) is not provably an int32: 'x / 3'
  hint: make the int32 conversion explicit, for example 'x = (x / 3) | 0', so Node computes the same value
error SC7002: the value stored into 'Pixel.b' (Uint8) is not provably an integer in [0, 255]: 'rgb % 256'
  hint: make the Uint8 conversion explicit, for example '(rgb % 256) & 0xff', so Node computes the same value
```

Proven slots inside the int32 range become `IrModule.contracts` facts (`int32Locals`, `int32Params`, `int32Returns`, `int32Fields`), which the native backend's int32 slot analysis consumes. On WasmGC, contract class fields are stored as `i32`: `Int8` and `Uint8` fields as packed `i8` struct fields, `Int16` and `Uint16` fields as packed `i16` (read with `struct.get_s` or `struct.get_u`); the narrow kinds reach the backend as `narrowFields`. Contracts written in an intrinsic library module (any `@scriptc-intrinsics` pragma) are its own stated facts, established by its tests, and are not re-proven.

The first intrinsic layer added an interim checker for the integer types only (`ir/contract-check.ts`, now removed). Before it, this tree checked no contract types at all: a program with `let x: Int32 = 1; x = x / 3` compiled on both backends and printed `0.3333333333333333`.

## math: deterministic math

`scriptw/math` exports `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `pow`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh` and `cbrt`. It also exports the correctly rounded IEEE operations (`sqrt`, `abs`, `floor`, `ceil`, `trunc`, `fround`), `mulAdd` (two roundings, never fused) and `canonicalNaN`.

The module is generated (`node scripts/gen-intrinsics-math.mjs`; `--check` reports a stale copy) from the WasmGC backend's in-module math library, V8's fdlibm in `packages/compiler/src/backend/wasmgc/fdlibm-source.ts`. The generator keeps every operation of that source exact in JavaScript:
- i32 values stay int32 numbers (`| 0`, `Math.imul`, unsigned compares through `>>> 0`);
- the words of a double are read and written through a shared `Float64Array`;
- C's double-to-int cast is wasm's saturating truncation.

So the same doubles come out on every target:

- **JavaScript:** the generated bodies. On Node 24 (x64) they equal V8's `Math` bit for bit for every fdlibm function (the package test checks this). V8 ships the same port.
- **WasmGC:** calls go to the in-module routines built from the same source.
- **Native:** the generated bodies compile with the word accesses as `bitcast`. LLVM fuses a multiply and an add only when an instruction carries the `contract` flag or calls `llvm.fmuladd`, and this path emits neither, so no part of it depends on `-ffp-contract`. The C port in the runtime (`scr_ieee754.c`) serves `Math.*` and is not used here.
- **`pow`:** this is the library's own: fdlibm's front end with a double-double exponential, correctly rounded in all but about 2 results in 10000. It is the same on every target. It is not V8's `Math.pow`, which calls the platform's libm.
- **NaN results:** always the canonical quiet NaN (`0x7ff8000000000000`), so a NaN stored as bits is the same everywhere.

### Why a library, and the `math` mode

Determinism has to reach the uncompiled JavaScript lane, and only code that calls the port can be bit-identical there: no build mode changes what `Math.sin` returns in a browser. So the library is the unit of determinism, and the mode records it:

- `--capabilities math=fast|strict`. `fast` is the default.
- A program that imports `scriptw/math` is built `strict` whatever was asked.
- `strict` turns the SIMD library's relaxed lowerings off, and refuses an explicit `relaxed-simd` (relaxed multiply-adds differ in the low bits by engine and CPU).
- The canonical key carries `;math=strict` only when strict, so every key built before the mode existed is unchanged.

`Math.*` itself is unchanged in both modes: on WasmGC it already uses the same in-module routines, and natively the C port of the same source.

### NaN bits

A NaN's bits can differ with nothing but the optimiser. Constant folding turns `0 / 0` into JavaScript's canonical NaN, `0x7ff8000000000000`. The same division at run time on x86 gives `0xfff8000000000000`; arm64 gives `0x7ff8000000000000`. V8 itself shows the same difference under plain Node. The bits become observable only when a program stores the NaN into memory and reads the memory back, through `DataView` or a typed array of another kind.

- **math=strict (WasmGC):** every NaN stored into a `Float32Array` or `Float64Array`, or through `DataView.setFloat32`/`setFloat64`, is stored as the canonical quiet NaN (`0x7ff8000000000000`, or `0x7fc00000` for f32). Folded and run-time NaNs then read back the same (`packages/compiler/test/strict-nan.test.ts`, fixture `test/fixtures/strict-nan/nan-bits.ts`).
- **The strict-math library** returns canonical NaNs from its functions in every lane, plain JavaScript included. `canonicalNaN(x)` does the same for any value a program is about to store, which is the way to make plain JavaScript agree.
- **math=fast (the default), and native builds:** a stored NaN keeps the bits the engine or CPU produced, as in Node. Native builds have no capability mode, and their typed-array and `DataView` stores are not canonicalised. A native program that needs canonical bits calls `canonicalNaN` before storing.

## layout: fixed-layout records

`layout(name, fields, options)` computes field offsets by C's rules (each field at a multiple of its size, `packed: true` for none), the record size, alignment and stride (`align: 16` rounds it up, as a WGSL uniform array needs). Field types: `u8`, `i8`, `u16`, `i16`, `u32`, `i32`, `f16`, `f32`, `f64`, `u64`, `i64`, each optionally a fixed array (`count`). All access is little-endian.

- `RecordView` reads and writes records in place over a `Uint8Array`: `f32(i, offset)`, `setU16(i, offset, v)` and so on. The view shares the bytes, so it is zero-copy over a GPU staging buffer, a network packet or a file read into memory.
- `layoutSource(layout)` generates a view class with one getter and setter per field at constant offsets (`getPos(i, k)`, `setId(i, v)`), the form compiled code reads best.
- `cStruct(layout)` and `wgslStruct(layout)` print the same layout for C (with explicit padding and a `_Static_assert` on the size) and WGSL. One schema then describes every side, the idea host-stream uses for its command buffers (`packages/host-stream`).

The accessors are `DataView` calls with constant offsets. WasmGC lowers each to a bounds-checked load or store on module memory, and native code to a load at the field's offset. The library needs no lowering of its own.

Two WasmGC limits shaped the API. WasmGC cannot construct a `DataView` over an `ArrayBuffer` that arrives as a parameter, and it has no `new ArrayBuffer(n)`. So views take a `Uint8Array`: `new RecordView(new Uint8Array(n * stride), stride)` or `RecordView.ofBytes(bytes, stride)`.

## f16: binary16 storage

`toF16Bits(x)` rounds a double straight to the nearest binary16 pattern, ties to even, with no rounding through float32. A NaN gives `0x7e00`. `fromF16Bits(h)` reads one back. Around them are `f16round`, `getFloat16`/`setFloat16` (DataView), and `packF16`/`unpackF16` for bulk conversion between `Float32Array`/`Float64Array` and `Uint16Array`.

- **WasmGC:** WebAssembly has no shipped f16 arithmetic (the FP16 proposal is not in the feature set), so values convert at load and store and are computed as f64. `toF16Bits` and `fromF16Bits` lower to wasm functions working on the double's bits (`i64.reinterpret`), the algorithm of the runtime's C conversion. The rest of the library compiles from its bodies around them.
- **Native:** the conversions lower to the runtime's exact binary16 conversion (`scr_f16_from_f64`, `scr_f16_to_f64`), with NaN canonical. It does not use F16C or NEON instructions.
- **JavaScript:** the package's entry (`f16.engine.mjs`) uses `Math.f16round` and the `DataView` float16 methods where the engine has them (Chrome 135, Firefox 129, Safari 18.2, Node 24), and the software conversion elsewhere. `F16_PATH` says which path it took. The package test checks that both give the same bits for all 65536 patterns and for every tie between neighbours.

The split exists because the compiler cannot compile `Math` used as a value, so the engine check cannot sit in the compiled source. It lives in a JavaScript file the compiler never reads.

## atomics: typed atomic cells

- **`AtomicInt32` and `AtomicUint32`:** a cell is one element of an `Int32Array` or `Uint32Array`. They provide `load`, `store`, `add`, `sub`, `and`, `or`, `xor`, `exchange` and `compareExchange`. `AtomicInt32` also has `wait` and `notify`.
- **`WorkCounter`:** hands out job indexes, each exactly once, across any number of threads.
- **`SpinLock`:** guards short critical sections.

Every operation is the matching `Atomics` call. WasmGC compiles them to the threads proposal's atomic instructions on module memory, and native code to the runtime's atomics.

- **threads=shared:** the cells live in a `SharedArrayBuffer` and coordinate workers.
- **threads=off:** the same code runs on one thread with the same results. `wait` returns `"not-equal"` or `"timed-out"` instead of blocking, and `notify` wakes nobody and returns 0. The job system in `benchmarks/intrinsics/atomics-blur` runs its jobs through `createTaskRing`'s owner-thread drain in this mode, and its output matches the threaded run.

`Atomics.wait` is refused on the browser target, because a page's thread must not block. A page waits from JavaScript with `Atomics.waitAsync`.

Adding this library exposed a native link failure: any program that reached `Atomics.notify` or `Atomics.wait` failed to link on ELF, because `scr_remote_post` was undefined. The wait unit now pulls in the remote queue, as the host island already did (`native-link-info-core.ts`).

## Later items

These are designed but not built:

- **Guaranteed tail calls.** A `tailcall(f, ...args)` intrinsic, or a pragma on a function, whose `return f(x)` must not grow the stack.
  - WasmGC: `return_call` and `return_call_ref`. The feature is already in the module's feature set, and no module uses it today.
  - Native: LLVM's `musttail`, which needs caller and callee signatures to match. The int32 call ABI can make two functions with the same TypeScript signature differ, so the lowering would pin both to one ABI.
  - Uncompiled JavaScript: a trampoline, with the call returning a thunk the caller loops on.
  - Refusal: a site the backend cannot make a tail call (a mismatched signature, a call inside `try`) is refused at compile time, not silently grown.
- **memory64.** Buffers over 4 GiB. WasmGC module memory is 32-bit with a declared maximum of 4 GiB.
  - The first step is a clear refusal at that limit: an allocation that would cross it throws a `RangeError` naming the limit, rather than an engine out-of-memory trap.
  - memory64 itself (`i64` addresses, about a 10 to 15% slowdown on bounds checks in current engines) would be a capability mode (`memory=64`) with that refusal as its fallback. Engine support is still partial (Chrome 133, Firefox 134, not Safari).
- **Packed arrays.** `Int8[]` and `Uint16[]` contract element types are not built. Packed array storage on WasmGC (`array i8`) needs the array representation to vary by element contract. Typed arrays (`Int8Array`, `Uint16Array`) are already packed on both targets.
- **f16 hardware conversion natively.** F16C (x86-64-v3) and NEON `fcvt` through LLVM's `fptrunc double to half`, once the runtime pack's CPU levels select it. The conversion would be the same, and faster.

## Verification

- **Corpus:**
  - `4729-intrinsics-int.ts`: every int operation over edge values;
  - `4730-intrinsics-int-fields.ts`: packed contract fields;
  - `4731-intrinsics-strict-math.ts`: about 40,000 results hashed by their bits;
  - `4732-intrinsics-f16-layout-atomics.ts`.

  Each matches Node on WasmGC, native and native with AddressSanitizer. The native runs used LLVM 22.1.8 and Zig 0.16.0 on linux-x64.
- **Contract checker:**
  - `4733-contract-types-both-backends.ts` (Immutable over a class, `fill` on an `Int32[]`, a module-level `Int32` counter, the fixed-width types), with 4630, 4631, 4632, 4638, 4640, 4641 and 4642, matches Node natively and with AddressSanitizer. 4633 and 4634 stop before the checker (an inspection the fork does not lower, and `@scriptc/threads`, which the fork does not have).
  - On WasmGC, 4630, 4631, 4632, 4640, 4641, 4642 and 4733 match Node. 4633 and 4638 stop on WasmGC coverage the fork does not have yet, before the checker runs.
  - Upstream's 4636, 4637 and 4639 are not ported: they stop on the fork's frontend (an inspection, `worker_threads`), and 4639 traps natively with the checker off too.
- **Unit and package tests:**
  - `packages/compiler/test/contract-check.test.ts`: 15 accept and refuse cases for the integer types;
  - `packages/compiler/test/int32-array-contracts.test.ts` and the 21 `tests/diagnostics/contract-*` programs, ported from upstream with their snapshots;
  - `packages/compiler/src/backend/wasmgc/capabilities.test.ts`: the math mode, the key and the record;
  - `packages/intrinsics/test/fallbacks.test.ts`: f16 engine against software, math against V8, the generated layout class, the pragma.
- **The installed package:** `npm/wasmgc/test/samples/intrinsics.ts` imports every subpath. It runs under Node and through `scriptw run`, and native builds match.
- **Not run here:** macOS, Windows and arm64 native targets, and browsers other than Chromium.
