# Results

Three 3D libraries from npm, unmodified, driven by an app compiled with scriptw out of the box: three.js 0.187.0, Babylon Lite 1.42.0 (`@babylonjs/lite`) and Babylon.js 9.38.0 (`@babylonjs/core`). All three compile and run, with the library left as the page's npm JavaScript. Babylon Lite also compiles into the module and runs (below); three.js and Babylon.js do not yet.

Figures are from `receipts/scenes.json` (timings) and `receipts/scenes-counts.json` (host calls): 3 fresh pages per lane and mesh count, each with 30 untimed and 60 timed frames, the median over every timed frame. Every WasmGC lane's checksum (the draw calls or meshes plus a world-matrix element of the last mesh, after the last frame) matched its JavaScript lane's. Headless Chromium 158.0.8127.36 on a 4-core 2.30 GHz Xeon: three.js and Babylon.js on WebGL2 (ANGLE on SwiftShader's Vulkan device), Babylon Lite on WebGPU (SwiftShader's adapter, `--enable-unsafe-webgpu`; it has no WebGL path).

## What a user types

```console
$ npm install three @types/three
$ npx scriptw build app.ts --browser --release -o public/app.wasm
```

The library stays npm JavaScript, so the page loads it (with a bundler or an import map) and hands it to the loader, keyed by the specifier the app imports:

```js
import * as THREE from "three";
const program = await instantiateWasmGc(bytes, { modules: { three: THREE } });
```

Babylon Lite and Babylon.js are the same with `@babylonjs/lite` or `@babylonjs/core` (both ship their own types). `--compile-packages @babylonjs/lite` compiles the library into the module instead (no npm JavaScript and no `modules` on the page); `--compile-packages three` and `@babylonjs/core` do not build yet.

## Script time per frame

The JavaScript lane's median, and the WasmGC lane's ratio to it (lower is better, 1.00 is parity).

<table>
<thead><tr><th>Meshes</th><th>three.js js</th><th>three.js WasmGC</th><th>Babylon Lite js</th><th>Babylon Lite WasmGC</th><th>Babylon.js js</th><th>Babylon.js WasmGC</th></tr></thead>
<tbody>
<tr><td>1,000</td><td>0.870 ms</td><td>1.62</td><td>0.545 ms</td><td>1.73</td><td>0.710 ms</td><td>1.77</td></tr>
<tr><td>10,000</td><td>4.38 ms</td><td>2.15</td><td>4.47 ms</td><td>1.84</td><td>5.28 ms</td><td>2.83</td></tr>
</tbody>
</table>

## Host calls per frame

<table>
<thead><tr><th>Meshes</th><th>three.js</th><th>Babylon Lite</th><th>Babylon.js</th></tr></thead>
<tbody>
<tr><td>1,000</td><td>11,009</td><td>11,003</td><td>11,006</td></tr>
<tr><td>10,000</td><td>109,973</td><td>109,967</td><td>109,970</td></tr>
</tbody>
</table>

About eleven per mesh, the same for all three, and all of them the app's own animation loop: `mesh.rotation.x = …`, `mesh.rotation.y = …` and `mesh.position.z = …` are three reads and three writes of the library's objects (`js.get`, `js.set`) plus the numbers converted on the way (`js.fromNum`). The library's own work, matrices, culling and the draw, runs as the page's JavaScript and makes no host call. So the ratios above are what it costs a compiled app to drive a JavaScript library through its objects; the library itself runs at JavaScript's speed.

## Compiling the library into the module

`build-wasm.mjs <lib> --compile-packages <package>` (the compiler's npm-static mode). The first blockers for each:

- **three.js** (65 diagnostics). The root is SC1090 "uses of class X before its declaration runs" (11 classes: `Matrix4`, `Color`, `BufferAttribute`, `Box3`, `Sphere`, `Plane`, `Frustum`, ...). Every flagged use comes after the class's declaration in the file, inside a constructor or method body (a `Frustum`'s default parameters construct its `Plane`s, for example), but the compiler's module-order check is conservative: once top-level code names a class, all of its methods count as runnable from then on. A precise check would follow method calls (the constructor runs on `new`, a method when it is called). The refused classes then make 44 more diagnostics where they are extended or constructed. Six classes write their prototype in a static block (`static { this.prototype.isVector2 = true; }`), and three classes first assign a field outside the constructor's top level (`this.roughness`, `this.skeleton`, `this.resolvedProperty`).
- **Babylon Lite** builds and runs (the next section). It had 101 diagnostics, 99 of them in modules the app never asks for: its index imports every module and re-exports them from one `export { ... }`, which the side-effect-free pruning now treats as the re-exports it is, so 271 of its 1,317 files are compiled.
- **Babylon.js** (154 diagnostics). 71 are fields first assigned outside a class constructor's top level (`this._scene`, `this._indexBuffer`, ...): the compiler lays out a JavaScript class from its constructor's unconditional assignments, and a field set first in a branch or a method has no slot. 78 more are the classes those refusals take with them, being extended. Two classes are used before their declaration runs, as in three.js.

