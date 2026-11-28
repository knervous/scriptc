// Whether this JavaScript engine runs the modules scriptw emits. The hard requirements are WasmGC and exception
// handling (the exnref encoding by default; a module built with `--capabilities eh=legacy` uses the older one). The
// JS String Builtins and imported string constants are soft: the loader supplies them from plain JavaScript when the
// engine lacks them (Node 22 has the builtins but not the constants), and lists the fallback on the instance.
import { detectCapabilities } from "../packages/compiler/dist/backend/wasmgc/capabilities.js";

/** The hard requirements this engine lacks for a module built with the default capabilities, by name; empty when it
 * runs them. */
export function missingWasmFeatures() {
  if (globalThis.WebAssembly === undefined) return ["WebAssembly"];
  const caps = detectCapabilities();
  const missing = [];
  if (!caps["wasm-gc"]) missing.push("WasmGC");
  if (!caps["exnref"]) missing.push("exception handling with exnref");
  return missing;
}

/** The plain-JavaScript fallbacks the loader takes on this engine (`strings:constants`, `strings:polyfill`). */
export function wasmFallbacks() {
  if (globalThis.WebAssembly === undefined) return [];
  const caps = detectCapabilities();
  return [
    ...(caps["imported-string-constants"] ? [] : ["strings:constants"]),
    ...(caps["js-string-builtins"] ? [] : ["strings:polyfill"]),
  ];
}

/** A message naming what is missing and the Node release that has it, or null when this engine is new enough. */
export function unsupportedRuntimeMessage() {
  const missing = missingWasmFeatures();
  if (missing.length === 0) return null;
  const where = typeof process !== "undefined" && process.versions?.node ? `Node.js ${process.version}` : "this JavaScript engine";
  return `scriptw needs Node.js 24.15 or later (or a Node.js 22 release with exnref on by default): its modules use WasmGC and exception handling, and ${where} lacks ${missing.join(" and ")}.`;
}
