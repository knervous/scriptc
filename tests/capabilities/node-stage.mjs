// Runs one module under this Node with the package host and names the stage at which it fails.
// usage: node [v8 flags] tests/capabilities/node-stage.mjs <module.wasm> [native|polyfill|constants] [--time]
//   native     the package host as a program uses it (auto: engine strings where the engine has them, else its fallbacks)
//   polyfill   no engine string support: wasm:js-string from plain JS, module "'" from a Proxy answering each name
//   constants  engine builtins, the string constants as an ordinary import module (Node 22 has no importedStringConstants)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { instantiateLinked, linkedCompileOptions } = await import(path.join(root, "packages/compiler/dist/backend/wasmgc/host.js"));
const [file, mode = "native"] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const quiet = !process.argv.includes("--print");
globalThis.sink = (u8) => `len=${u8.length} first=${u8[0]}`;
const trap = (m) => { throw new WebAssembly.RuntimeError(m); };
const jsString = {
  cast: (s) => (typeof s === "string" ? s : trap("illegal cast")),
  test: (s) => (typeof s === "string" ? 1 : 0),
  length: (s) => s.length,
  charCodeAt: (s, i) => (i >>> 0 >= s.length ? trap("index out of bounds") : s.charCodeAt(i)),
  codePointAt: (s, i) => (i >>> 0 >= s.length ? trap("index out of bounds") : s.codePointAt(i)),
  concat: (a, b) => a + b,
  substring: (s, a, b) => { a >>>= 0; b >>>= 0; return a > s.length || a > b ? "" : s.substring(a, Math.min(b, s.length)); },
  equals: (a, b) => (a === b ? 1 : 0),
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  fromCharCode: (c) => String.fromCharCode(c),
  fromCodePoint: (c) => (c >>> 0 > 0x10ffff ? trap("invalid code point") : String.fromCodePoint(c)),
};
const constants = new Proxy({}, { get: (_, name) => name });
let stage = "compile";
const out = [];
try {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const t0 = performance.now();
  const module = await WebAssembly.compile(bytes, mode === "polyfill" ? {} : linkedCompileOptions(mode === "constants"));
  const imports = mode === "polyfill" ? { "wasm:js-string": jsString, "'": constants } : mode === "constants" ? { "'": constants } : {};
  stage = "instantiate";
  const capture = { log: (...a) => out.push(a.join(" ")), error: (...a) => out.push(a.join(" ")) };
  const linked = await instantiateLinked(module, { "": quiet ? capture : {} }, imports);
  const t1 = performance.now();
  stage = "run";
  await linked.modules[""].main();
  const fallbacks = linked.capabilities?.fallbacks ?? [];
  console.log(`ok ${process.version} ${mode}: compile+instantiate ${(t1 - t0).toFixed(1)} ms, run ${(performance.now() - t1).toFixed(0)} ms${fallbacks.length ? ` [fallbacks: ${fallbacks.join(", ")}]` : ""}${out.length ? ` | ${out.join(" | ").slice(0, 120)}` : ""}`);
} catch (e) {
  console.log(`FAIL at ${stage} ${process.version} ${mode}: ${e?.constructor?.name}: ${String(e?.message ?? e).slice(0, 160)}`);
}
