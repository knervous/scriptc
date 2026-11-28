// Builds a scene app to WasmGC with this repository's compiler and the scriptw package's own compile options
// (npm/wasmgc/lib/compile.mjs: what `scriptw build --browser --release` passes).
//
//   node benchmarks/3d/build-wasm.mjs <three|lite|core> [out.wasm] [--compile-packages <list>] [--dev]
//
// Without --compile-packages the library stays npm JavaScript, which the page hands to the loader (`modules`); with it,
// the named packages are compiled into the module. The module exports setup(id, n) and frame(t), and ready() where the
// library starts asynchronously.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const argv = process.argv.slice(2);
const lib = argv[0];
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const out = path.resolve(argv[1] && !argv[1].startsWith("--") ? argv[1] : path.join(here, "out", `${lib}.wasm`));
const compilePackages = flag("--compile-packages")?.split(",");
const { compile } = await import(path.join(root, "packages/compiler/dist/index.js"));
const t0 = Date.now();
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = await compile(path.join(here, lib, "entry.ts"), {
  outDir: path.dirname(out), outPath: out, outputKind: "wasmgc", release: !argv.includes("--dev"), browser: true, dynModel: "native", conditions: ["wasmgc"],
  capabilities: "auto", optimization: argv.includes("--dev") ? "dev" : undefined,
  ...(compilePackages ? { npmStatic: compilePackages } : {}),
  // (not a package option: the page calls these two)
  wasmLink: { exports: ["setup", "frame", ...(fs.readFileSync(path.join(here, lib, "entry.ts"), "utf8").includes("export function ready") ? ["ready"] : [])] },
});
if (!r.ok) {
  for (const d of r.diagnostics.slice(0, Number(process.env.SHOW ?? 30))) console.error(`${d.code ?? ""} ${d.message.slice(0, 300)} ${d.loc ? `${d.loc.file.replace(/.*node_modules\//, "")}:${d.loc.start}` : ""}`);
  console.error(`${r.diagnostics.length} diagnostics`);
  process.exit(1);
}
console.log(`ok ${path.relative(process.cwd(), out)} ${fs.statSync(out).size}B ${(Date.now() - t0) / 1000}s`);
