# Changelog

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
