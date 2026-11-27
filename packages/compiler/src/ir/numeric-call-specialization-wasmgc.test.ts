import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../index.js";
import type { IrModule } from "./ir.js";
import { specializeNumericCalls } from "./numeric-call-specialization-wasmgc.js";
import { everyStmtList } from "./traverse.js";
import { validateModule } from "./validate.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-numeric-calls-"));
  try {
    const entry = join(dir, "main.ts"), outPath = join(dir, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: dir, outPath, outputKind: "ir" });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
    return deserializeModule(await readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const calls = (mod: IrModule, pattern: RegExp): [string, string][] => {
  const out: [string, string][] = [];
  for (const fn of mod.functions)
    everyStmtList(fn.body, {
      stmt: () => true,
      expr: (expr) => {
        if (expr.kind === "call" && pattern.test(expr.callee)) out.push([expr.callee, expr.args.map((arg) => arg.kind).join(",")]);
        return true;
      },
    });
  return out;
};

test("calls with known scalars or an omitted constant default take the variant; others keep the ABI", async () => {
  const original = await lower(`
let ticks = 0;
function tick(): number { ticks++; return ticks; }
function scale(value: number, by: number = 2): number { return value * by; }
function flag(on: boolean = true): string { return on ? "on" : "off"; }
function stepped(value: number, step: number = tick()): number { return value + step; }
function shown(value: number, extra?: number): string { return extra === undefined ? "-" : String(value + extra); }
function held(value: number, by: number = 3): number { return value - by; }
function kept(value: number, by?: number): () => number { return () => value + (by ?? 1); }
const keep = held;
const values: number[] = [4];
const on = values.length > 0;
console.log(scale(values.length), scale(1, undefined), scale(2, on ? 5 : undefined), flag(), flag(on));
console.log(stepped(1), stepped(2, 3), shown(1), shown(1, 2), held(5), keep(6), kept(1, 2)());
`);
  const before = JSON.stringify(original);
  const specialized = specializeNumericCalls(original);
  expect(JSON.stringify(original)).toBe(before);
  expect(validateModule(specialized)).toEqual([]);
  const names = specialized.functions.map((fn) => fn.name).filter((name) => /^(scale|flag|stepped|shown|held|kept)/.test(name)).sort();
  // Originals stay for the emitter's reachability to judge; `kept` captures its parameter and gets no variant.
  expect(names).toEqual(["flag", "flag.nativeNumber", "held", "held.nativeNumber", "kept", "scale", "scale.nativeNumber", "shown", "shown.nativeNumber", "stepped", "stepped.nativeNumber"]);
  expect(specialized.functions.find((fn) => fn.name === "flag.nativeNumber")?.params[0]?.type.kind).toBe("bool");
  expect(calls(specialized, /^(scale|flag|stepped|shown)/)).toEqual([
    ["scale.nativeNumber", "arrIntrinsic,numLit"],
    ["scale.nativeNumber", "numLit,numLit"],
    ["scale.nativeNumber", "numLit,ternary"],
    ["flag.nativeNumber", "boolLit"],
    ["flag.nativeNumber", "varRef"],
    ["stepped", "numLit,unionWrap"],
    ["stepped.nativeNumber", "numLit,numLit"],
    ["shown", "numLit,unionWrap"],
    ["shown.nativeNumber", "numLit,numLit"],
  ]);
});

test("a variant tests an f64 parameter for the undefined number, and recursion stays in the variant", async () => {
  const specialized = specializeNumericCalls(await lower(`
function shown(extra?: number): string { return extra === undefined ? "-" : String(extra); }
function depth(node: number, level: number = 0): number { return node <= 1 ? level : depth(node - 1, level + 1); }
console.log(shown(1), depth(5, 0));
`));
  const variant = specialized.functions.find((fn) => fn.name === "shown.nativeNumber")!;
  const tests: string[] = [];
  everyStmtList(variant.body, { stmt: () => true, expr: (e) => { if (e.kind === "libCall") tests.push(e.fn); if (e.kind === "unionIsTag") tests.push("unionIsTag"); return true; } });
  expect(tests).toEqual(["num.isUndefined"]);
  const recursive = specialized.functions.find((fn) => fn.name === "depth.nativeNumber")!;
  expect(calls({ ...specialized, functions: [recursive] }, /^depth/)).toEqual([["depth.nativeNumber", "bin,bin"]]);
});
