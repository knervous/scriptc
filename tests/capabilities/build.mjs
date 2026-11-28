// Builds the capability probe modules into out/ (gitignored by the repository's `output/`-style rule: see README).
// usage: node tests/capabilities/build.mjs   (needs packages/compiler/dist: pnpm --filter @scriptc/compiler build)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.SCRIPTC_WASMOPT_TOOL ??= "js";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const { compile } = await import(path.join(root, "packages/compiler/dist/index.js"));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const fixtures = path.join(root, "tests/wasmgc-browser/fixtures");
const MODULES = [
  ["basics", path.join(here, "samples/basics.ts"), {}],
  ["strings", path.join(here, "samples/strings.ts"), { release: true }],
  ["byte-view", path.join(here, "samples/byte-view.ts"), { browser: true }],
  ["byte-view-fixed", path.join(here, "samples/byte-view.ts"), { browser: true, capabilities: "baseline,views=fixed:16" }],
  ["basics-legacy-eh", path.join(here, "samples/basics.ts"), { capabilities: "baseline,eh=legacy" }],
  ["simd", path.join(fixtures, "simd-relaxed-madd.ts"), { browser: true }],
  ["relaxed-simd", path.join(fixtures, "simd-relaxed-madd.ts"), { browser: true, experimentalRelaxedSimd: true }],
  ["atomics", path.join(fixtures, "r8-atomics.ts"), { browser: true }],
  ["generator", path.join(fixtures, "generator-basic.ts"), { browser: true }],
  ["async", path.join(fixtures, "async-switch-await.ts"), { browser: true }],
];
for (const [name, entry, options] of MODULES) {
  const outPath = path.join(out, `${name}.wasm`);
  const r = await compile(entry, { outDir: out, outPath, outputKind: "wasmgc", ...options });
  if (!r.ok) { console.error(name, r.diagnostics.map(d => d.message)); process.exitCode = 1; continue; }
  console.log(`${name}.wasm ${fs.statSync(outPath).size} B`);
}
