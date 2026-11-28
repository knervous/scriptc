# scriptc, with WasmGC and a native host

This is an independent fork of [scriptc](https://github.com/vercel-labs/scriptc), the TypeScript-to-native compiler. It is not affiliated with or endorsed by Vercel. It adds two things to upstream's compiler: a WasmGC target, and a native lane whose page APIs are answered by a host library instead of an embedded JavaScript engine, with a Rust implementation of that host.

The fork is experimental, like upstream. Upstream's documentation at [scriptc.dev](https://scriptc.dev) and its `scriptc` npm package describe upstream's compiler, not these additions.

## WasmGC target

The WasmGC backend (`packages/compiler/src/backend/wasmgc`) compiles TypeScript to WebAssembly modules that use the engine's garbage collector, exception handling and JS String Builtins. It targets browsers and Node.js 24 or later. Upstream's WebAssembly target builds WASI modules instead.

A build writes the module and a host sidecar, `<out>.host.json`, which lists the imports the module needs from its embedder.

The `scriptw` package (`npm/wasmgc`) is the WasmGC compiler as JavaScript and wasm, with no native toolchain to install:

```console
$ scriptw build app.ts --target wasmgc
$ scriptw run app.ts
```

It is not published to npm. Build it from a checkout as described in [`npm/wasmgc/README.md`](./npm/wasmgc/README.md).

## Typed host modules

A program can declare the functions its embedder supplies as a module with a host scheme:

```ts
declare module "host:gpu" {
  export function submit(queue: number, commands: Uint8Array): void;
}
```

```ts
import { submit } from "host:gpu";
```

Each exported function becomes a direct, typed call: a wasm import on the WasmGC target, and one call through the host island on the native lane. Parameters are numbers, booleans, strings, page objects or `Uint8Array`. A result can also be `void`, or a `Promise` of one of those types.

On the WasmGC target a parameter can also be a callback whose parameters are numbers, booleans, strings or page objects and whose result is one of those or `void`. The host receives a plain function that calls the compiled function through an exported trampoline, one per signature, with no dynamic values on the way. The same compiled function is always the same host function.

A module whose types the ABI cannot express falls back to the untyped page-module path. The `strictHostModules` option makes that a compile-time error instead.

## Native host island

On the native (LLVM) lane, a program's page operations can be answered by the application that embeds it, with no JavaScript engine linked. Page operations include the document, timers, the console, fetch and the GPU.

The host island ABI is in `packages/runtime/src/scr_host_island.h`. The host supplies one vtable, `scr_host_ops()`:
- Primitives cross by value, and strings as borrowed UTF-8.
- Host objects are reference-counted handles.
- Compiled functions are closure handles the host calls back.
- A host error becomes a catchable `TypeError` in the program.

A native page program (`browser: true` on the LLVM lane, or `scriptw build --target native --browser`) links the host island in place of the QuickJS island, plus one archive that defines `scr_host_ops()`:
- **Default:** the target's host pack, `@scriptw/host-<platform>`, or the directory in `SCRIPTW_HOST_PACK`. The pack is checked against the runtime pack's host ABI and its archive hash before the link.
- **`host: "headless"`:** the same pack's archive without the window, GPU, audio and RTC services.
- **`hostLib` (`--host-lib`, `SCRIPTC_HOST_LIB`):** an embedder's own archive.
- **`host: "quickjs"`:** the QuickJS island, as before.

A program that uses no page APIs links no host. `SCR_HOST_ABI` is recorded append-only in `scr_host_abi.history.json`, and a test fails when the header and the history drift.

On Android (`--target native:android-arm64`), the program links as `libmain.so`, a shared library whose exported `main` an Activity calls. The link uses the NDK's own clang, which the user installs.

## Rust host

The default host is in `native/host/`, a Rust workspace under Apache-2.0:
- **`scriptc-host-core`** is the host. It covers the vtable, values and handles, the event loop and timers, streams, channels, workers, abort and observers, and `Intl`. It also covers the DOM and layout (on Blitz and Stylo), networking, storage (localStorage and OPFS), the clipboard, Web Audio on Windows, and WebRTC (the `webrtc` feature).
- **Window shells** exist for macOS, Windows and Android, painting with vello on wgpu. On Linux the host runs without a window.
- **`scriptc-host`** is the default build. `cargo build --release -p scriptc-host` produces `libscriptc_host.a`, which defines `scr_host_ops()`.
- **`gpu-stream-format` and `gpu-stream-wgpu`** are a WebGPU command stream and its executor on wgpu.
- **`blitz-ui`, `matoya-sys`, `audio-engine` and `audio-decode`** are the window, Android and audio layers the host uses.

An embedder customises the host without forking it:
- It implements the `Layer` trait: its own `host:` modules and globals, the page's files, the scene, lifecycle hooks and network rules.
- It sets a `Config`: the app name, environment prefix, window title and user agent.
- It names its layer once with `export_host!`.

Today the services are modules of one crate. Two things come next: splitting them into crates behind cargo features, so an embedder can drop or replace each one, and a headless build.

No host pack is published yet. Build the archive and pass it with `--host-lib`, or point `SCRIPTW_HOST_PACK` at a pack directory.

The vendored code in `native/host/vendor` keeps its upstream licences, and each folder keeps its licence files:
- Blitz, vello and anyrender: MIT or Apache-2.0.
- Stylo: MPL-2.0. Its `PROVENANCE.md` lists the files the fork changes.
- libmatoya: MIT.
- libopus: BSD-3-Clause.

## Other changes

- **Strict TypeScript.** The strict compiler options the lowering depends on are always on. A tsconfig that turns one off fails with `SC0002`. The `strictFrontend` option adds `noImplicitAny` and refuses implicit-`any` code in the frontend.
- **An object linker** (`packages/compiler/src/link`).
- **Changes to the LLVM lane and the runtime.**

[`MODIFICATIONS.md`](./MODIFICATIONS.md) lists every file changed from or added to upstream, and the upstream commit this fork is compared with.

## License

Apache-2.0, like upstream, except the vendored code in `native/host/vendor`, which keeps its own licences (see [Rust host](#rust-host)). See [`LICENSE`](./LICENSE), [`NOTICE`](./NOTICE) and [`MODIFICATIONS.md`](./MODIFICATIONS.md).

## Upstream scriptc

The rest of this README is upstream's. Its install commands and links point to upstream's releases and documentation, which do not include this fork's additions.

scriptc compiles TypeScript and JavaScript to native executables and WebAssembly. It uses TypeScript's type information to compile supported code to native instructions. Static builds run without Node.js or a JavaScript engine.

For npm dependencies and `any`-typed code, enable `--dynamic` to include the embedded [quickjs-ng](https://github.com/quickjs-ng/quickjs) engine. Dependency JavaScript is included at build time.

scriptc is experimental and supports a subset of JavaScript, TypeScript, and Node.js APIs. See the [limitations](https://scriptc.dev/docs/limitations) and [Node.js compatibility reference](https://scriptc.dev/compatibility) before using it for an existing project.

### Installation

Install with Node.js 24 or later and npm:

```console
$ npm install -g scriptc
```

The installed compiler runs natively on supported macOS, Linux, and Windows hosts. Native compilation and execution do not require Node.js. Standalone compiler archives are also available from [GitHub Releases](https://github.com/vercel-labs/scriptc/releases).

Executable builds require a platform linker and SDK/sysroot. See the [quickstart](https://scriptc.dev/docs/quickstart) for prerequisites and [platform support](https://scriptc.dev/docs/platforms) for host requirements, cross-compilation, and WebAssembly.

### Build a program

Create `hello.ts`:

```ts
const who = process.argv.length > 2 ? process.argv[2] : "world";
console.log(`hello, ${who}`);
```

Compile and run it in one step:

```console
$ scriptc run hello.ts
hello, world
```

Or write a standalone executable:

```console
$ scriptc build hello.ts -o hello
$ ./hello scriptc
hello, scriptc
```

These examples use POSIX shell syntax. On Windows, build `hello.exe` and run it with `.\hello.exe`.

Use `scriptc coverage hello.ts` to check which operations compile statically, require dynamic execution, or are unsupported. See [coverage reports](https://scriptc.dev/docs/coverage) for details.

### Use Node APIs

Supported Node APIs compile to the native runtime. For example, `server.ts`:

```ts
import { createServer } from "node:http";

const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ path: req.url }));
});

server.listen(8080, () => {
  console.log("listening on http://localhost:8080");
});
```

```console
$ scriptc build server.ts -o server
$ ./server
listening on http://localhost:8080
```

### Use npm packages

Pass `--dynamic` to embed an npm package's JavaScript in the executable. The result does not read `node_modules` at runtime.

Create `cli.ts`:

```ts
import pc from "picocolors";

console.log(pc.green("hello from scriptc"));
```

```console
$ npm install picocolors
$ scriptc build cli.ts --dynamic -o cli
$ ./cli
hello from scriptc
```

Enabling `--dynamic` does not add support for unsupported statically typed calls. See [npm dependencies](https://scriptc.dev/docs/dependencies) for package resolution and the boundary between static and dynamic code.

### Documentation

- [Quickstart](https://scriptc.dev/docs/quickstart): installation and your first executable.
- [CLI reference](https://scriptc.dev/docs/cli): commands, options, and output formats.
- [Native program objects](https://scriptc.dev/docs/native-objects): use compiler output in external builds.
- [Native FFI](https://scriptc.dev/docs/ffi): call C ABI functions from compiled programs.
- [WebAssembly modules](https://scriptc.dev/docs/wasm): build and embed WASI modules.
- [Examples](./examples): programs and integration examples in this repository.

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for source setup, testing, native artifact builds, and docs development.
