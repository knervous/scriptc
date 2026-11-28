# Scene benchmark

A CPU-side benchmark of three 3D libraries from npm, unmodified: three.js (`three`), Babylon Lite (`@babylonjs/lite`) and Babylon.js (`@babylonjs/core`). Each app builds N meshes and, every frame, animates every mesh's transform, then lets the library update world matrices, cull against the camera frustum and render. The same app runs as JavaScript and compiled to WasmGC, and the measure is the frame call's script time. Rendering runs on SwiftShader in headless Chromium, so GPU time means nothing and is not measured.

- `three/app.ts`, `lite/app.ts`, `core/app.ts`: the apps (`setup(canvas, n)`, `frame(t)` answering a checksum). `entry.ts` beside each is the WasmGC build's entry, and `modules.ts` the library as the page's npm module.
- `build-js.mjs`: esbuild bundles, `out/<lib>.js` (the JavaScript lane) and `out/<lib>-modules.js` (the library for a WasmGC build that leaves it as JavaScript).
- `build-wasm.mjs <lib> [out.wasm] [--compile-packages <list> [--no-native-any]] [--dev]`: the WasmGC build, with the scriptw package's own options (`scriptw build --browser --release`). `--compile-packages @babylonjs/lite` compiles Babylon Lite into the module; with packages compiled in, the app's `any` values are compiled values, as the package's `--compile-packages` makes them; `--no-native-any` keeps them page values.
- `run.mjs`: the runner (`page/` is the page). `--count` counts host calls per frame instead of timing.

```console
$ (cd benchmarks/3d && npm install)
$ node benchmarks/3d/build-js.mjs
$ node benchmarks/3d/build-wasm.mjs three && node benchmarks/3d/build-wasm.mjs lite && node benchmarks/3d/build-wasm.mjs core
$ node benchmarks/3d/run.mjs --js three=benchmarks/3d/out/three.js --wasm three.wasm=benchmarks/3d/out/three.wasm --modules three.wasm=benchmarks/3d/out/three-modules.js
```

Babylon Lite compiled into the module:

```console
$ node benchmarks/3d/build-wasm.mjs lite benchmarks/3d/out/lite-in.wasm --compile-packages @babylonjs/lite
$ node benchmarks/3d/run.mjs --js lite=benchmarks/3d/out/lite.js --wasm lite.in=benchmarks/3d/out/lite-in.wasm
```

The results are in `RESULTS.md`.
