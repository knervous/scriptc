# scriptw

Compile TypeScript and JavaScript to WasmGC modules, then run them under Node or load them in a web page. Nothing native to install: the compiler is JavaScript and wasm, and npm installs TypeScript 7's type checker for your platform.

scriptw is an independent fork of [scriptc](https://github.com/vercel-labs/scriptc) and is not affiliated with Vercel. Source and issues: [{{repository}}]({{repository}}).

## Requirements

Node.js 24 or later. The modules use WasmGC, exception handling and JS String Builtins (including imported string constants), which Node 22 lacks; on an older Node the CLI stops at startup and says so. A browser needs the same features; the package's tests load modules in headless Chromium.

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
- `scriptw build <entry.ts> [-o app.wasm]` writes `app.wasm` and its host sidecar `app.wasm.host.json`, the list of host imports the module uses.
- `scriptw run <module.wasm>` runs a built module.
- `--release` compiles a release build.
- `--browser` compiles a page program: the DOM, timers and typed `host:` modules are in scope. Load it in a page with `scriptw/host` (below).
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

`compile` resolves to `{ ok: true, wasmPath, hostSidecarPath }` or `{ ok: false, diagnostics }`, where each diagnostic has a `message` and, when known, a `code`, `file`, `line` and `hint`. It runs under Node only; type declarations ship for both entry points.

## Not yet published: the native target

`--target native` and `--target native:<platform>` build native executables. They need companion packages (`@scriptw/llvm-*`, `@scriptw/runtime-*`, `@scriptw/host-*`) that are not on npm yet, so a native build fails and names the package it is missing. Until they are published, a native build is for contributors building from source.

## License

Apache-2.0. See `LICENSE` and `NOTICE`; the bundled Binaryen and TypeScript carry their own Apache-2.0 licenses in their directories.
