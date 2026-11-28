# Framework table benchmark

The React benchmark's program (`../react-dom`) written for SolidJS (`solid/app/app.tsx`) and Svelte 5 (`svelte/app/`), with the same rows, labels, operations, result checks and table fingerprint. It runs in headless Chromium on the React benchmark's page (`../react-dom/page/bench-page.js`), so every lane of every framework is measured the same way. See `../react-dom/README.md` for the method: fresh pages, rotated lanes, warmup, median and p95, per-sample checks, a cross-lane fingerprint, and layout timed apart.

Pinned dev dependencies of this package: solid-js 1.9.20, babel-preset-solid 1.9.19, @babel/core 7.29.16 and svelte 5.59.2. `solid/PATCHES.md` and `svelte/PATCHES.md` list every change the WasmGC builds make to framework code. `RESULTS.md` has the numbers.

## Lanes

- `solid`, `svelte`: the framework's JavaScript build (`out/<framework>.js`, esbuild, minified), the baseline.
- `<framework>.published`: the same bundle, unminified, compiled to WasmGC as it is (`browser: true`, native dyn). Its DOM calls are per-call host calls.
- `solid.port`: a typed TypeScript port of the part of Solid's runtime this program reaches (`solid/port`), with the page's DOM, per call.
- `solid.stream`: the port with its DOM on the DOM stream (`packages/dom-stream`).
- `svelte.stream`: Svelte's published runtime, with the components compiled for a custom renderer over the DOM stream (`svelte/stream/renderer.ts`).

## Running

```console
$ npm install --prefix benchmarks/frameworks
$ node benchmarks/frameworks/build-js.mjs
$ node benchmarks/frameworks/build-wasm.mjs solid published
$ node benchmarks/frameworks/build-wasm.mjs solid port
$ node benchmarks/frameworks/build-wasm.mjs solid stream
$ node benchmarks/frameworks/build-wasm.mjs svelte published
$ node benchmarks/frameworks/build-wasm.mjs svelte stream
$ node benchmarks/frameworks/run.mjs --js solid=benchmarks/frameworks/out/solid.js --wasm solid.published=benchmarks/frameworks/out/solid.published.wasm --bridge solid.stream=benchmarks/frameworks/out/solid.stream.wasm [--pages 3] [--warmup 5] [--iterations 10] [--ops create1k,select] [--receipt name]
$ node benchmarks/frameworks/run.mjs --count --wasm solid.published=benchmarks/frameworks/out/solid.published.wasm
```

A lane is `<framework>` (a JavaScript build) or `<framework>.<variant>` (a WasmGC build), and a WasmGC lane's ratio is to its framework's JavaScript lane. `--wasm` runs a per-call build, and `--bridge` one on the DOM stream, with the stream's page half loaded. React's lanes run in the same runner (`--js react=benchmarks/react-dom/out/app.js`). `build-wasm.mjs` writes `out/<framework>.<variant>.wasm`, takes `--dev` for a dev build and `BUILD_OPTIONS` (JSON) for extra compile options, and keeps function names with `SCRIPTC_WASMGC_NAMED=1`. `../react-dom/profile.mjs` splits a lane's time; pass the build with `--wasm`, and for a stream build add `--query bridge=/packages/dom-stream/src/dom-host.js`.
