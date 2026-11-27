// Whether this JavaScript engine runs the modules scriptw emits: WasmGC types and JS String Builtins, both the
// `wasm:js-string` functions and imported string constants (`importedStringConstants`). Node 24 has all of them;
// Node 22 has WasmGC and the functions but not the constants, so a module fails to instantiate on its first string
// constant import (module "'").

// A module with one struct type (WasmGC), an import of `wasm:js-string` `length`, and one string constant import.
const PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section: struct { mut i32 }, func (externref) -> i32
  0x01, 0x0a, 0x02, 0x5f, 0x01, 0x7f, 0x01, 0x60, 0x01, 0x6f, 0x01, 0x7f,
  // import section: "wasm:js-string" "length" (func type 1), and "'" "hi" (an immutable externref global)
  0x02, 0x21, 0x02,
  0x0e, ...new TextEncoder().encode("wasm:js-string"), 0x06, ...new TextEncoder().encode("length"), 0x00, 0x01,
  0x01, 0x27, 0x02, 0x68, 0x69, 0x03, 0x6f, 0x00,
]);

/** The features this engine lacks, by name; empty when it runs scriptw's modules. */
export function missingWasmFeatures() {
  const wasm = globalThis.WebAssembly;
  if (wasm === undefined) return ["WebAssembly"];
  let module;
  try {
    module = new wasm.Module(PROBE, { builtins: ["js-string"], importedStringConstants: "'" });
  } catch {
    return ["WasmGC"];
  }
  try {
    new wasm.Instance(module, {});
  } catch {
    return [wasm.Module.imports(module).length === 2 ? "JS String Builtins" : "imported string constants"];
  }
  return [];
}

/** A message naming what is missing and the Node release that has it, or null when this engine is new enough. */
export function unsupportedRuntimeMessage() {
  const missing = missingWasmFeatures();
  if (missing.length === 0) return null;
  const where = typeof process !== "undefined" && process.versions?.node ? `Node.js ${process.version}` : "this JavaScript engine";
  return `scriptw needs Node.js 24 or later: its modules use WasmGC and JS String Builtins, and ${where} lacks ${missing.join(" and ")}.`;
}
