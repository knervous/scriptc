# scriptw

Compile TypeScript and JavaScript to WasmGC modules, then run them under Node or load them in a web page. Nothing native to install: the compiler is JavaScript and wasm, and npm installs TypeScript 7's type checker for your platform.

scriptw is an independent fork of [scriptc](https://github.com/vercel-labs/scriptc) and is not affiliated with Vercel. Source and issues: [{{repository}}]({{repository}}).

## Requirements

Node.js 24.15 or later, or a Node.js 22 release whose V8 has exnref exception handling on by default (22.23.5 was checked). The modules use WasmGC and exception handling; on an engine without them the CLI stops at startup and says so. They also use the JS String Builtins and imported string constants: where the engine lacks them (Node 22 has no imported string constants), the loader supplies them from plain JavaScript, with no measured cost.

A browser needs WasmGC and exnref exception handling: Chrome 137, Firefox 131, Safari 18.4. The string fallbacks should also cover Firefox 131 to 133 and Safari 18.4 to 26.1, which have no string builtins; only Chromium and Node are tested, by loading modules in headless Chromium.

A program that hands typed arrays to JavaScript also needs `WebAssembly.Memory.prototype.toResizableBuffer` (Chrome 144, Firefox 145, Safari 26.2, Node 26), so that the views it hands out survive memory growth. `scriptw run` reruns itself under Node 24 and 25 with `--experimental-wasm-rab-integration`, and `scriptw build` adds a compat variant with a fixed memory for older engines (see [Capabilities](#capabilities)).

## Install

```console
$ npm install --save-dev scriptw
```

Or run it once with `npx scriptw`.

## The command line

```console
$ npx scriptw run app.ts
$ npx scriptw build app.ts
$ npx scriptw run app.wasm
```

- `scriptw run <entry.ts>` compiles to a temporary directory and runs the module in the same Node process. Output, errors and the exit status follow Node's: an uncaught error prints its text and exits with status 1.
- `scriptw build <entry.ts> [-o app.wasm]` writes `app.wasm`, its host sidecar `app.wasm.host.json` (the list of host imports the module uses) and `app.wasm.capabilities.json` (what the module requires of an engine). When a target needs one, it also writes a compat variant, `app.compat.wasm`, and the variant set `app.wasm.variants.json`.
- `scriptw run <module.wasm>` runs a built module, or the first variant of its set that this Node runs.
- `--release` compiles a release build.
- `--capabilities <list>`, `--targets <list>` and `--explain-capabilities` choose and explain the capability modes (see [Capabilities](#capabilities)).
- `--browser` compiles a page program: the DOM, timers and typed `host:` modules are in scope. Load it in a page with `scriptw/host` (below). Its dynamic values use the native WasmGC object model, which UI libraries and frameworks need.
- `--conditions <list>` adds package export conditions, such as `dom-stream`. The `wasmgc` condition is always on: a package that maps it to TypeScript source (`"wasmgc": "./src/index.ts"`, as `@scriptw/lui` does) is compiled into the module from that source.
- `scriptw --version` prints the package version, the compiler version and the source commit.

## Running a module in a web page

`scriptw/host` exports `instantiateWasmGc`, the loader. It has no Node-only dependencies, so a bundler can take it as is, or a page can map it with an import map:

```console
$ npx scriptw build page.ts --browser -o public/page.wasm
```

```ts:page.ts
const list = document.createElement("ul");
for (const name of ["parse", "check", "emit"]) {
  const item = document.createElement("li");
  item.textContent = name;
  list.appendChild(item);
}
document.body.appendChild(list);
```

```html:public/index.html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <script type="importmap">
      { "imports": { "scriptw/host": "/node_modules/scriptw/lib/host.mjs" } }
    </script>
  </head>
  <body>
    <script type="module">
      import { instantiateWasmGc } from "scriptw/host";

      const bytes = new Uint8Array(await (await fetch("/page.wasm")).arrayBuffer());
      const program = await instantiateWasmGc(bytes);
      await program.main();
    </script>
  </body>
</html>
```

Serve the directory over HTTP (a module script does not load from `file://`), with `node_modules/scriptw` reachable at the path the import map names. A page program writes to the page's own `console`.

### Typed host modules

A page program can import functions the page supplies. Declare the module in a `.d.ts` with a `host:` specifier:

```ts:clock.d.ts
declare module "host:clock" {
  export function now(): number;
  export function wait(ms: number): Promise<string>;
}
```

```ts:page.ts
/// <reference path="./clock.d.ts" />
import { now, wait } from "host:clock";

console.log("now", now(), await wait(5));
```

The page passes the implementation to the loader, by specifier:

```js
const program = await instantiateWasmGc(bytes, {
  modules: {
    "host:clock": {
      now: () => Date.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(() => resolve(`after ${ms} ms`), ms)),
    },
  },
});
await program.main();
```

Parameters and results are numbers, booleans, strings, objects passed by reference, `Uint8Array` results, and promises of those. `host:` imports need `--browser`.

The loader works the same under Node, so the module above runs there too when Node supplies `host:clock`.

## The compiler as a function

```js
import { compile, formatDiagnostic } from "scriptw";

const result = await compile("src/app.ts", { outPath: "dist/app.wasm", browser: false, release: true });
if (!result.ok) for (const d of result.diagnostics) console.error(formatDiagnostic(d));
```

`compile` takes `capabilities`, `targets` and `conditions` as the CLI does, and `dynModel: "engine"` with `browser` for the smallest page module (dynamic values as engine values behind host calls; UI libraries need the default, `"native"`). It resolves to `{ ok: true, wasmPath, hostSidecarPath, capabilitiesPath, capabilities, variants, variantsPath?, explainCapabilities }` or `{ ok: false, diagnostics }`, where each diagnostic has a `message` and, when known, a `code`, `file`, `line` and `hint`. It runs under Node only; type declarations ship for both entry points.

## Capabilities

Every module needs WasmGC and exception handling. What else it needs depends on the program and on the capability mode it was built under. The module records both in a `scriptc.capabilities` custom section, which the loader reads before instantiating; `app.wasm.capabilities.json` carries the same record. The mode's canonical key, such as `wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off`, is the only form that names a build.

`--capabilities` takes a preset and/or a list:

- `auto` (the default): the baseline, plus at most one compat variant, built only when a target in `--targets` needs it and the program uses the feature that differs.
- `baseline`: the baseline only. `compat`: the compat mode only.
- `eh=exnref|legacy`: the exception-handling encoding. `legacy` reaches engines with WasmGC but not exnref (Chrome 119 to 136, Firefox 120 to 130, Safari 18.2 and 18.3); `auto` uses it only for such a target.
- `views=resizable|fixed[:<MiB>]`: how typed arrays handed to JavaScript survive memory growth. `fixed` declares the memory at its maximum (default 256 MiB) so it never grows and views never detach; an allocation past it traps. Only touched pages cost memory.
- `relaxed-simd` (off by default): the SIMD library's relaxed multiply-adds. Results may differ in the low bits; Safari rejects the module, and `auto` builds a variant without it for such a target.
- `threads=off|shared|auto`: `shared` needs a shared memory, which a page has only when cross-origin isolated.
- `-jspi`: refuse a program that suspends on host promises. Such a program needs JSPI, and a target without it is a build error.

`--targets` lists the engines to support, by default `chrome>=137,firefox>=134,safari>=26.2,node>=24.15`. `--explain-capabilities` prints what was chosen and why.

The loader adapts at load time where it can, and reports it: an instance's `capabilities` holds what the module required, what the engine offered (by probes a few dozen bytes long) and the `fallbacks` it took, such as `strings:constants`. `capabilities: "strict"` refuses instead of falling back. A refusal names what is missing and the first releases that have it.

```js
import { loadWasmGc, detectCapabilities } from "scriptw/host";

console.log(detectCapabilities());
// Picks the first variant this engine runs, and downloads only that one.
const program = await loadWasmGc("/app.wasm.variants.json");
console.log(program.variant, program.capabilities.fallbacks);
await program.main();
```

### Threads

Threads are opt-in. Nothing a default build emits uses them, and a page shares memory only when it is cross-origin isolated (served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), which is the page's decision.

`createTaskRing` from `scriptw/host` is a bounded task queue with the threads mode chosen at load:
- `threads: "auto"` (the default) gives a consumer Worker when the engine and page can share memory and `startConsumer` is given;
- otherwise the same protocol is drained on the owner's thread, between tasks.

Both modes give the same task ids, statuses, results, refusals and completion order; only timing differs.

```js
import { createTaskRing } from "scriptw/host";

const ring = createTaskRing({
  run: (entry, payload, length) => ({ status: 0, result: payload.subarray(0, length).reduce((a, b) => a + b, 0) }),
  startConsumer: (buffer, byteOffset, layout) => {
    // The worker imports runTaskConsumer from scriptw/host and calls runTaskConsumer(buffer, byteOffset, layout, run).
    new Worker(new URL("./consumer.js", import.meta.url), { type: "module" }).postMessage({ buffer, byteOffset, layout });
  },
});
const slot = ring.claim();
ring.payload(slot).set([1, 2, 3]);
ring.publish(slot, 1, 3, 1);
const seen = ring.completed();
await ring.waitForCompletion(seen);
ring.reap((id, status, result) => console.log(ring.threads, id, status, result));
```

## Choosing a UI framework

The same table program (js-framework-benchmark's operations) was measured on four UI frameworks, each as JavaScript and compiled with scriptw. The table shows each compiled lane's median script time as a ratio to its own framework's JavaScript build; 1.00 is parity, lower is better. "stream" is the framework's DOM on the batched DOM bridge (`packages/dom-stream` in the repository); "per-call" makes one host call per DOM operation. Measured in headless Chromium 158.0.8127.36 on a 4-core 2.30 GHz Xeon, with React 19.2.8 (TypeScript port), SolidJS 1.9.20, Svelte 5.59.2 and LUI 0.1.0.

| Framework | Lane | create 1k | replace 1k | update 10th | select | swap | remove | append 1k | clear |
|---|---|---|---|---|---|---|---|---|---|
| SolidJS | stream | 1.79 | 1.58 | 1.28 | 0.96 | 0.97 | 1.02 | 1.91 | 1.06 |
| SolidJS | per-call, published | 1.72 | 1.40 | 1.99 | 4.25 | 2.09 | 2.17 | 1.79 | 1.16 |
| LUI | stream | 1.66 | 1.53 | 1.13 | 1.19 | 1.04 | 1.28 | 1.59 | 1.75 |
| LUI | per-call | 1.54 | 1.28 | 1.19 | 1.20 | 1.04 | 1.26 | 1.59 | 1.08 |
| React | stream | 2.32 | 1.45 | 2.02 | 2.52 | 1.09 | 2.95 | 2.24 | 1.23 |
| Svelte 5 | per-call, published | 2.48 | 2.55 | 2.46 | 8.60 | 3.05 | 2.66 | 2.94 | 1.78 |

- **SolidJS** fits best: fine-grained updates, templates the bridge clones in one command, and a runtime small enough to type. It is also the fastest in absolute terms, as JavaScript and compiled.
- **LUI** (`@scriptw/lui` on npm) is written for this compiler and needs no port; its compiled ratios are close to Solid's. `scriptw build --browser` compiles it from the installed package, and `--conditions dom-stream` puts it on the DOM stream.
- **React** runs from a strict TypeScript port of its client packages (`packages/react-ts`).
- **Svelte 5** compiles from its published runtime, untyped, so it pays dynamic dispatch throughout.

The full results (every lane, host calls per operation, where the time goes, and what was tried) are in `benchmarks/frameworks/RESULTS.md` in the repository. The harness is `benchmarks/frameworks` (with React's in `benchmarks/react-dom`), and `node benchmarks/frameworks/run.mjs` reproduces it.

## Not yet published: the native target

`--target native` and `--target native:<platform>` build native executables. They need companion packages (`@scriptw/llvm-*`, `@scriptw/runtime-*`, `@scriptw/host-*`) that are not on npm yet, so a native build fails and names the package it is missing. Until they are published, a native build is for contributors building from source.

## License

Apache-2.0. See `LICENSE` and `NOTICE`; the bundled Binaryen and TypeScript carry their own Apache-2.0 licenses in their directories.
