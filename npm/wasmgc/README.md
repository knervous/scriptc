# scriptw

Compile TypeScript and JavaScript to WasmGC modules, and run them under Node, with no native toolchain to install.

```console
$ npx scriptw build app.ts --target wasmgc
$ npx scriptw run app.ts
```

`build` writes `app.wasm` and its host sidecar `app.wasm.host.json`. `run` compiles to a temporary directory and runs the module in the same Node process; it also runs a built `.wasm`. `--release` compiles a release build.

Node 24 or later is required: the modules use WasmGC, exception handling and JS String Builtins.

## What is inside

- The compiler's frontend, IR passes and WasmGC emitter, as JavaScript.
- Binaryen 132 (the module builder) and wasm-opt 133, as JavaScript and wasm.
- TypeScript 5.9 for the source-string parser.

The type checker is TypeScript 7, which npm installs as a regular dependency: its package selects a native executable for the platform. It is the one part that is not JavaScript or wasm.

## Native target

`--target native` builds a native executable for this machine, and `--target native:<platform>` cross-builds for `linux-x64-gnu`, `win32-x64`, `darwin-arm64`, `darwin-x64` or `android-arm64`.

```console
$ npx scriptw build app.ts --target native
$ npx scriptw run app.ts --target native
$ npx scriptw build app.ts --target native:android-arm64 --browser
```

A native build takes three companion packages:

- `@scriptw/llvm-<machine>`: the LLVM helper, for the machine that builds;
- `@scriptw/runtime-<target>`: the precompiled runtime for the target;
- `@scriptw/host-<target>`: the native host a page program (`--browser`) links.

None of them is published yet. Until they are, the package does not list them, and a native build takes each one from a directory: `SCRIPTW_LLVM_PACK`, `SCRIPTW_RUNTIME_PACK` and `SCRIPTW_HOST_PACK`. A build that is missing one fails and names the package.

Once they are published, the package lists them as optional dependencies (`SCRIPTW_COMPANIONS=1 node npm/wasmgc/scripts/assemble.mjs`). npm then installs the ones that match this machine, and a cross build installs the target's runtime and host packages itself.

`--browser` compiles a page program: DOM, timers and typed `host:` modules. Natively, its page operations go to the host island, which calls a host through one C vtable, `scr_host_ops()`. The host comes from the target's host package, which ships the host as sets of services: `full`, `ui` (window, GPU and network), `headless` (network only) and `offline`; Linux ships `full`, `headless` and `offline`, and Android `full` and `ui`. By default (`--host auto`) the build takes the smallest set that holds the services the program reaches: the window for canvases, `screen` and the clipboard; the GPU for `navigator.gpu`; audio for `AudioContext` and `Audio`; RTC for `RTCPeerConnection`; the network for `fetch`, `XMLHttpRequest` and `WebSocket`. The document, timers and storage are in every set. A program that reads globals by a computed name gets `full`. `--host <set>` names a set, `--host-features audio,-rtc` adds or removes services on top of what the program reaches, and `--explain-host` prints the choice and why. `--host-lib <archive>` links your own `scr_host_ops()` instead, and `--host quickjs` uses the embedded QuickJS engine instead of a host.

`android-arm64` writes `<name>/libmain.so`, a shared library whose exported `main` an Android Activity calls. It needs the Android NDK: set `ANDROID_NDK_ROOT`, or install one under the SDK (`sdkmanager 'ndk;30.0.16248370'`). Packaging the library into an APK is left to the app's own Gradle build.

## Building the package

From a built checkout (`pnpm install && pnpm -r build`):

```console
$ node npm/wasmgc/scripts/assemble.mjs
$ node npm/wasmgc/test/smoke.mjs npm/wasmgc/.stage/scriptw-0.1.0.tgz
```

`assemble.mjs` stages the package under `npm/wasmgc/.stage` and packs it. `smoke.mjs` installs the tarball into a clean directory and checks each sample under `test/samples` against Node running the same source.

## Experimental: tsc-ts as a WasmGC checker

`tsc-ts/` holds the first steps toward a package with no native executable: tsc-ts (the TypeScript 7 checker ported to TypeScript) compiled to WasmGC by this compiler, to stand in for tsgo.

```console
$ git clone --depth 1 --branch v0.1.5 https://github.com/vercel-labs/tsc-ts
$ (cd tsc-ts && npm ci --ignore-scripts --omit=optional)
$ node npm/wasmgc/tsc-ts/prepare.mjs tsc-ts
$ node --max-old-space-size=14000 npm/wasmgc/tsc-ts/compile.mjs tsc-ts out/tsc-ts.wasm
```

`prepare.mjs` cuts tsc-ts's thread machinery, which a WasmGC build never uses. The compile gets through the whole program's frontend and lowering and stops at one internal compiler error: `Symbol.getMembers` and `Symbol.getExports` call a function the lowering drops (`byEscapedName` in `src/compiler/symbol.ts`). It does not yet emit a module, so the package still uses tsgo.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
