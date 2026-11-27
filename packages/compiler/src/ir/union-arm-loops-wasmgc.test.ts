import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../index.js";
import { versionUnionArmLoops } from "./union-arm-loops-wasmgc.js";
import type { IrExpr, IrFunction, IrModule, IrStmt } from "./ir.js";
import { everyExprChild, everyStmtChild, everyStmtList } from "./traverse.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-union-arms-"));
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

function count(f: IrFunction, match: (node: IrExpr | IrStmt) => boolean): number {
  let found = 0;
  everyStmtList(f.body, {
    stmt: (s) => (match(s) && found++, true),
    expr: (e) => (match(e) && found++, true),
  });
  return found;
}

/** Reads of a union element or length through the array-like helpers, on `id`. */
const helperReadsOn = (f: IrFunction, id: string): number =>
  count(f, (e) => e.kind === "call" && e.callee.startsWith("%arraylike.") && e.args[0]?.kind === "varRef" && e.args[0].localId === id);

/** Helper reads of `id` inside a loop, where they run per element. */
function helperReadsInLoops(f: IrFunction, id: string): number {
  let found = 0;
  const isLoop = (s: IrStmt): boolean => s.kind === "for" || s.kind === "while" || s.kind === "doWhile";
  const visitExpr = (e: IrExpr, depth: number): void => {
    if (depth > 0 && e.kind === "call" && e.callee.startsWith("%arraylike.") && e.args[0]?.kind === "varRef" && e.args[0].localId === id) found++;
    everyExprChild(e, (c) => (visitExpr(c, depth), true), (c) => (visitStmt(c, depth), true));
  };
  const visitStmt = (s: IrStmt, depth: number): void => {
    const nested = depth + (isLoop(s) ? 1 : 0);
    everyStmtChild(s, (c) => (visitExpr(c, nested), true), (c) => (visitStmt(c, nested), true));
  };
  for (const s of f.body) visitStmt(s, 0);
  return found;
}

const bytesReads = (f: IrFunction): number => count(f, (e) => e.kind === "bytesIntrinsic" && e.method === "get");

test("a loop over a union of typed arrays reads each arm directly", async () => {
  const mod = versionUnionArmLoops(await lower(`
    type Xs = Uint8Array | Float32Array;
    function sum(xs: Xs, extra: number): number { let s = extra; for (let i = 0; i < xs.length; i++) s += xs[i]!; return s; }
    function rebound(xs: Xs, ys: Xs): number { let s = 0; for (let i = 0; i < 2; i++) { s += xs[i]!; if (i === 0) xs = ys; } return s; }
    console.log(sum(new Uint8Array(2), 1), sum(new Float32Array(2), 2), rebound(new Uint8Array(2), new Float32Array(2)));
  `));
  const sum = fn(mod, "sum");
  expect(helperReadsInLoops(sum, "xs.0")).toBe(0);
  expect(bytesReads(sum)).toBe(2);
  // A rebound union keeps its dispatch.
  expect(helperReadsInLoops(fn(mod, "rebound"), "xs.0")).toBeGreaterThan(0);
});

test("a body over parameters of one union runs a copy per arm and the body as it is for mixed arms", async () => {
  const source = `
    type Mat = Float32Array | Float64Array;
    function sum2(m: Mat, k: number): number { return m[k]! + m[k + 1]!; }
    function mul(a: Mat, b: Mat, out: Mat): void { out[0] = a[0]! * b[0]!; out[1] = a[1]! * b[1]!; }
    function captured(m: Mat): number { const read = (i: number) => m[i]!; return read(0) + m[1]!; }
    const f = new Float32Array(4), d = new Float64Array(4);
    console.log(sum2(f, 0), sum2(d, 1), captured(f));
    mul(f, d, f);
  `;
  const before = await lower(source);
  const mod = versionUnionArmLoops(before);
  // One parameter: two copies, every read direct.
  const sum2 = fn(mod, "sum2");
  expect(helperReadsOn(sum2, "m.0")).toBe(0);
  expect(bytesReads(sum2)).toBe(4);
  // Three parameters of one union: a copy per arm (direct reads and writes) plus the body as it was.
  const mul = fn(mod, "mul");
  expect(bytesReads(mul)).toBe(8);
  expect(count(mul, (e) => e.kind === "bytesSet" && e.arr.kind === "varRef" && e.arr.localId.startsWith("out.arm"))).toBe(4);
  expect(helperReadsOn(mul, "a.0") + helperReadsOn(mul, "b.0")).toBe(helperReadsOn(fn(before, "mul"), "a.0") + helperReadsOn(fn(before, "mul"), "b.0"));
  // A body that creates a closure is not copied.
  expect(fn(mod, "captured")).toBe(fn(before, "captured"));
});
