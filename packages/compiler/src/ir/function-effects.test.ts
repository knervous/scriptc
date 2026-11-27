import { expect, test } from "vitest";
import { analyzeFunctionEffects, isTotalScalarFunction } from "./function-effects.js";
import { F64, DYN, type IrExpr, type IrFunction, type IrStmt } from "./ir.js";
const loc = { file: "effects.ts", start: 0, end: 1 };
const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
const call = (callee: string): IrExpr => ({ kind: "call", callee, args: [], type: F64, loc });
const fn = (name: string, value: IrExpr, extra: IrStmt[] = []): IrFunction => ({ name, loc, params: [], locals: [], returnType: F64, body: [...extra, { kind: "return", value, loc }] });

test("propagates pure scalar calls and unresolved effects transitively", () => {
  const functions = [fn("leaf", num(3)), fn("pure", call("leaf")), fn("unknown", call("external")), fn("caller", call("unknown"))];
  const effects = analyzeFunctionEffects({ functions });
  expect(isTotalScalarFunction(functions[1]!, effects.get("pure")!)).toBe(true);
  expect(effects.get("caller")).toMatchObject({ pure: false, hostOrUnknown: true, mayThrow: true, mayDiverge: true });
});
test("keeps recursion and loops distinct from purity", () => {
  const functions = [fn("a", call("b")), fn("b", call("a")), fn("loop", num(0), [{ kind: "while", cond: { kind: "boolLit", value: true, type: { kind: "bool" }, loc }, body: [], loc }])];
  const effects = analyzeFunctionEffects({ functions });
  for (const f of functions) {
    expect(effects.get(f.name)).toMatchObject({ pure: true, mayDiverge: true });
    expect(isTotalScalarFunction(f, effects.get(f.name)!)).toBe(false);
  }
});
test("local arithmetic is pure; captured reads and writes are observable", () => {
  const local = fn("local", { kind: "varRef", localId: "x", type: F64, loc });
  local.locals = [{ id: "x", name: "x", type: F64, mutable: true }];
  const captured = { ...local, name: "capture", captures: [{ localId: "x", name: "x", type: F64 }], locals: [{ ...local.locals[0]!, boxed: true as const }] };
  const writer = { ...captured, name: "write", body: [{ kind: "assign", localId: "x", value: num(1), loc } as IrStmt] };
  const effects = analyzeFunctionEffects({ functions: [local, captured, writer] });
  expect(effects.get("local")!.pure).toBe(true);
  expect(effects.get("capture")).toMatchObject({ pure: false, readsMutable: true });
  expect(effects.get("write")).toMatchObject({ pure: false, writes: true });
});
test("dynamic properties and host calls never inherit a TS purity claim", () => {
  const read: IrExpr = { kind: "dynKeyGet", value: { kind: "varRef", localId: "obj", type: DYN, loc }, key: { kind: "strLit", value: "x", type: { kind: "string" }, loc }, type: DYN, loc };
  const f = fn("getter", read); f.locals = [{ id: "obj", name: "obj", type: DYN, mutable: false }];
  const effects = analyzeFunctionEffects({ functions: [f, fn("host", { kind: "libCall", fn: "math.random", args: [], type: F64, loc })] });
  expect(effects.get("getter")).toMatchObject({ pure: false, hostOrUnknown: true, mayThrow: true });
  expect(effects.get("host")!.pure).toBe(false);
});
