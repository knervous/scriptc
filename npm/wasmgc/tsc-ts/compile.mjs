#!/usr/bin/env node
// Experimental: compiles a prepared tsc-ts checkout (prepare.mjs) to WasmGC with this repository's built compiler,
// and reports the diagnostics by kind when the compile refuses.
//
//   node --max-old-space-size=14000 npm/wasmgc/tsc-ts/compile.mjs <tsc-ts checkout> <out.wasm>
//
// The checkout needs its own dependencies for their types (`npm ci --ignore-scripts --omit=optional` in it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { compile } = await import(path.resolve(here, "../../../packages/compiler/dist/index.js"));
const [checkout, out] = process.argv.slice(2).map((a) => a && path.resolve(a));
if (!checkout || !out) { console.error("usage: compile.mjs <tsc-ts checkout> <out.wasm>"); process.exit(2); }
const entry = path.join(checkout, "packages/tsc-ts/src/wasm-api.ts");
if (!fs.existsSync(entry)) { console.error(`compile: ${entry} is missing; run prepare.mjs first`); process.exit(2); }

fs.mkdirSync(path.dirname(out), { recursive: true });
const t = performance.now();
const r = await compile(entry, { outDir: path.dirname(out), outPath: out, outputKind: "wasmgc", interfaceClassArms: true });
const seconds = Math.round((performance.now() - t) / 1000);
if (r.ok) {
  console.log(`compile: ${out}, ${fs.statSync(out).size} bytes, in ${seconds} s`);
  process.exit(0);
}
console.log(`compile: refused in ${seconds} s, ${r.diagnostics.length} diagnostics`);
const kinds = new Map();
for (const d of r.diagnostics) {
  const kind = d.message.replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"').slice(0, 120);
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
}
for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), kind);
for (const d of r.diagnostics.slice(0, 20)) {
  const file = d.loc?.file ? path.relative(checkout, d.loc.file) : "";
  console.log(`  ${file}: ${d.message.slice(0, 200)}`);
}
process.exit(1);
