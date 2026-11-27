# Changelog

## 0.1.0

The first release.

- `scriptw build` compiles a TypeScript or JavaScript entry to a WasmGC module and its host sidecar; `scriptw run` compiles and runs one under Node, or runs a built module.
- `--browser` compiles a page program (DOM, timers and typed `host:` modules) for a web page to load.
- `scriptw/host` exports `instantiateWasmGc`, the loader for a built module, in a web page or under Node.
- `scriptw` exports `compile`, the compiler as a function.
- The CLI checks for WasmGC and JS String Builtins at startup and names Node 24 when they are missing.
- `scriptw --version` prints the package version, the compiler version and the source commit.
