// Builds the React table app to WasmGC with this repository's compiler, against the TypeScript port of React
// (packages/react-ts) and with React DOM on the DOM stream (packages/react-ts/PATCHES.md).
//
//   node benchmarks/react-dom/build-wasm.mjs [out.wasm] [--dev]
//
// The module exports mount(id) and cycle(). BUILD_OPTIONS (JSON) adds compile options; SCRIPTC_WASMGC_NAMED=1 keeps function
// names for the profiler.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const argv = process.argv.slice(2);
const out = path.resolve(argv[0] && !argv[0].startsWith("--") ? argv[0] : path.join(here, "out", "app.wasm"));
const { compile } = await import(path.join(root, "packages/compiler/dist/index.js"));
const extra = process.env.BUILD_OPTIONS ? JSON.parse(process.env.BUILD_OPTIONS) : {};
const t0 = Date.now();
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = await compile(path.join(here, "wasm/entry.ts"), {
  experimentalDynI31: true, experimentalDynInlineSlots: 6, ...extra,
  outDir: path.dirname(out), outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", experimentalTsNativeAny: true,
  interfaceClassArms: true, conditions: ["wasmgc"], optimization: argv.includes("--dev") ? "dev" : undefined,
  wasmLink: { exports: ["mount", "cycle"] },
});
if (!r.ok) {
  for (const d of r.diagnostics) console.error(`${d.code ?? ""} ${d.message} ${d.loc ? `${d.loc.file}:${d.loc.line}` : ""}`);
  process.exit(1);
}
console.log(`ok ${path.relative(process.cwd(), out)} ${fs.statSync(out).size}B ${(Date.now() - t0) / 1000}s`);
