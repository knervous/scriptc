// What an edit to module A changes in the other objects (docs-draft/OBJECT_FILES_POC.md): compile every object of the
// three-module slice, apply one edit to geom.ts, recompile every object, and report which objects' bytes changed and
// whether the stale objects (the ones not recompiled) still link. It also times what an incremental rebuild runs after
// the edit (the edited module's object, then link, emit and, for release, wasm-opt) against whole-program builds of the
// edited program, dev and release.
//
//   node incremental.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../packages/compiler/dist");
const { compileObject, readObject } = await import(path.join(dist, "link/object.js"));
const { linkObjects, linkWasmGc, LinkError } = await import(path.join(dist, "link/link.js"));
const { compile } = await import(path.join(dist, "index.js"));
const ms = (t) => Math.round(performance.now() - t);

const modules = ["geom.ts", "square.ts", "app.ts"];
const edits = {
  "function body": (s) => s.replace("return x * k;", "return k * x;"),
  "method body": (s) => s.replace("return this.w * this.h;", "return this.h * this.w;"),
  "new export": (s) => s + "\nexport function unused(n: number): number {\n  return n + 1;\n}\n",
  "class layout (new field)": (s) => s.replace("constructor(public name: string) {}", "tag = 0;\n  constructor(public name: string) {}"),
  "method signature": (s) => s.replace("export function scale(x: number, k: number): number {", "export function scale(x: number, k: number, _unused = 0): number {"),
};

const build = async (dir) => {
  const out = {};
  for (const m of modules) {
    const p = path.join(dir, m.replace(/\.ts$/, ".wobj"));
    await compileObject(path.join(dir, m), { root: dir, outPath: p, programRoot: path.join(dir, "app.ts") });
    out[m] = fs.readFileSync(p);
  }
  return out;
};
// An object's content across revisions: the stamp's whole-program digest names the revision, so it is left out.
const content = (bytes) => {
  const o = JSON.parse(bytes.toString("utf8"));
  if (o.stamp) o.stamp.program = null;
  return JSON.stringify(o);
};

const report = {};
for (const [name, edit] of Object.entries(edits)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasmgc-incremental-"));
  try {
    for (const f of [...modules, "tsconfig.json"]) fs.copyFileSync(path.join(here, "three", f), path.join(dir, f));
    const before = await build(dir);
    fs.writeFileSync(path.join(dir, "geom.ts"), edit(fs.readFileSync(path.join(dir, "geom.ts"), "utf8")));
    const after = await build(dir);
    const changed = modules.filter((m) => content(before[m]) !== content(after[m]));
    // The stale link: the new geom object with the other objects as they were before the edit.
    const stalePaths = modules.map((m) => {
      const p = path.join(dir, `stale-${m.replace(/\.ts$/, ".wobj")}`);
      fs.writeFileSync(p, m === "geom.ts" ? after[m] : before[m]);
      return p;
    });
    let staleLink;
    try { linkObjects(await Promise.all(stalePaths.map(readObject)), { entry: "app.ts" }); staleLink = "links"; }
    catch (e) { if (!(e instanceof LinkError)) throw e; staleLink = `refused: ${e.problems[0]}`; }
    // Timings after the edit: the incremental path re-lowers only geom.ts (when nothing else changed) and links.
    const objects = await Promise.all(modules.map((m) => readObject(path.join(dir, m.replace(/\.ts$/, ".wobj")))));
    let t = performance.now();
    await compileObject(path.join(dir, "geom.ts"), { root: dir, outPath: path.join(dir, "geom.wobj"), programRoot: path.join(dir, "app.ts") });
    const objectMs = ms(t);
    const dev = linkWasmGc(objects, { optimizeLevel: 0, entry: "app.ts" }), rel = linkWasmGc(objects, { optimizeLevel: 2, entry: "app.ts" });
    const whole = async (dev) => {
      const t0 = performance.now();
      const r = await compile(path.join(dir, "app.ts"), { outDir: dir, outPath: path.join(dir, "whole.wasm"), outputKind: "wasmgc", browser: true, dynModel: "native", ...(dev ? { optimization: "dev" } : {}) });
      if (!r.ok) throw new Error("whole build failed");
      return ms(t0);
    };
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    report[name] = { changed, staleLink, ms: {
      incremental: { geomObject: objectMs, dev: round(dev.timings), release: round(rel.timings) },
      wholeProgram: { dev: await whole(true), release: await whole(false) },
    } };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(report, null, 2));
