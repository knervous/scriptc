# Platform capabilities of the WasmGC toolchain

This document inventories every platform capability that the WasmGC output of the toolchain relies on: the module itself, the JavaScript host that loads it, and the threading and flushing machinery around both. It gives a support matrix with sources, the results of probes that check the important claims, and a design for exposing capability modes in the npm package.

Status: §1–§3 are the audit, as measured before the modes existed. §4 is the design, and [§5](#5-implementation) records what is implemented and how it was checked. The probes live in [`tests/capabilities/`](../tests/capabilities/README.md).

Conventions:

- **Always** means every module needs it. **Conditional** means a module needs it only when the program uses a particular language or library feature. **Opt-in** means only a compile option or a manifest declaration turns it on.
- A version is the first stable release that ships the feature without a flag.
- "Probed" means it was checked on this branch, on 2026-11-28, against headless Chromium 158.0.8127.36 (V8 15.8), Node 24.22.1 (V8 13.6.233.17) and Node 22.23.5 (V8 12.4.254.21).

## 1. Inventory

### 1.1 The WasmGC module

The emitter (`packages/compiler/src/backend/wasmgc/emitter.ts`) builds every module under one fixed feature set, `FEATURES`, and optimizes it with the vendored wasm-opt 133 under the matching flags, `WASM_OPT_FEATURES` (exported as `WASMGC_FEATURE_FLAGS`):

```text
--mvp-features --enable-gc --enable-reference-types --enable-exception-handling --enable-bulk-memory
--enable-sign-ext --enable-nontrapping-float-to-int --enable-multivalue --enable-tail-call --enable-mutable-globals
--enable-simd --enable-bulk-memory-opt --enable-threads --enable-relaxed-simd --enable-extended-const
```

Enabling a feature here does not mean a module uses it. The policy comment above `FEATURES` explains that a feature enters the set once it ships unflagged in browsers. It also notes that enabling a feature changes no instruction for code that doesn't use it. To find what modules actually use, `tests/capabilities/features.mjs` re-validates a module with the build's own wasm-opt, once with each feature removed. A feature whose removal fails validation is in use.

**Scan results.** The sample was 105 browser-target fixtures, every sixth file of `tests/wasmgc-browser/fixtures` plus a few chosen for atomics, SIMD, generators and async. They were built with the default options (`browser: true`, dev optimization):

| Feature | Modules that need it |
|---|---|
| GC, reference types | 105 / 105 |
| exception handling | 105 / 105 |
| non-trapping float-to-int | 76 / 105 |
| SIMD128 | 2 / 105 (typed-array copy helpers) |
| sign-ext | 1 / 105 |
| threads (atomic instructions) | 1 / 105 (`Atomics.*`) |
| tail calls, multi-value, extended-const, relaxed SIMD, bulk memory | 0 / 105 |

Each module also imports `wasm:js-string` builtins (94 of 105) and string constants from module `'` (104 of 105).

Each capability in turn:

**GC types and typed function references.**
- *Where:* everywhere. Compiled objects are structs, arrays are GC arrays, closures are typed function references (`call_ref` through `types.ts`). i31 references appear in the dyn model, and `experimentalDynI31` makes them the representation of small integers.
- *Mode:* always.
- *Without it:* the module fails to compile.
- *Fallback:* none, and none is plausible. The whole object model is GC. This is the non-negotiable baseline.

**Exception handling.**
- *Where:* every module declares tag `$exn` (anyref) and imports `host.jsTag`. The host serves `WebAssembly.JSTag` when present, else a fresh `Tag({ parameters: ["externref"] })` (`host.ts`). Compiled `throw` and `catch` use them.
- *Encoding:* Binaryen's builder emits the legacy `try`/`catch` encoding (`m.try`). The emitter then always runs the `translate-to-exnref` pass, so shipped modules use the standard exnref encoding (`try_table`, `throw_ref`). The comment reads: "Binaryen's builder emits legacy try/catch; ship standard exnref EH." On a native wasm-opt finish the pass runs there instead (`--translate-to-exnref`, `finishWithWasmOpt`). `SCRIPTC_WASMGC_DEFER_FINISH=1` hands the pass back to the caller as `pendingFinish`.
- *Mode:* always. Every scanned module uses it, because `main` and the host boundary catch.
- *Without it:* the module fails at compile time. Probed on Node 24 with `--no-experimental-wasm-exnref`: `CompileError: Compiling function #21 failed: Invalid opcode 0x1f`. A module whose functions contain no `try` (the `strings` probe) still runs.
- *Fallback:* a legacy-EH variant is a build of the same module with the translation pass skipped, since that is what the builder produces. Legacy EH validates on every probed engine and is still on by default in V8 (`--wasm-legacy-eh`). It would only widen support to engines that have GC but not exnref: Chrome 119–136, Firefox 120–130 and Safari 18.2–18.3. Building it means removing one pass, not writing a new emitter.

**JS String Builtins and imported string constants.**
- *Where:* strings are `externref` JS strings. The emitter imports `wasm:js-string` `cast`, `test`, `length`, `charCodeAt`, `concat`, `substring`, `equals`, `compare` and `fromCodePoint`. It uses no array-based builtins (`fromCharCodeArray`, `intoCharCodeArray`). Every string literal is an immutable `externref` global imported from module `'`, with its text as the import name. `linkedCompileOptions` compiles with `{ builtins: ["js-string"], importedStringConstants: "'" }`.
- *Mode:* always (a module without a string literal is rare).
- *Without it:*
  - Without the constants (Node 22): instantiation fails with `TypeError: Import #0 module="'": module is not an object or function`.
  - Without the builtins, the next missing import fails the same way (`Import #18 "wasm:js-string"`).
  - `npm/wasmgc/lib/runtime-check.mjs` detects both gaps with a probe module, and the CLI refuses to start on them.
- *Fallback:* both fallbacks work, need no rebuild, and cost nothing measurable. `host.ts` already has the path: `instantiateLinked` treats an `imports["'"]` supplied by the caller as `suppliedStrings` and compiles without `importedStringConstants`. `node-stage.mjs` shows two modes (§3.3):
  - `constants`: engine builtins, with the string constants served by a Proxy that answers each import name with itself. Node 22 runs every probe module this way.
  - `polyfill`: no engine string support. Eleven one-line JS functions serve `wasm:js-string`, and the same Proxy serves `'`.

**JSPI** (`WebAssembly.Suspending`, `WebAssembly.promising`).
- *Where:* only in the wasm link mode. A format-6 FFI manifest function with `"suspending": true` becomes an import from module `jspi`. Exports listed in `wasmLink.promising` are exported as `$promising.<name>`. `instantiateLinked` wraps each `jspi` import in `Suspending`, and each promising export in `promising` behind a per-instance serial queue bounded by `promisingLimit`.
- *Compile-time rule:* a function that can reach a suspending import is refused if it is used as a function value, is async or a generator, runs during module initialization, or is a link export not declared promising.
- *Mode:* opt-in, by manifest declaration.
- *Without it:* `instantiateLinked` refuses at instantiation: "this module suspends on host promises, which requires JSPI (…); this host lacks it."
- *Fallback:* none that keeps synchronous source semantics. Binaryen's Asyncify is the classic substitute, but it doesn't handle GC references or exnref. The honest alternative is the source-level `async`/`await` lowering, which already exists and needs no JSPI. TS `async` functions never use JSPI.

**SIMD128.**
- *Where, conditional:*
  - the typed-array helpers in `bytes.ts` (bulk copy and element conversion use `v128` loads and stores);
  - the opt-in SIMD library (`packages/simd`, `simd.intrinsics.ts`), whose `v128` values lower to wasm SIMD.
- *Without it:* compile failure. But every engine with WasmGC has SIMD128, so absence never arises in practice.
- *Fallback:* the helpers could have scalar loops. Nothing needs that.

**Relaxed SIMD.**
- *Where:* only with `experimentalRelaxedSimd: true`, which lowers the SIMD library's `relaxed_madd` and `relaxed_nmadd` to relaxed instructions.
- *Mode:* opt-in.
- *Without it:* compile failure. Safari ships it only behind a JSC flag and rejects a module that contains any relaxed instruction.
- *Fallback:* the non-relaxed lowering, which is the default build. Choosing it needs a second artifact or a build-time decision.

**Atomics (the threads proposal's atomic instructions).**
- *Where, conditional:* `Atomics.load`, `store`, `add`, `sub`, `and`, `or`, `xor`, `exchange`, `compareExchange` and `notify` on compiled integer typed arrays lower to wasm atomic instructions on the module's memory (`bytes.ts` `atomics`).
- *Shared memory:* the memory is shared only when a link imports a shared memory (`wasmLink.memory.shared`). Otherwise atomic instructions run on unshared memory, which the threads proposal allows, and `notify` returns 0. A module on a shared link memory records `threads=shared`. Without a linked allocator, its typed-array allocator keeps its heap top and a spin lock in the memory (words 128 and 132), so every instance on that memory, one per worker, allocates from one heap.
- *`Atomics.wait`:* refused at compile time on the browser target, because the UI thread must not block.
- *Without it:* compile failure, but every GC engine validates atomic instructions on unshared memory. The probe runs the `atomics` module in Chromium without cross-origin isolation.
- *Fallback:* none needed. The instructions need no SharedArrayBuffer or isolation unless the memory is shared.

**Linear memory and resizable buffers.**
- *Where, conditional:* a module has a linear memory only if it uses typed arrays (`bytes.ts`, `setMemory(1, 65536, "memory")`: one page initially, a 4 GiB maximum, growing on demand).
- *Byte views:* when compiled code hands a typed array to JavaScript (host import `bytes.toJs`), the host returns a view over module memory. It takes it from `memory.toResizableBuffer()`, so the view stays valid across `memory.grow`.
- *Mode:* conditional. A byte view crosses whenever a typed array is passed to a page or host function.
- *Without it:* `instantiateLinked` refuses at instantiation: "this module hands byte views to the page, which requires `WebAssembly.Memory.prototype.toResizableBuffer` (Chrome 136+, Node 26); this host lacks it." The version in that message was wrong: Chrome shipped it in 144 (§2). The message now names the releases from §2's table.
- **Finding:** Node 24, the package's declared minimum (`"engines": { "node": ">=24" }`), lacks `toResizableBuffer` without `--experimental-wasm-rab-integration`. So any program that passes a typed array to JavaScript fails to instantiate on Node 24 (probed, §3.3).
- *Fallback:* the host already rebuilds a detached view when a view is requested again (`bytes.toJs`). Only a view that JavaScript retains across a grow goes stale, which is why the host refuses. A memory that never grows keeps every view valid with no other change. That means a build-time fixed memory with `initial = maximum`, at a cost measured in §4.7. A host that copies bytes instead of aliasing them would change semantics, because writes would no longer be shared.

**Other features in the set.**
- *Bulk memory and bulk-memory-opt:* only in typed-array helpers (fill and copy).
- *Sign-ext:* conditional (integer narrowing, as in `Atomics` and `Int8Array` stores).
- *Non-trapping float-to-int:* conditional, but very common (number to integer conversions; 76 of 105 modules).
- *Multi-value, tail calls, extended-const:* enabled, but no scanned module uses them, and the emitter has no direct `return_call` site.

All of these ship in every engine that has WasmGC, so none of them needs a mode. Absence would show up as a compile error.

**Not in the set**, and so never emitted: memory64, multi-memory, branch hints, FP16, wide arithmetic, custom page sizes, compact imports, custom descriptors, stack switching, and shared-everything threads. The policy comment explains: they are flagged or unshipped, and `-all` would enable proposals V8 rejects.

**wasm-opt's assumptions.**
- wasm-opt runs with exactly `WASMGC_FEATURE_FLAGS`, closed world (`binaryen.setClosedWorld(true)`), and never with `--all-features`. Merge tools (`wasm-merge` in the link) must use the same flags.
- Under these flags, wasm-opt may introduce any enabled feature into an optimized module. The scan shows it doesn't introduce the unused ones, but no contract promises that.
- So a mode that removes a feature must also remove its flag. The build should then re-validate the output under the reduced set, which is what `features.mjs` does.

**Custom sections a host reads:**
- `scriptc.host-abi`: the bridge contract version (`scriptc-wasmgc-host/7`). The host refuses a mismatch.
- `scriptc.host-modules`: typed host-module signatures.

There is no section recording which capabilities a module needs today.

### 1.2 The JavaScript host

Sources: `packages/compiler/src/backend/wasmgc/host.ts`, the package entry `npm/wasmgc/lib/host.mjs` (which re-exports only `instantiateWasmGc`), `npm/wasmgc/lib/runtime-check.mjs` and `npm/wasmgc/bin/cli.mjs`. The batched bridge packages `packages/host-stream` and `packages/dom-stream` live on the frameworks branch.

**SharedArrayBuffer, `crossOriginIsolated`, shared `WebAssembly.Memory`.**
- *What uses them:* only a link whose environment supplies a shared memory. Then `isShared()` recognizes the buffer, views never detach, and the `toResizableBuffer` requirement is waived.
- *Mode:* opt-in, by link configuration. A module built by the package's `compile()` or CLI never has a shared memory.
- *The existing check:* `deploymentCapabilities()` reports:
  - `crossOriginIsolated`, `sharedArrayBuffer`, `atomics` and `atomicsWaitAsync`;
  - `sharedWasmMemory`: whether a shared `WebAssembly.Memory` can be created;
  - `growableSharedViews`: checked by behaviour, through `toResizableBuffer()` on a shared memory and a length-tracking view that must see a grow;
  - `jspi`: presence only.

  `requireDeploymentCapabilities()` throws an actionable error naming COOP/COEP. Both exist in `host.ts` but not in the package's `scriptw/host` entry.

**Atomics.wait, waitAsync and notify.**
- In compiled code, `wait` is refused on the browser target; the rest lower to instructions (§1.1).
- In the host, `Atomics.waitAsync` is how a page awaits completions from a worker ring (§1.3). It appears only in link code supplied by the environment, never in `host.ts` proper.

**Workers.** The host never starts a worker. A threaded link's environment starts them: `wasiThreadsEnvironment(memory, log, spawn)` serves `wasi.thread-spawn` through a spawner the environment supplies, which starts a Web Worker that instantiates the same binary on the same shared memory.

**Resizable ArrayBuffer.**
- *Where:* `memory.toResizableBuffer()` for byte views (§1.1), and `deploymentCapabilities()`'s growable shared-view check.
- *Plain resizable ArrayBuffers:* nothing creates them (no `new ArrayBuffer(n, { maxByteLength })`). They are only reported when a page hands one in.

**Other host dependencies:**
- `FinalizationRegistry`: typed-array storage is freed through `bytesFree`.
- `WeakMap` and `WeakRef`, for the facade and view caches.
- `TextDecoder`.
- On the browser target: `queueMicrotask`, `MessageChannel` and `setTimeout` for the scheduler, and `requestIdleCallback` and `AbortController` when the program reaches them.

All of these are universal in engines with WasmGC, so they need no mode.

**The batched bridge** (`host-stream`, `dom-stream`).
- *How it works:* a program writes commands as 32-bit words into an arena in its own memory (`HostStream`). At `flush` it calls the `host:stream` import once, and the host replays the commands in one loop before the call returns.
- *What it needs:* the flush is a synchronous call on the same thread. It needs no SharedArrayBuffer, Atomics or Worker.
- *Growth:* when the memory grows, the host remakes its `Int32Array` and `Float64Array` views from `memory.buffer` (`Channel.fresh`). So the bridge does not depend on `toResizableBuffer` either, even though its arena is a typed array.
- *Records:* the host writes records into the arena, and the program reads them in place after the call.
- *Cross-thread mailbox:* there is none in the bridge.
- *Threads:* the bridge is single-threaded by construction, and it is already the single-threaded flush path.

**What needs cross-origin isolation (COOP: same-origin plus COEP: require-corp or credentialless) in a browser:**
- `SharedArrayBuffer` and `postMessage` of one;
- a shared `WebAssembly.Memory`;
- therefore wasi-threads workers, the worker ring and the shared payload.

Nothing in the default output needs it. Probed: every probe module runs in Chromium with `crossOriginIsolated === false`, where `SharedArrayBuffer` is undefined and a shared `WebAssembly.Memory` can't be made (§3.2). `Atomics.waitAsync` exists without isolation, but it is useful only on a shared buffer.

### 1.3 Threads and flushing in general

Every way a compiled program, its host or the bridge coordinates across threads:

| Mechanism | Lane | Where | Single-threaded today |
|---|---|---|---|
| The batched bridge flush | WasmGC | `host-stream` `flush` | It is single-threaded: a synchronous import call, replayed before return. |
| Typed-array `Atomics.*` | WasmGC | `bytes.ts` | Runs on unshared memory, where `notify` wakes no one. `wait` is refused on the browser target. |
| Shared linear memory | WasmGC link | `wasmLink.memory.shared` with a memory supplied by the environment; one instance per worker, typed arrays crossing link exports as (address, length) spans of that memory (`benchmarks/intrinsics/blur`) | Opt-in; default modules are unshared. |
| wasi-threads workers (`thread-spawn`, a Worker per thread on the same binary and memory) | WasmGC link with a threaded wasm32-wasip1-threads module | `wasiThreadsEnvironment` | No. Without isolation the environment can't make the shared memory, and `requireDeploymentCapabilities` refuses with a COOP/COEP message. |
| SPSC worker ring (slots in shared memory; producer on the UI thread, a consumer thread on a futex wait, page awaiting with `Atomics.waitAsync` on a completion epoch) | WasmGC link | the link's example kernel and client | The protocol has a direct path: the same tasks run on the UI thread give identical results, and that equality is asserted. It isn't packaged as a fallback. |
| Shared payload with single-owner publication (atomic owner word) | WasmGC link | the same | Works on one thread. Measured there, it is a publication protocol, not a speedup. |
| Promising-call queue (JSPI) | WasmGC link | `instantiateLinked` `admit` | Single-threaded: a per-instance serial queue, not a cross-thread one. |
| Runtime thread instances (`-DSCR_THREAD_INSTANCES`: thread-local runtime state, one complete instance per embedder thread) | Native library | `abi.instance_per_thread` profiles, `native/library.ts`; `mutable-bytes` export parameters let every thread's instance view one host buffer in place | Off by default; ordinary executables have one instance. |
| Worker executables (`-DSCR_WORKERS`: Node `worker_threads` as native threads) | Native executable | `executable-features.ts` (`workers` when the program uses workers) | Conditional on the program. Exclusive with thread instances. |
| The remote inbox (`scr_remote_post`, `scr_remote_hold`, `scr_remote_set_wake`, `scr_instance_remote`) | Native | `scr_ffi_queue.c` | Linked into every native executable. A foreign thread posts a task to an instance's loop, which wakes through a pipe or an embedder waker. Single-threaded programs simply never post. |
| `Atomics.waitAsync` on native | Native | `scr_atomics_wait.c` | Uses the remote inbox to resolve on the owning thread, holding the loop open. |
| The async filesystem worker | Native | `scr_async.c` | Always: POSIX executables link with `-pthread` (Windows uses `CreateThread`, WASI has none). |

### 1.4 The native lane, briefly

**pthreads.**
- POSIX executables always compile and link with `-pthread`, because callback-style filesystem work runs on a native worker (`native/executable.ts`).
- Worker executables add `SCR_WORKERS`, and thread-instanced libraries add `SCR_THREAD_INSTANCES`. Both are already modes, selected by program content and by the library profile respectively.

**CPU features.**
- *x86-64:* `targetCpu` (`--target-cpu`) is `baseline` (the default), `x86-64-v2`, `x86-64-v3`, `x86-64-v4` or `native`, which means the host's highest level (`backend/target-cpu.ts`). It sets LLVM's CPU for program code and selects runtime-pack lanes.
- *Other CPUs:* the target triple fixes them.

**Host feature sets.**
- `--host auto` picks the smallest set holding the services a program reaches: window, gpu, audio, net and rtc.
- `--host <set>` names one of full, ui, headless or offline, and `--host-features` adds or removes a service.

These are the native lane's capability modes, and the WasmGC modes in §4 should mirror them: a resolved, named set, auto-detected from the program and adjustable, and recorded in the artifact.

## 2. Support matrix

These are minimum stable versions without a flag. Sources:

- MDN browser-compat-data 8.1.11 (2026-11-26): [repository](https://github.com/mdn/browser-compat-data), [data](https://unpkg.com/@mdn/browser-compat-data/data.json);
- the [webassembly.org feature table](https://webassembly.org/features/) and its [data](https://github.com/WebAssembly/website/blob/main/features.json);
- V8's `src/wasm/wasm-feature-flags.h` at each Node tag and V8 branch;
- Chrome Platform Status, and the Firefox and WebKit release notes linked below.

The Node column is checked against `deps/v8/src/wasm/wasm-feature-flags.h` at the Node tag where the sources disagree. "Probed" marks a fact observed directly on the engines listed above.

| Capability | Chrome | Firefox | Safari | Node | Behind a flag |
|---|---|---|---|---|---|
| WasmGC (struct, array, i31) | 119 | 120 | 18.2 | 22.0 | — |
| Typed function references | 119 | 120 | 18.0 | 22.0 | — |
| Legacy EH (`try`/`catch`) | 95 | 100 | 15.2 | 17.0 | still on by default in V8 (`--wasm-legacy-eh`) |
| exnref EH (`try_table`, `throw_ref`) | 137 | 131 | 18.4 | 24.15 by source; probed on in 22.23.5 and 24.22.1 | Node 24.0–24.14: `--experimental-wasm-exnref` |
| `WebAssembly.JSTag` | 115 | 131 | 18.4 (BCD) or 26.0 (WebKit): unresolved | 22 | — |
| JS String Builtins (`builtins: ["js-string"]`) | 130 | 134 | 26.2 | 24.0; probed on in 22.23.5 | Node 22.0: `--experimental-wasm-imported-strings` |
| Imported string constants (`importedStringConstants`) | 130 | 134 | 26.2 (WebKit blog; BCD disagrees) | 24.0 | Node 22: absent even with the flag (probed) |
| JSPI (`Suspending`, `promising`) | 137 | 153 | 27 | 25.0 by source; probed on in 24.22.1 | Node 24.0: `--experimental-wasm-jspi`; Node 22's flag exposes the old `Suspender` API. Firefox ≤ 152: `javascript.options.wasm_js_promise_integration` |
| SIMD128 | 91 | 89 | 16.4 | 16.4 | — |
| Relaxed SIMD | 114 | 145 (features.json) or 146 (BCD) | not in stable; JSC `useWebAssemblyRelaxedSIMD` | 21.0 | Safari flag only |
| Tail calls | 112 | 121 | 18.2 | 20.0 | — |
| Bulk memory | 75 | 79 | 15 or 15.1 | 12.5 | — |
| Sign-ext, non-trapping float-to-int, multi-value, mutable globals, reference types | ≤ 96 | ≤ 79 | ≤ 15.1 | ≤ 17.2 | — |
| Extended-const | 114 | 112 | 17.4 | 21.0 | — |
| Multi-memory (not emitted) | 120 | 125 | not in stable | 22.0 | — |
| Memory64 (not emitted) | 133 | 134 | not in stable | 24.0; probed on in 22.23.5 | — |
| Branch hints (not emitted) | 137 | 148 (BCD) or pref-only (features.json): unresolved | 16 | 25.0 | Node 24: `--experimental-wasm-branch-hinting` |
| Wasm threads (shared memory, atomics) | 74 | 79 | 14.1 or 15.2 | 16.4 | browsers need cross-origin isolation for shared memory |
| `SharedArrayBuffer` | 92 (needs isolation) | 79 (needs isolation) | 15.2 (needs isolation) | 8.10 | — |
| `crossOriginIsolated`, COOP/COEP `require-corp` | 87 / 83 | 72 / 79 | 15.2 | n/a | — |
| COEP `credentialless` | 96 | 119 | not supported | n/a | — |
| `Atomics.wait`, `notify` | 68 | 78 | 15.2 | 8.10 | window agents can't block |
| `Atomics.waitAsync` | 90 (87 without timeouts) | 145 | 16.4 | 16.0 | — |
| Resizable `ArrayBuffer`, growable `SharedArrayBuffer` | 111 | 128 | 16.4 | 20.0 | — |
| `Memory.prototype.toResizableBuffer` | **144** | 145 | 26.2 | **26.0**; probed absent in 24.22.1 | Node 24, 25: `--experimental-wasm-rab-integration` |
| Module workers (`{ type: "module" }`) | 80 | 114 | 15 | n/a | — |

Citations by row:

- **Chrome:** [String Builtins](https://chromestatus.com/feature/6695587390423040), [JSPI](https://chromestatus.com/feature/5674874568704000), [WasmGC](https://chromestatus.com/feature/6062715726462976), [tail calls](https://chromestatus.com/feature/5423405012615168), [SIMD](https://chromestatus.com/feature/6533147810332672), [EH](https://chromestatus.com/feature/4756734233018368), [Memory64](https://chromestatus.com/feature/5070065734516736), [branch hints](https://chromestatus.com/feature/5165273114738688), [resizable ArrayBuffer](https://chromestatus.com/feature/4668361878274048), [`Atomics.waitAsync`](https://chromestatus.com/feature/6243382101803008), [COEP credentialless](https://chromestatus.com/feature/4918234241302528). V8 flag state for exnref, JSPI and RAB integration: [13.7](https://github.com/v8/v8/blob/13.7-lkgr/src/wasm/wasm-feature-flags.h), [14.3](https://github.com/v8/v8/blob/14.3-lkgr/src/wasm/wasm-feature-flags.h), [14.4](https://github.com/v8/v8/blob/14.4-lkgr/src/wasm/wasm-feature-flags.h).
- **Firefox:** [JSPI in 153](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/153), [`Atomics.waitAsync` in 145](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/145); all other rows from BCD.
- **Safari:** [Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/) (resizable buffers integration, string builtins, JSTag), WebKit's WWDC26 post on Safari 27, blog entry 17967 on [webkit.org/blog](https://webkit.org/blog/) (JSPI; its full URL was not re-checked); all other rows from BCD.
- **Node:** V8 per Node major from [`v8-version.h`](https://raw.githubusercontent.com/nodejs/node/v24.0.0/deps/v8/include/v8-version.h) (22.0 has V8 12.4, 24.0 has 13.6, 26.0 has 14.6). Flag state from `deps/v8/src/wasm/wasm-feature-flags.h` at [v22.22.0](https://github.com/nodejs/node/blob/v22.22.0/deps/v8/src/wasm/wasm-feature-flags.h), [v24.0.0](https://github.com/nodejs/node/blob/v24.0.0/deps/v8/src/wasm/wasm-feature-flags.h), [v24.15.0](https://github.com/nodejs/node/blob/v24.15.0/deps/v8/src/wasm/wasm-feature-flags.h), [v25.0.0](https://github.com/nodejs/node/blob/v25.0.0/deps/v8/src/wasm/wasm-feature-flags.h) and [v26.0.0](https://github.com/nodejs/node/blob/v26.0.0/deps/v8/src/wasm/wasm-feature-flags.h). The Node 22 constants gap is in [V8 12.4's `wasm-js.cc`](https://github.com/v8/v8/blob/12.4-lkgr/src/wasm/wasm-js.cc), which has no `importedStringConstants`.

**Not confirmed:**
- JSTag in Safari (18.4 or 26.0).
- Relaxed SIMD in Firefox (145 or 146).
- Branch hints in Firefox.
- `importedStringConstants` in Firefox and Safari. BCD lists Safari's compile options as unsupported, which contradicts the WebKit post. Firefox 134 comes only from BCD's whole-options entry.
- The minor-release backports in Node 22 and 24. Probes show Node 22.23.5 with exnref, the string builtins and memory64 on by default, and Node 24.22.1 with JSPI on by default. The release-tag sources show these flags later, so the first minor release that has each feature is not pinned here.

Older rows where the two data sets disagree give both values.

### What the package requires today

There are two requirements, and the package states only the first.

1. **Every module needs** WasmGC, exnref EH, the JS String Builtins and imported string constants. Most also need non-trapping float-to-int. The minimums are the maximum over those rows:
   - **Chrome 137**, **Firefox 134**, **Safari 26.2**: exnref sets Chrome's floor, and string constants set Firefox's and Safari's;
   - **Node 24**: `runtime-check.mjs` and `engines` say 24, and 24.22.1 runs it.

   Node 22.23.5 fails at instantiation, on the missing string constants alone.
2. **A module that hands a typed array to JavaScript** also needs `Memory.prototype.toResizableBuffer`: **Chrome 144**, **Firefox 145**, **Safari 26.2**, **Node 26**. The host refuses at instantiation otherwise. On Node 24, the package's declared floor, that refusal is real. A program as small as `sink(new Uint8Array(4))` hits it (§3.3).

The default output never needs JSPI, threads, `SharedArrayBuffer`, cross-origin isolation, relaxed SIMD or memory64. Those enter only through link configuration or opt-in options.

## 3. Proof by probe

Run from the repository root after building the compiler. Commands and their output, trimmed:

```console
$ node tests/capabilities/build.mjs
basics.wasm 3072 B
strings.wasm 1209 B
byte-view.wasm 898 B
simd.wasm 1657 B
relaxed-simd.wasm 1648 B
atomics.wasm 7334 B
generator.wasm 2477 B
async.wasm 3874 B
$ node tests/capabilities/features.mjs tests/capabilities/out/*.wasm
{"file":"async.wasm",...,"needs":["gc","reference-types","exception-handling","nontrapping-float-to-int"]}
{"file":"atomics.wasm",...,"needs":["gc","reference-types","exception-handling","sign-ext","nontrapping-float-to-int","threads"]}
{"file":"basics.wasm",...,"needs":["gc","reference-types","exception-handling","nontrapping-float-to-int","simd"]}
{"file":"byte-view.wasm",...,"needs":["gc","reference-types","exception-handling"]}
{"file":"relaxed-simd.wasm",...,"needs":["gc","reference-types","exception-handling","nontrapping-float-to-int","simd","relaxed-simd"]}
{"file":"strings.wasm",...,"imports":{"'":7,"wasm:js-string":6,"host":7},"needs":["gc","reference-types","exception-handling","nontrapping-float-to-int"]}
```

### 3.1 Chromium flags no longer switch these features off

Chromium 158 (V8 15.8) has removed the flags for every shipped feature in question. `--js-flags=--help` lists no `--experimental-wasm-exnref`, `-imported-strings`, `-jspi`, `-relaxed-simd` or `-rab-integration`; only `--wasm-legacy-eh` and staging or experimental flags remain. Passing the old names is silently ignored: with all five set, the page reports exnref valid, both string features native, `toResizableBuffer` present and JSPI running, and every probe module runs.

So a flag matrix in current Chromium can't test a missing capability. Missing JS-API entry points can be simulated by deleting them before page scripts run (§3.2). Missing wasm features need an older engine: Node with V8 flags (§3.3), or a pinned older Chromium.

### 3.2 Chromium: isolation and deleted JS API

From `node tests/capabilities/chromium.mjs`:

| Configuration | Capabilities seen | Probe modules |
|---|---|---|
| Default (no isolation) | `crossOriginIsolated` false, no `SharedArrayBuffer`, no shared memory; `waitAsync` and JSPI present; a JSPI round trip returns 42 | all 8 run |
| COOP and COEP | isolated, `SharedArrayBuffer`, shared memory, growable shared views | all 8 run |
| V8 flags off (§3.1) | unchanged | all 8 run |
| `toResizableBuffer`, `Suspending`, `promising` and `Atomics.waitAsync` deleted | as deleted | `byte-view` fails at **instantiate**: "this module hands byte views to the page, which requires `WebAssembly.Memory.prototype.toResizableBuffer` …"; the other 7 run |

The `atomics` module, with atomic instructions on unshared memory, runs without isolation.

### 3.3 Node 22 and 24

From `node [flags] tests/capabilities/node-stage.mjs <module> <mode>`:

| Engine, flags | Native strings | `constants` mode | `polyfill` mode |
|---|---|---|---|
| Node 24.22.1 | runs everything except `byte-view`, which fails at **instantiate** (`toResizableBuffer`) | same | same |
| Node 24.22.1 `--experimental-wasm-rab-integration` | all run, `byte-view` included | all run | all run |
| Node 24.22.1 `--no-experimental-wasm-exnref` | modules with a `catch` fail at **compile**: `CompileError … Invalid opcode 0x1f` (`basics`, `atomics`); `strings` runs | same | same |
| Node 24.22.1 `--no-experimental-wasm-imported-strings` | **instantiate**: `Import #0 "'"` | **instantiate**: `Import #18 "wasm:js-string"` | all run, except `byte-view` |
| Node 22.23.5 | **instantiate**: `Import #0 module="'": module is not an object or function` | all run, except `byte-view` | all run, except `byte-view` |

Nothing fails at build time: the compiler builds the same module whatever the target engine, so every failure shows at compile time (wasm validation) or at instantiation. No run-time failure was seen. The host's explicit refusals (byte views, JSPI, deployment requirements) are instantiation-time by design.

**Cost of the string fallbacks.** The `strings` module (300,000 iterations of `substring`, `concat`, `fromCodePoint`, `charCodeAt` and `===` on short strings) was run 5 times per configuration; times are run ms, median and range:

| Configuration | Run (ms) | Compile and instantiate (ms) |
|---|---|---|
| Node 24.22.1, native builtins | 737 (719–837) | 6.3 |
| Node 24.22.1, JS polyfill | 760 (678–790) | 7.2 |
| Node 22.23.5, builtins plus constants import | 717 (674–728) | 6.3 |
| Node 22.23.5, JS polyfill | 658 (641–827) | 6.4 |

The differences are inside the noise. V8 optimizes a small JS import called from wasm well enough that this benchmark can't separate them. The constants module adds one import per string literal, up to 140 in the sample, with no measurable cost to instantiation. Chromium's native builtins on the same benchmark took 725–802 ms.

## 4. Design: capability modes

The findings shape the design. Most capabilities are universal in every engine that has WasmGC, and need no mode. The ones that vary are few. Each has a different best point of decision:

| Capability | Values | Decided at | Fallback | Fallback exact? |
|---|---|---|---|---|
| WasmGC, typed references, SIMD128, bulk memory, sign-ext, non-trapping float-to-int, atomic instructions on unshared memory | always on | — (baseline) | none needed | — |
| Exception handling encoding | `exnref` (default), `legacy` | build | a legacy-EH artifact (skip `translate-to-exnref`) | yes: same semantics, different encoding |
| String builtins and constants | `engine`, `constants`, `polyfill` | **load** | host supplies module `'` and/or `wasm:js-string` from JS | yes: same strings, same traps |
| Byte views (`bytes.toJs`) | `resizable` (default), `fixed:<MiB>` | build (memory limits) and load (check) | fixed memory that never grows | yes, except `memory.grow` past the limit fails as out-of-memory |
| Relaxed SIMD | `off` (default), `on` | build | the non-relaxed lowering | results can differ in the low bits; deterministic per engine |
| JSPI suspending imports | `off` (default), `on` (manifest) | build, checked at load | none for synchronous source | — |
| Threads (shared memory, workers) | `off` (default), `shared`, `auto` | build (link) and load (isolation) | the single-threaded consumer (§4.3) | yes for results and order; not for timing |
| Native: CPU level, host set, workers, thread instances | existing | build | existing | — |
| Deterministic math | `fast` (default), `strict` | build (and implied by importing `scriptw/math`) | — (the strict-math library is the same code on every target and in plain JavaScript) | yes: bit-identical doubles |
| Intrinsic libraries (int, math, layout, f16, atomics, simd) | recorded per module | build | each library's plain-JavaScript bodies; f16's engine conversion where present ([intrinsics.md](intrinsics.md)) | yes |

### 4.1 Build time versus load time

Prefer **one artifact with load-time adaptation**. Build **variants** only where a capability changes wasm validity, and a load-time fix would cost more than a second file.

**Load time** works for the string builtins. The module's bytes are identical in every mode. The host chooses how to satisfy its imports:

1. Compile with `{ builtins: ["js-string"], importedStringConstants: "'" }`.
2. If `WebAssembly.Module.imports` still lists module `'`, the engine lacks constants: serve them as an object built from that import list, each name answering its own text.
3. If it still lists `wasm:js-string`, serve the polyfill.

Detection is free, because it reads the compiled module's own import list. This turns today's refusal on Node 22, Chrome 119–129, Firefox 120–133 and Safari 18.2–26.1 into a working path, as far as the other baseline features allow (§2).

**Build-time variants** are for exnref versus legacy EH, relaxed SIMD, and fixed memory. Each changes what validates or what the module declares, so one binary can't serve both sides.

A variant set is a small, ordered list. A loader picks the first variant whose requirements this engine meets. It checks requirements with `WebAssembly.validate` on tiny probe modules, never on the artifact itself, so it downloads only what it runs. `runtime-check.mjs`, `engine-probe.mjs` and `web/probe.js` hold such probes; each is under 100 bytes. Presence checks cover the JS-API capabilities (`toResizableBuffer`, `Suspending`, `crossOriginIsolated`).

Keep variants to two at most: the preferred one and one `compat`. Each variant doubles build time and test lanes.

### 4.2 What auto picks

`auto` resolves at build time against declared **targets**, then refines at load time against the engine. With no targets declared, the default target set is the current baseline: Chrome 137, Firefox 134, Safari 26.2, Node 24.

**Build time:**
- *EH:* `exnref`, unless a target predates it (Chrome < 137, Firefox < 131, Safari < 18.4, Node < 24.15). Then add a `legacy` variant.
- *Byte views:* `resizable`. If a target lacks `toResizableBuffer` (Chrome < 144, Firefox < 145, Safari < 26.2, Node < 26) **and the program crosses byte views** (the module imports `bytes.toJs`; the emitter knows), also build a `fixed` variant. Otherwise warn that those targets will refuse.
- *Relaxed SIMD:* only on request. If it is requested and a target lacks it (Safari today), add a non-relaxed variant.
- *JSPI:* only by manifest. If a target lacks it, the build fails, naming the target, because no variant can help.
- *Threads:* only by link configuration (§4.3).

**Load time** (`scriptw/host`):
- strings as in §4.1;
- variant choice by probe;
- deployment checks (`deploymentCapabilities`, now exported) for anything the chosen variant requires.

**On Node:** `scriptw run` and the CLI know the engine they run on.
- On Node 24 and 25, a module that crosses byte views runs if `run` re-executes Node with `--experimental-wasm-rab-integration`. Probed: Node refuses the flag in `NODE_OPTIONS`, and `v8.setFlagsFromString` affects only new contexts, so re-execution (the CLI already imports `spawnSync`) is the way.
- On Node 22, strings fall back at load time. Byte-view programs need the `fixed` variant.
- `runtime-check.mjs` should test what the chosen artifact needs, not a fixed list.

**In a browser:** the loader probes once per page and caches the answer in memory. In a cross-origin-isolated page it may choose a threaded variant if one exists. Otherwise it chooses the single-threaded one, and reports why.

### 4.3 Threads

Threads stay **opt-in**. Nothing in the default output uses them, and a browser needs cross-origin isolation to have them. COOP/COEP is a deployment decision the package can't make for a page: `require-corp` breaks cross-origin subresources without CORP, and `credentialless` doesn't exist in Safari.

The modes:

- **`off`** (the default): an unshared memory, no workers. `Atomics.*` on typed arrays still compile to instructions that validate and run. `notify` returns 0. `wait` stays refused on the browser target.
- **`shared`**: the link's shared memory, wasi-threads workers and the worker ring. Instantiation requires `crossOriginIsolated`, `SharedArrayBuffer` and a shared `WebAssembly.Memory`, plus `Atomics.waitAsync` on a page. It refuses with today's actionable COOP/COEP message (`requireDeploymentCapabilities`).
- **`auto`**: the build emits both the threaded artifact and the single-threaded consumer (below). The host picks threads when `deploymentCapabilities()` meets the requirements, and otherwise the single-threaded path, recording which.

**A single-threaded fallback with exact semantics.** The coordination code is the SPSC ring:
- the producer writes a payload, publishes the slot `READY` and bumps the epoch;
- the consumer takes the slot, runs the entry and publishes `DONE`;
- the waiter awaits the epoch and reaps.

The fallback keeps the ring, its memory layout and its state machine. It replaces only the two cross-thread primitives:

1. **The consumer thread becomes a scheduled task on the owner's thread.** Publication calls a host hook (`ring.kick`). On a shared memory this is the atomic `notify`. In the fallback it queues one macrotask (`MessageChannel`, as the scheduler already does). That task drains `READY` slots in submission order, running the same entry on each and publishing `DONE` with the same status codes. A drain checks the stop flag between tasks, so stop finishes the task in hand, cancels the queued ones (`STATUS_CANCELLED`) and exits, just as the thread does.
2. **`Atomics.waitAsync` on the completion epoch becomes a promise** the drain resolves when it bumps the epoch. The missed-wakeup rule carries over unchanged: read the epoch, check for work, then wait for a change from that epoch.

What a program observes stays the same:
- submission ids and slot reuse;
- refusals (a full ring, after stop, a bad length);
- result values and statuses;
- the order of completions, since an SPSC ring with one consumer completes in submission order either way;
- reap callbacks.

The equivalence between the direct path and the worker path is already asserted, and the fallback makes that direct path the protocol's own consumer.

**Measured.** `benchmarks/intrinsics/blur` runs one job system on every lane: WasmGC `threads=shared` with one instance per worker on one shared memory, under Node's `worker_threads` and in a cross-origin-isolated Chromium page with module Workers; a native thread-instanced library with one pthread per instance; and JavaScript workers. Each gives the same image as one thread. The table is in its `RESULTS.md` (Threads).

What differs is time. The owner's thread does the work, so the UI is not freed. Worker-only lifecycle steps become no-ops: there is no thread to start or exit, no stack to reap, and the stuck-worker deadline and abandon budget can't arise. The fallback needs no allocator-ownership rule either, because only one thread allocates.

**Flushing** needs no fallback. The batched bridge already flushes synchronously on the calling thread (§1.2). A future off-thread replay, a worker that owns the DOM channel, would be a `shared`-only mode with the synchronous flush as its fallback.

**Native:**
- The remote inbox already serves single-threaded programs: a post from the owner's own thread is an ordinary macrotask.
- Worker and thread-instance builds stay content-driven and profile-driven modes, as now.
- `-pthread` on POSIX exists for the async filesystem worker. The `wasm32-wasi` pack already builds without it, which shows a thread-free runtime configuration exists if a platform ever needs one.

### 4.4 CLI and API surface

**Build (CLI and `compile()`):**

```text
scriptw build app.ts [--capabilities baseline|compat|auto|<list>] [--targets <list>] [--explain-capabilities]
  <list>:    eh=exnref|legacy, views=resizable|fixed:<MiB>, relaxed-simd, threads=off|shared|auto, jspi
  --targets: chrome>=137,firefox>=134,safari>=26.2,node>=24.15 (the default)
```

`compile(entry, { capabilities, targets })` takes the same options. The result gains `capabilities`, the resolved set, and `variants`, one entry per artifact: `{ wasmPath, requires, capabilities }`. `--explain-capabilities` prints each resolved value and why, the way `--explain-host` does for the native host set.

**Artifact metadata:**
- **Authoritative:** a `scriptc.capabilities` custom section in each artifact, holding the resolved set as JSON, next to `scriptc.host-abi`. The host reads it from the compiled module, as it reads the ABI.
- **Link builds:** `wasm-merge` drops custom sections, so the link build must re-append it, as it already does for `scriptc.host-abi`.
- **The sidecar:** the host sidecar is a bare JSON array of import names today, compared byte for byte in tests. Give it a `capabilities` field by moving to an object form, `{ "imports": [...], "capabilities": {...} }`, where readers still accept the array form. Alternatively, write `<out>.wasm.capabilities.json` beside it. A variant set adds `<out>.variants.json`, the ordered list a loader reads.

**Load (`scriptw/host`):**

```ts
detectCapabilities(): EngineCapabilities;               // probes, once; a superset of deploymentCapabilities()
requiredCapabilities(module: object): Capabilities;     // from the scriptc.capabilities section
instantiateWasmGc(binary, {
  capabilities?: "auto" | "strict",                     // strict: refuse instead of falling back
  strings?: "auto" | "engine" | "constants" | "polyfill",
  threads?: "auto" | "off" | "shared",
}): Promise<WasmGcInstance & { capabilities: { required; provided; fallbacks: string[] } }>;
loadWasmGc(variantsUrl, options): Promise<...>;         // picks a variant by probe, compiles it streaming
```

`fallbacks` names each fallback taken (for example `strings:constants`), so a page or a test can assert the path it ran. Every refusal keeps today's shape: what is missing, and how to provide it. The version strings in the refusals come from this document's table (`SUPPORT` in `capabilities.ts`); the byte-view message used to say Chrome 136 where the truth is 144.

### 4.5 The cache key

The compiler has no WasmGC build cache today; the native lane's library cache keys on its options (`library-cache.ts` `cacheKey`). The rule for capabilities:

- **Build-time capabilities join the key** in their **resolved** form, never as `auto`, because the same `auto` resolves differently under different targets. Use a canonical string, for example:

  ```text
  wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off
  ```

  It must go into any build or artifact cache key, the variant file names (`app.wasm`, `app.compat.wasm`), and the `scriptc.capabilities` section. Distinct bytes then get distinct URLs, so HTTP caches and the engine's code cache (`compileStreaming` keys on the response) never confuse variants.
- **Load-time choices don't enter a build key.** The strings mode leaves the bytes unchanged. They are reported per instance (`fallbacks`), and a loader that caches compiled modules (IndexedDB) keys on the bytes' hash plus the compile options it used. A module compiled with `importedStringConstants` and one compiled without are different engine modules.
- **The feature flags themselves** (`WASMGC_FEATURE_FLAGS`) are part of the compiler version, as now. A mode that removes a feature changes the flags passed to wasm-opt and joins the key through the resolved string.

### 4.6 Testing each mode in CI

Current Chromium can't switch features off (§3.1), so the matrix combines lanes:

| Lane | What it proves |
|---|---|
| Node 24 (current minor), default | the baseline; that byte-view programs refuse (or, once the CLI re-executes, run) |
| Node 24 `--experimental-wasm-rab-integration`, and Node 26 | `resizable` byte views |
| Node 24 `--no-experimental-wasm-exnref` | that a `legacy` variant runs, and that `exnref` refuses at compile |
| Node 24 `--no-experimental-wasm-imported-strings` | the `polyfill` strings path |
| Node 22 (current minor) | the `constants` strings path; the `fixed` byte-view variant |
| Chromium, default and cross-origin isolated | `threads=auto` picking each side, with the same output |
| Chromium with JS-API entry points deleted by init script (`toResizableBuffer`, `Suspending`/`promising`, `Atomics.waitAsync`, `SharedArrayBuffer`) | the load-time refusals and fallbacks for JS-API capabilities |
| A pinned older Chrome for Testing (136 for no exnref/JSPI/`toResizableBuffer`; 129 for no string builtins) | wasm-level absence in a real browser |
| Playwright WebKit and Firefox | Safari's relaxed-SIMD refusal and the compat variant; Firefox's version floor |

Each lane runs `tests/capabilities` plus a slice of the differential corpus under each mode it supports. It asserts the same stdout, stderr and exit status across modes: a fallback is exact or it isn't one. `fallbacks` lets a lane assert that it took the path it meant to test, rather than passing by accident on a capable engine.

The Playwright install in this environment has Chromium only. Firefox, WebKit and older Chrome lanes are proposals and were not run here.

### 4.7 Cost and size

| Fallback | Cost | Measured |
|---|---|---|
| Strings: `constants` | one import per string literal (up to 140 in the sample); no code | no difference in run or instantiate time (§3.3) |
| Strings: `polyfill` | 11 JS functions, 746 bytes of source | no difference on the string benchmark; V8 inlines small JS imports, other engines unmeasured |
| EH: `legacy` | the same module with the translation pass skipped; Binaryen's builder produces it | size not measured: wasm-opt has no reverse translation, so measuring needs the emitter change |
| Byte views: `fixed:<MiB>` | the memory is declared at its maximum and never grows | Node 24: a 256 MiB fixed memory adds 0.1 MiB RSS at creation and only the touched pages after (16 MiB touched, 16 MiB RSS). The limit becomes a hard heap ceiling; large reservations may fail on memory-constrained mobile browsers (unmeasured) |
| Relaxed SIMD off | the non-relaxed lowering | 1657 B against 1648 B for the probe module; speed depends on the kernel |
| Threads off | no parallelism; worker lifecycle becomes no-ops | the existing one-thread measurements: the direct path matches the worker path's results, and costs the work's full time on the UI thread (for example 440 ms against 76 ms of UI time for 64 tasks of 256 KiB at work 16) |
| A second variant | a second build and a second test lane; the page downloads only the chosen one | build time about doubles for the variant set |

### 4.8 Recommended defaults

1. **The baseline is the default:**
   - **What it holds:** WasmGC, typed references, exnref, SIMD128, the universal post-MVP features, and atomic instructions on unshared memory.
   - **Why:** every engine with WasmGC except the narrow exnref gap has all of it, and the scan shows the module uses no more.
2. **Make strings a load-time `auto`, on by default:**
   - **The rest of the plan:** keep `strict` for tests, and have `runtime-check.mjs` stop refusing Node 22 for the strings gap.
   - **Why:** it is exact, costs nothing measured, needs no new artifact, and the host already has the `suppliedStrings` path.
3. **Close the Node 24 byte-view gap:**
   - **Now:** make `scriptw run` re-execute with `--experimental-wasm-rab-integration` on Node 24 and 25, and correct the refusal's version text.
   - **Then:** offer `views=fixed:<MiB>` as the compat variant `auto` builds for older targets when a program crosses byte views.
   - **Why:** the engines field promises Node 24, and a program that passes one typed array to a host function breaks that promise today.
4. **Keep threads opt-in.** Implement `threads=auto` only together with the single-threaded consumer, so `auto` never changes what a program computes. Why: isolation is the page's choice, and the default output has no use for threads.
5. **Keep JSPI and relaxed SIMD opt-in,** with build-time refusal against declared targets. Why: JSPI has no exact fallback; relaxed SIMD changes results in the low bits and Safari rejects it.
6. **Don't build a legacy-EH variant by default.** Keep it available as `eh=legacy`. Why: it only reaches Chrome 119–136, Firefox 120–130 and Safari 18.2–18.3, all auto-updating channels already past the gap. It costs a lane in CI.
7. **Record the resolved set in every artifact,** in the `scriptc.capabilities` section and the sidecar. Have the host compare it with `detectCapabilities()` before instantiation, so every failure is an actionable refusal at load, never a `CompileError` or `LinkError` from deep inside the engine.

## 5. Implementation

### 5.1 Recorded capabilities

- `packages/compiler/src/backend/wasmgc/capabilities.ts` holds the modes, the canonical key, the support table (`SUPPORT`, from §2), target parsing, variant planning, the probes and the section codec. It has no Node imports; the host and page loaders use it.
- Every module carries a `scriptc.capabilities` custom section: `{ key, variant, requires }`, about 200 bytes. `<out>.wasm.capabilities.json` carries the same record with the mode spelled out. The bare `<out>.wasm.host.json` array is unchanged.
- The key is the resolved canonical string (`wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off`), never `auto`. It names variant files, and is the component any build cache keys on.
- After a merge, `withMergedCapabilities(merged, inputs)` re-appends the record: the union of the inputs' requirements, refusing inputs built under different modes. The closed-model proof and the link build use it, beside their existing host-ABI re-append.

### 5.2 The string fallbacks

- `instantiateLinked` compiles with the engine's string options, then reads the compiled module's import list. Constants still listed get a `'` module built from their names; builtins still listed get `jsStringPolyfill`. Each is recorded in the instance's `capabilities.fallbacks`.
- Options: `capabilities: "strict"` refuses instead. `strings: "engine" | "constants" | "polyfill"` forces a path, for tests and comparisons.
- `runtime-check.mjs` refuses only for the hard requirements, WasmGC and exception handling with exnref. `engines` is `>=22`.

### 5.3 Byte views

- `views=fixed:<MiB>`: `bytes.ts` declares the module memory at `initial = maximum = MiB × 16` pages. The host recognizes a fixed memory from the record and uses its buffer directly. An allocation past the limit traps, as an exhausted growing memory does.
- `scriptw run` reruns itself with `--experimental-wasm-rab-integration` on Node 24 and 25 when the module needs resizable buffers and the engine lacks them. Otherwise it runs the first variant of the module's set that the engine runs.
- Refusals name the first releases from `SUPPORT`, with a hint: the Node flag, or `views=fixed`.

### 5.4 Checked

- **Unit and integration tests:**
  - `packages/compiler/src/backend/wasmgc/capabilities.test.ts`: keys, lists, targets, planning, the section codec, merging and probes;
  - `packages/compiler/test/wasmgc-capabilities.test.ts`: every mode and every string fallback prints the same; strict refuses; a fixed memory runs without `toResizableBuffer`; `auto` builds it as the compat variant; and `loadWasmGc` downloads only the variant it picks.

  Both pass on Node 22.23.5 and 24.22.1.
- **Probes** (`tests/capabilities/node-stage.mjs`):
  - Node 22.23.5 runs every probe module through `strings:constants`, except the byte-view module, which refuses with the Chrome 144 / Node 26 message; its `views=fixed` build runs.
  - Node 24.22.1 with `--no-experimental-wasm-imported-strings` runs through both fallbacks.
  - With `--no-experimental-wasm-exnref`, an exnref module is refused, naming exnref and `eh=legacy`, and the `eh=legacy` build runs.
- **The CLI:** `scriptw run` of a byte-view program works on Node 24.22.1 (rerun with the flag) and on Node 22.23.5 (the fixed compat variant).

### 5.5 Variants, targets and the CLI

- `compile(entry, { capabilities, targets })`: `capabilities` is a preset (`auto`, `baseline`, `compat`) and/or a list, or a parsed request; `targets` is `chrome>=137,firefox>=134,safari>=26.2,node>=24.15` by default.
  - The default Node target is 24.15, not 24: exnref ships unflagged from Node 24.15, and a plain `node>=24` would build a legacy-EH variant for every program.
  - The compiler's own API builds the baseline only unless one of the two options is given, so existing callers see no new files. The npm package passes `auto`.
- After the preferred build, `planVariants` decides on at most one compat variant from what the module uses (`capabilityUses`: byte views, JSPI, relaxed SIMD, SIMD, shared memory) and the targets that lack a requirement.
  - The variant is emitted from the same IR: the emitter copies before it changes it. It is written as `<out>.compat.wasm` and listed with the preferred one in `<out>.wasm.variants.json`.
  - `compile()` returns `capabilities`, `variants` and `explainCapabilities`.
- A suspending FFI import with a target lacking JSPI, or with `-jspi`, is a build error (SC3002) naming the targets.
- The CLI has `--capabilities`, `--targets` and `--explain-capabilities`. `scriptw build` reports every file it wrote.
- `relaxed-simd` in the list turns `experimentalRelaxedSimd` on. A target without relaxed SIMD (Safari) gets a variant without it.
- `threads=shared` records the shared-memory and cross-origin-isolation requirements; `threads=auto` records the mode only. A link build on a shared memory (`wasmLink.memory.shared`) resolves to `threads=shared` unless it asked for `auto`. JSPI is not part of the key: a module that uses it records `jspi` among its requirements.

### 5.6 The loader

`scriptw/host` exports:

- `loadWasmGc(url, { read? })`: reads a variant set (or a `.wasm`, with its set beside it when there is one), picks the first variant whose hard requirements `detectCapabilities()` meets, downloads only that one, and reports `variant`.
- `chooseVariant`, `detectCapabilities` (probes once per realm), `requiredCapabilities`, `deploymentCapabilities` and `requireDeploymentCapabilities`.
- A module this engine cannot compile, given as bytes, is refused by name from its recorded requirements (read from the raw bytes), not with the engine's `CompileError`.

### 5.7 Threads

`packages/compiler/src/backend/wasmgc/task-ring.ts` (exported by `scriptw/host`) is the generic form of §4.3. It is a bounded SPSC ring with a 16-word header, 8-word slots and 16-byte-aligned payload regions, and the FREE → READY → TAKEN → DONE → FREE state machine:

- `threads: "shared"`: a consumer thread runs `runTaskConsumer` over the ring's SharedArrayBuffer. It sleeps on the epoch with `Atomics.wait`, and the owner awaits completions with `Atomics.waitAsync`.
- `threads: "off"`: a publish queues one `MessageChannel` macrotask that drains READY slots in submission order through the same `drain` function, and completions resolve promises.
- `threads: "auto"`: `shared` when the engine and page can share memory (a page must be cross-origin isolated) and a consumer can be started, else `off`.
- Both modes share the epoch rule and the stop rule. After a stop, queued tasks settle as `STATUS_CANCELLED`. A `hold` word makes cancellation deterministic in tests.

`packages/compiler/test/task-ring.test.ts` runs one script (a full ring, a bad entry, a failing runner, slot reuse, a bad publish, stop with tasks queued, publishes after stop) in both modes, with a `worker_threads` consumer for `shared`, and requires identical logs. It passes on Node 22.23.5 and 24.22.1. In headless Chromium 158 the browser lane runs it under `threads: "auto"`: `shared` in an isolated page with a module Worker consumer, and `off` without isolation or with `SharedArrayBuffer` deleted, with one log.

### 5.8 CI lanes

`.github/workflows/capabilities.yml` runs `tests/capabilities/lane.mjs` and the capability tests:

- **Node lanes:** Node 22, 24, 24 with `--experimental-wasm-rab-integration`, 24 with `--no-experimental-wasm-exnref`, 24 with `--no-experimental-wasm-imported-strings`, and 26.
- **Browser lanes** (`chromium.mjs`): current Chromium without and with cross-origin isolation and with JS-API entry points deleted; Firefox; WebKit; and pinned Chrome for Testing 136 and 129.

Every lane checks each probe module under each strings mode against one set of goldens (`tests/capabilities/expected.json`). A module whose requirements the engine meets must print exactly the golden. One it does not meet must be refused, naming what is missing.

Run here:

| Lane | Modes that ran | Refused |
|---|---|---|
| Node 22.23.5 | 27 | 13 (strict strings; resizable buffers) |
| Node 24.22.1 | 36 | 4 (resizable buffers) |
| Node 24.22.1, RAB integration | 40 | 0 |
| Node 24.22.1, no exnref | 4 (the legacy-EH module) | 36 |
| Node 24.22.1, no imported strings | 27 | 13 |
| Chromium 158, default / isolated / JS API deleted | all | byte views with `toResizableBuffer` deleted |

**Not run here:** Node 26, Firefox, WebKit and the pinned Chrome for Testing lanes. The workflow defines them; this environment has Node 22 and 24 and Playwright's Chromium only.

### 5.9 Intrinsic libraries and the math mode

[intrinsics.md](intrinsics.md) describes the intrinsic layer. Its effect on capabilities is small.

- **The record.** `CapabilityUses.intrinsics`, the record and the `scriptc.capabilities` section carry `intrinsics`: the libraries a module imports, sorted (`["f16", "int", "math"]`). A reader that predates the field ignores it. `--explain-capabilities` prints one `intrinsics:` line per library with its lowering and fallback, and a `math:` line.
- **The math mode.**
  - `math=fast|strict` is the only new mode. A program that imports the strict-math library is built `strict` whatever was asked (`effectiveMode`).
  - `strict` turns the SIMD library's relaxed lowerings off, and refuses an explicit `relaxed-simd` at planning time.
  - `strict` also stores every NaN written to a `Float32Array`, a `Float64Array` or through `DataView` as the canonical quiet NaN (`bytes.ts`, `canonicalNaN`). A folded `0 / 0` (`0x7ff8…`) and the same division at run time (`0xfff8…` on x86) then read back the same bits.
  - The key ends in `;math=strict` only when strict. `modeOfKey` reads keys with or without it, and refuses `math=fast` spelled out, so a key has one spelling.
- **Requirements.** No library adds an engine requirement. The instructions they lower to (i32/i64, SIMD128, atomics on unshared memory) are in every WasmGC engine's baseline (§1.1). Shared-memory atomics still come from `threads=shared`.
- **f16.** The only load-time choice is f16's, and it is made in plain JavaScript, not in the module: the package's JavaScript entry uses `Math.f16round` and the `DataView` float16 methods where present, and reports `F16_PATH`. Compiled modules always convert in software (WasmGC) or through the runtime (native). Both are exact, so this is a speed fallback, not a semantic one.
- **Checked by:**
  - `packages/compiler/src/backend/wasmgc/capabilities.test.ts`: the key, `modeOfKey`, the strict refusal, the record and the explain lines;
  - the differential corpus 4729 to 4732 (Node, WasmGC, native).