The class-layout gap (fields assigned outside the constructor's top level) and the conservative module-order check are the two that block both three.js and Babylon.js; neither is a small fix.

## Babylon Lite compiled into the module

```console
$ node benchmarks/3d/build-wasm.mjs lite benchmarks/3d/out/lite-in.wasm --compile-packages @babylonjs/lite
$ node benchmarks/3d/build-wasm.mjs lite benchmarks/3d/out/lite-in-page-any.wasm --compile-packages @babylonjs/lite --no-native-any
$ node benchmarks/3d/run.mjs --js lite=benchmarks/3d/out/lite.js --wasm lite.wasm=benchmarks/3d/out/lite.wasm --modules lite.wasm=benchmarks/3d/out/lite-modules.js --wasm lite.in=benchmarks/3d/out/lite-in.wasm --wasm lite.in-page-any=benchmarks/3d/out/lite-in-page-any.wasm --pages 3 --warmup 30 --frames 60 --receipt lite-compiled
$ node benchmarks/3d/run.mjs --count --wasm lite.wasm=benchmarks/3d/out/lite.wasm --modules lite.wasm=benchmarks/3d/out/lite-modules.js --wasm lite.in=benchmarks/3d/out/lite-in.wasm --wasm lite.in-page-any=benchmarks/3d/out/lite-in-page-any.wasm --receipt lite-compiled-counts
```

A release build (534 KB), with the package's options: `scriptw build app.ts --browser --release --compile-packages @babylonjs/lite`. Figures are from `receipts/lite-compiled.json` and `receipts/lite-compiled-counts.json`: 3 fresh pages per lane and mesh count, each with 30 untimed and 60 timed frames, the median over every timed frame; every lane's checksum matched JavaScript's. "Page JS" is the library left as the page's npm JavaScript. "Compiled in" is the library in the module, where the app's `any` values are compiled values (the package's default with `--compile-packages`); "page `any`" is the same with `--no-native-any`, the app's `any` values as page values.

<table>
<thead><tr><th>Meshes</th><th>js</th><th>page JS</th><th>compiled in</th><th>compiled in, page <code>any</code></th></tr></thead>
<tbody>
<tr><td>1,000</td><td>0.490 ms</td><td>1.89</td><td>3.66</td><td>5.15</td></tr>
<tr><td>10,000</td><td>4.53 ms</td><td>2.03</td><td>2.99</td><td>7.92</td></tr>
</tbody>
</table>

Host calls per frame:

<table>
<thead><tr><th>Meshes</th><th>page JS</th><th>compiled in</th><th>compiled in, page <code>any</code></th></tr></thead>
<tbody>
<tr><td>1,000</td><td>11,003</td><td>3,076</td><td>19,069</td></tr>
<tr><td>10,000</td><td>109,967</td><td>30,076</td><td>189,961</td></tr>
</tbody>
</table>

The library's own rendering is not where the time goes: in a CPU profile of the compiled-in lane at 10,000 meshes, `renderFrame` (world matrices, culling, uniform writes and the draw) is 1.5% of the frame. Nearly all the rest is the app's per-mesh transform writes (`mesh.rotation.x = …`, three per mesh) running through the setters of Babylon Lite, and compiled in is slower than JavaScript there for three reasons:

- The dynamic object model. A mesh's `rotation` is an object of getters and setters over closures, and a mesh has getters and a non-enumerable property; any of these puts a compiled object in a dictionary shape, which property caches skip, so each write takes the uncached store, the accessor call, and a dynamic call of the quaternion's `set`. These are most of the profile.
- Every `for (const x of array)` and array destructuring (`const [a, b, c, d] = eulerXYZToQuatTuple(…)`) first asks the page whether array iteration is still the engine's own (`js.arrayIterPristine`): the 3,010 host calls per 1,000 meshes above, about 10% of the frame.
- `Math.sin` and `Math.cos` run as compiled fdlibm rather than the engine's builtins, about 7%.

With `--no-native-any` the app's loop also crosses the page for every write: the app types its meshes with the package's `Mesh`, which comes from the shipped declarations, while a compiled-in package is typed from its JavaScript, where that name is `any`; as a page value each `mesh.rotation.x = …` is a page write of a compiled object, reached through a facade (19 host calls per mesh).
