import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../index.js";
import { provenInBounds, versionTypedArrayBounds } from "./typed-array-bounds.js";
import type { IrExpr, IrFunction, IrModule, IrStmt } from "./ir.js";
import { everyStmtList } from "./traverse.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-bounds-"));
  try {
    const entry = join(dir, "main.ts");
    const outPath = join(dir, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: dir, outPath, outputKind: "ir" });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return deserializeModule(await readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const fn = (mod: IrModule, name: string): IrFunction => mod.functions.find((f) => f.name === name)!;
function nodes(f: IrFunction): (IrExpr | IrStmt)[] {
  const out: (IrExpr | IrStmt)[] = [];
  everyStmtList(f.body, { expr: (e) => (out.push(e), true), stmt: (s) => (out.push(s), true) });
  return out;
}
const proven = (f: IrFunction): number => nodes(f).filter((n) => provenInBounds.has(n)).length;
const accesses = (f: IrFunction): number => nodes(f).filter((n) => (n.kind === "bytesIntrinsic" && n.method === "get") || n.kind === "bytesSet").length;

test("accesses at a stable base and bounded offsets run behind one guard, as they are otherwise", async () => {
  const before = await lower(`
    function sum4(m: Float32Array, k: number): number { return m[k]! + m[k + 1]! + m[k + 2]! + m[k + 3]!; }
    function rows(out: Float64Array, offset: number): void { for (let c = 0; c < 4; c++) { out[offset + c * 4] = c; out[offset + c * 4 + 3] = -c; } out[offset] = 9; }
    function moved(m: Int16Array, k: number): number { const s = m[k]! + m[k + 1]! + m[k + 2]!; k++; return s + m[k]!; }
    function two(m: Uint8Array, k: number): number { return m[k]! + m[k + 1]!; }
    function looped(m: Float32Array, n: number): number { let s = 0; for (let i = 0; i < n; i++) { const o = i * 4; s += m[o]! + m[o + 1]! + m[o + 2]!; } return s; }
    const f = new Float32Array(8), d = new Float64Array(20), h = new Int16Array(4), b = new Uint8Array(2);
    rows(d, 1);
    console.log(sum4(f, 1), moved(h, 0), two(b, 0), looped(f, 2));
  `);
  const mod = versionTypedArrayBounds(before);
  // The copy proves its accesses; the original statements stay beside it.
  expect(proven(fn(mod, "sum4"))).toBe(4);
  expect(accesses(fn(mod, "sum4"))).toBe(8);
  // A loop's accesses at offsets its counter bounds are proven with the body's guard.
  expect(proven(fn(mod, "rows"))).toBe(3);
  // A base the body writes, fewer than three accesses, or a base declared in a loop body: unchanged.
  for (const name of ["moved", "two", "looped"]) expect(fn(mod, name)).toBe(fn(before, name));
});
