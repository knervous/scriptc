# Results

Three 3D libraries from npm, unmodified, driven by an app compiled with scriptw out of the box: three.js 0.187.0, Babylon Lite 1.42.0 (`@babylonjs/lite`) and Babylon.js 9.38.0 (`@babylonjs/core`). All three compile and run, with the library left as the page's npm JavaScript. None of them compiles into the module yet (below).

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

Babylon Lite and Babylon.js are the same with `@babylonjs/lite` or `@babylonjs/core` (both ship their own types). `--compile-packages three` (or `@babylonjs/lite`, `@babylonjs/core`) asks for the library to be compiled into the module instead; that does not build yet for any of the three.

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
- **Babylon Lite** (101 diagnostics). It gets furthest: every diagnostic is SC3002, "release build: this operation is not supported by the compiler yet and would fail at run time", a spread of constructs (`&` on untyped values, comparisons of untyped values, `then` handlers, `DataView` to untyped code, spread arguments, regular-expression and standard-library members). A dev build accepts those as fences that throw only if reached, and then stops in the backend: `dyn.classPrototype` (the prototype object of a class declared inside a function) has no WasmGC lowering yet.
- **Babylon.js** (154 diagnostics). 71 are fields first assigned outside a class constructor's top level (`this._scene`, `this._indexBuffer`, ...): the compiler lays out a JavaScript class from its constructor's unconditional assignments, and a field set first in a branch or a method has no slot. 78 more are the classes those refusals take with them, being extended. Two classes are used before their declaration runs, as in three.js.

The class-layout gap (fields assigned outside the constructor's top level) and the conservative module-order check are the two that block both three.js and Babylon.js; neither is a small fix.
