# Changelog

## Unreleased

- Intrinsic libraries, as subpath exports: `scriptw/int` (fixed-width integers and bit operations), `scriptw/math` (deterministic math), `scriptw/layout` (fixed-layout records in linear memory), `scriptw/f16` (binary16 storage), `scriptw/atomics` (typed atomic cells) and `scriptw/simd` (the SIMD library). Each runs as exact JavaScript uncompiled; compiled, its calls lower to instructions on WasmGC and natively. The compiler recognises a library by a pragma in its source, wherever it is installed.
- Contract types `Uint32`, `Int8`, `Uint8`, `Int16`, `Uint16`, `Int64` and `Uint64`, beside `Int32`, from `scriptw/int` or `@scriptc/types`. Every write to a contract slot is proven, or the build fails with SC7002 naming the write (SC7003 for one it cannot check); before this, contracts were not checked at all. 8- and 16-bit class fields are packed on WasmGC.
- `--capabilities math=fast|strict`. A program importing `scriptw/math` is strict. The capability record lists the intrinsic libraries a module uses, and `--explain-capabilities` prints a line for each.
- Native builds also use the `wasmgc` export condition, so a package's compiled source is the same for both targets.
- `--compile-packages <list>` (and `compilePackages` in `compile()`) compiles the named npm packages' JavaScript into the module instead of leaving it as npm JavaScript the page supplies.
- The README describes how a page hands the npm packages a page program imports to the loader (`modules`).
- A JavaScript function in a build without `--browser` no longer makes an invalid module when it never reads `this`.
- An object or array literal passed straight to a page function (`createElement(type, { className }, ...)`) is built as a plain page object in one host call, not as a compiled object the page reads through a proxy. A page program built against published React makes about a third of the host calls it did, and its table operations run 1.3–2.9 times faster (create1k 2.5).
- A compiled function called with a page value spread into its arguments (`createElement(type, props, ...children)` with React compiled in) builds instead of being refused.
- A page object handed to a typed function whose record parameter has a string field only ever set from literals no longer traps.
- `--compile-packages` follows a CommonJS entry that re-exports another file (`module.exports = require("./impl")`), and, with the compiler's `define`, one that picks its build from `process.env.NODE_ENV`.

## 0.1.0 (2026-11-28)

The first release.

- `scriptw build` compiles a TypeScript or JavaScript entry to a WasmGC module and its host sidecar; `scriptw run` compiles and runs one under Node, or runs a built module.
- `--browser` compiles a page program (DOM, timers and typed `host:` modules) for a web page to load. Its dynamic values use the native WasmGC object model; `compile()` takes `dynModel: "engine"` for the smallest module.
- `--conditions <list>` (and `conditions` in `compile()`) adds package export conditions. `wasmgc` is always on, so a package that ships TypeScript source under it, such as `@scriptw/lui`, is compiled into the module.
- `scriptw/host` exports `instantiateWasmGc`, the loader for a built module, in a web page or under Node.
- `scriptw` exports `compile`, the compiler as a function.
- The CLI checks for WasmGC and exnref exception handling at startup and names the Node.js releases that have them (24.15 or later, or a Node.js 22 with exnref on by default).
- `scriptw --version` prints the package version, the compiler version and the source commit.
- Capability modes. Every module records what it requires of an engine and the mode it was built under (`scriptc.capabilities`, and `<out>.wasm.capabilities.json`). `--capabilities`, `--targets` and `--explain-capabilities` choose and explain the mode; `auto` builds one compat variant (`<out>.compat.wasm`, listed in `<out>.wasm.variants.json`) only when a target needs it and the program uses the feature that differs.
- The loader supplies the JS String Builtins and imported string constants from plain JavaScript where the engine lacks them, so modules run on Node 22. The CLI no longer refuses Node 22 for them, and `engines` is now `>=22`.
- `views=fixed:<MiB>`: a fixed memory that never grows, so typed arrays handed to JavaScript need no `WebAssembly.Memory.prototype.toResizableBuffer`. Under Node 24 and 25, `scriptw run` reruns itself with `--experimental-wasm-rab-integration` when a module needs it. The refusal now names the right releases (Chrome 144, Firefox 145, Safari 26.2, Node 26).
- `eh=legacy` builds the legacy exception-handling encoding, for engines with WasmGC but not exnref.
- `createTaskRing` and `runTaskConsumer` in `scriptw/host`: a bounded task ring whose `threads: "auto"` mode uses a consumer Worker when the page can share memory and drains the same protocol on the owner's thread otherwise, with identical results and order.
- A program that suspends on host promises is a build error for a target without JSPI; `-jspi` refuses such a program outright.
- `scriptw/host` exports `loadWasmGc` (picks a variant by probe), `chooseVariant`, `detectCapabilities`, `requiredCapabilities`, `deploymentCapabilities` and `requireDeploymentCapabilities`. Instances report `capabilities` (required, provided, fallbacks), and `capabilities: "strict"` refuses fallbacks.
