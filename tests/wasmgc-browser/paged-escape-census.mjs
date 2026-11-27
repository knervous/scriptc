// Closure escape census for the paged-record analysis (emitter.ts escapeType).
// A function type's dyn invoker counts only when a closure of that type can
// reach dyn or the page, so a record shape its parameters or results mention
// stays unpaged otherwise. This compiles the escape fixtures (the shape must be
// paged: untyped code or the page can hand it a page object) and programs whose
// closures never escape (no shape may be paged), under the production options,
// and reads the paged count SCRIPTC_PAGED_WHY reports.
//   node paged-escape-census.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const { compile } = await import(path.resolve(here, "../../packages/compiler/dist/index.js"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paged-census-"));
const pagedCount = async (file) => {
  const why = path.join(dir, "why.txt");
  process.env.SCRIPTC_PAGED_WHY = why;
  const r = await compile(file, { outDir: dir, outPath: path.join(dir, "a.wasm"), outputKind: "wasmgc", browser: true, dynModel: "native", release: true,
    experimentalTsNativeAny: true, interfaceClassArms: true, hostHandles: true, conditions: ["wasmgc"] });
  if (!r.ok) throw new Error(`${file}: ${r.diagnostics.map((d) => d.message).join("; ")}`);
  return Number(/^paged (\d+)/.exec(fs.readFileSync(why, "utf8"))[1]);
};
const negatives = {
  "never-escapes": `interface R { n: number; }
interface Box { cb: (a: R) => number; }
const box: Box = { cb: (a) => a.n + 1 };
console.log(box.cb({ n: 2 }));`,
  // Only S's closure reaches untyped code: S is paged (1), R is not.
  "other-type-escapes": `interface R { n: number; }
interface S { m: number; }
const typed = (a: R): number => a.n * 2;
const other = (a: S): number => a.m;
const lose: any = other;
console.log(typed({ n: 1 }), lose.length);`,
  "result-closure-stays-typed": `interface R { n: number; }
const make = (k: number) => (a: R): number => a.n + k;
console.log(make(3)({ n: 4 }));`,
};
const positives = fs.readdirSync(path.join(here, "fixtures")).filter((f) => /^paged-escape-.*\.ts$/.test(f)).map((f) => path.join(here, "fixtures", f));
let failed = 0;
const report = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`); if (!ok) failed++; };
report("paged-noescape-codec", (await pagedCount(path.join(here, "fixtures", "paged-noescape-codec.ts"))) === 0, "unpaged");
const expected = { "other-type-escapes": 1 };
for (const [name, source] of Object.entries(negatives)) {
  const file = path.join(dir, `${name}.ts`);
  fs.writeFileSync(file, source);
  const n = await pagedCount(file);
  report(name, n === (expected[name] ?? 0), `paged ${n}`);
}
for (const file of positives) { const n = await pagedCount(file); report(path.basename(file), n > 0, `paged ${n}`); }
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
