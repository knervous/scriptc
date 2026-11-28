// Which wasm features a module needs: the vendored wasm-opt 133 (the build's own optimizer) re-reads and validates it
// with each feature of the backend's set removed; a feature whose removal fails validation is used.
// usage: node tests/capabilities/features.mjs <a.wasm> [...]   (one JSON line per module)
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { WASMGC_FEATURE_FLAGS: ALL, VENDORED_WASM_OPT } = await import(path.join(root, "packages/compiler/dist/backend/wasmgc/emitter.js"));
const optional = ALL.filter(f => f !== "--mvp-features" && f !== "--enable-gc" && f !== "--enable-reference-types");
const valid = async (file, flags) => { try { await run(process.execPath, [VENDORED_WASM_OPT, file, ...flags, "-o", "/dev/null"], { maxBuffer: 1 << 26 }); return true; } catch { return false; } };
for (const file of process.argv.slice(2)) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const imports = {};
  for (const i of WebAssembly.Module.imports(new WebAssembly.Module(bytes))) imports[i.module] = (imports[i.module] ?? 0) + 1;
  if (!(await valid(file, ALL))) { console.log(JSON.stringify({ file: path.basename(file), error: "invalid under the backend's feature set" })); continue; }
  const removed = await Promise.all(optional.map(async f => [f, await valid(file, ALL.filter(x => x !== f))]));
  const needs = ["gc", "reference-types", ...removed.filter(([, ok]) => !ok).map(([f]) => f.replace("--enable-", ""))];
  console.log(JSON.stringify({ file: path.basename(file), size: bytes.length, imports, needs }));
}
