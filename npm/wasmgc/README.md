# wasmgc-ts

Compile TypeScript and JavaScript to WasmGC modules, and run them under Node, with no native toolchain to install.

```console
$ npx wasmgc-ts build app.ts --target wasmgc
$ npx wasmgc-ts run app.ts
```

`build` writes `app.wasm` and its host sidecar `app.wasm.host.json`. `run` compiles to a temporary directory and runs the module in the same Node process; it also runs a built `.wasm`. `--release` compiles a release build.

Node 24 or later is required: the modules use WasmGC, exception handling and JS String Builtins.

## What is inside

- The compiler's frontend, IR passes and WasmGC emitter, as JavaScript.
- Binaryen 132 (the module builder) and wasm-opt 133, as JavaScript and wasm.
- TypeScript 5.9 for the source-string parser.

The type checker is TypeScript 7, which npm installs as a regular dependency: its package selects a native executable for the platform. It is the one part that is not JavaScript or wasm.

The native LLVM target, its runtime packs and the LLVM helper are not part of this package.

## Building the package

From a built checkout (`pnpm install && pnpm -r build`):

```console
$ node npm/wasmgc/scripts/assemble.mjs
$ node npm/wasmgc/test/smoke.mjs npm/wasmgc/.stage/wasmgc-ts-0.1.0.tgz
```

`assemble.mjs` stages the package under `npm/wasmgc/.stage` and packs it. `smoke.mjs` installs the tarball into a clean directory and checks each sample under `test/samples` against Node running the same source.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
