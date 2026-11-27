// Separate compilation proof (docs-draft/OBJECT_FILES_POC.md): compile each module of a slice to its own object, link
// the objects into one module, and require that it prints exactly what the whole-program build of the same sources
// prints, both run by the browser lane's runner (tests/wasmgc-browser/run-wasm.mjs with prelude.mjs).
//
//   node build.mjs <slice dir> <module.ts ...>      e.g. node build.mjs three geom.ts square.ts app.ts
//
// The gate's lanes: OBJECTS_LANE=native (default), engine, or native-any. OBJECTS_DEV=1 builds unoptimised (dev).
//
// Prints sizes and times as JSON. Output lands in wgc-scratch/objects/<slice>/ under the checkout root.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, "../..");
const dist = path.join(checkout, "packages/compiler/dist");
const { compile } = await import(path.join(dist, "index.js"));
const { compileObject, readObject } = await import(path.join(dist, "link/object.js"));
const { linkWasmGc } = await import(path.join(dist, "link/link.js"));

const [slice, ...modules] = process.argv.slice(2);
if (!slice || modules.length === 0) throw new Error("usage: node build.mjs <slice dir> <module.ts ...> (the entry last)");
const src = path.resolve(here, slice);
const out = path.join(checkout, "wgc-scratch/objects", path.basename(src), process.env.OBJECTS_LANE ?? "native");
fs.mkdirSync(out, { recursive: true });
const level = process.env.OBJECTS_DEV === "1" ? 0 : 2;
const lane = process.env.OBJECTS_LANE ?? "native";
if (!["native", "engine", "native-any"].includes(lane)) throw new Error(`OBJECTS_LANE: ${lane}`);
const target = { browser: true, dynModel: lane === "engine" ? "engine" : "native", experimentalTsNativeAny: lane === "native-any" };
const ms = (t) => Math.round(performance.now() - t);

const run = (wasm) => execFileSync(process.execPath, ["--import", path.join(checkout, "tests/wasmgc-browser/prelude.mjs"), path.join(checkout, "tests/wasmgc-browser/run-wasm.mjs"), wasm], { encoding: "utf8" });

// The whole program, exactly as the gate's native lane compiles it.
const entry = path.join(src, modules.at(-1));
let t = performance.now();
const whole = path.join(out, "whole.wasm");
const r = await compile(entry, { outDir: out, outPath: whole, outputKind: "wasmgc", ...target, ...(level ? {} : { optimization: "dev" }) });
if (!r.ok) throw new Error(JSON.stringify(r.diagnostics).slice(0, 2000));
const wholeMs = ms(t);

// One object per module, each compiled on its own.
const objects = [];
for (const m of modules) {
  t = performance.now();
  const p = path.join(out, m.replace(/\.ts$/, ".wobj"));
  await compileObject(path.join(src, m), { root: src, outPath: p, programRoot: entry, ...target });
  objects.push({ module: m, path: p, ms: ms(t), bytes: fs.statSync(p).size });
}
t = performance.now();
const loaded = await Promise.all(objects.map((o) => readObject(o.path)));
const readMs = ms(t);
const linked = linkWasmGc(loaded, { optimizeLevel: level, entry: modules.at(-1) });
const linkedPath = path.join(out, "linked.wasm");
fs.writeFileSync(linkedPath, linked.binary);

const wholeOut = run(whole), linkedOut = run(linkedPath);
const report = {
  slice: path.basename(src), lane, level,
  whole: { bytes: fs.statSync(whole).size, ms: wholeMs },
  objects: objects.map(({ module, bytes, ms }) => ({ module, bytes, ms })),
  link: { bytes: linked.binary.length, readMs, ...Object.fromEntries(Object.entries(linked.timings).map(([k, v]) => [`${k}Ms`, Math.round(v)])) },
  identicalBytes: Buffer.compare(fs.readFileSync(whole), Buffer.from(linked.binary)) === 0,
  sameOutput: wholeOut === linkedOut,
};
console.log(JSON.stringify(report, null, 2));
if (!report.sameOutput) {
  console.log("--- whole\n" + wholeOut + "--- linked\n" + linkedOut);
  process.exitCode = 1;
} else process.stdout.write(linkedOut);
