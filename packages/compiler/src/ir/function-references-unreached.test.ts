import { expect, test } from "vitest";
import { F64, VOID, type IrExpr, type IrFunction, type IrModule, type IrStmt } from "./ir.js";
import { withoutUnreachedFunctions } from "./function-references.js";
import { CLASS_CONSTRUCT_PACKED } from "./implicit-references.js";

const loc = { file: "refs.ts", start: 0, end: 1 };
const fn = (name: string, body: IrStmt[] = []): IrFunction => ({ name, params: [], returnType: VOID, locals: [], body, loc });
const stmt = (expr: IrExpr): IrStmt => ({ kind: "exprStmt", expr, loc }) as IrStmt;
const call = (callee: string): IrStmt => stmt({ kind: "call", callee, args: [], type: VOID, loc } as IrExpr);
const module = (functions: IrFunction[], extra: Partial<IrModule> = {}): IrModule =>
  ({ irVersion: 17, sourceFile: "refs.ts", functions, classes: [], records: [], unions: [], globals: [], entry: "%main", ...extra }) as IrModule;
const names = (mod: IrModule): string[] => mod.functions.map((f) => f.name);

test("a removable function nothing reaches is removed; others stay reached or not", () => {
  const mod = module([fn("%fn.0"), fn("%unit"), fn("%main")]);
  expect(names(withoutUnreachedFunctions(mod, new Set(["%fn.0"])))).toEqual(["%unit", "%main"]);
  expect(withoutUnreachedFunctions(mod, new Set())).toBe(mod);
});

test("any string that spells a removable name reaches it, from code or metadata", () => {
  const spelled = module([fn("%fn.0"), fn("%main", [stmt({ kind: "strLit", value: "%fn.0", type: { kind: "string" }, loc } as IrExpr)])]);
  expect(withoutUnreachedFunctions(spelled, new Set(["%fn.0"]))).toBe(spelled);
  const closure = module([fn("%fn.0"), fn("%main", [stmt({ kind: "closure", fnName: "%fn.0", captures: [], type: { kind: "func", params: [], ret: F64 }, loc } as unknown as IrExpr)])]);
  expect(withoutUnreachedFunctions(closure, new Set(["%fn.0"]))).toBe(closure);
  const metadata = module([fn("%proto.C"), fn("%main")], { classes: [{ name: "C", fields: [], prototypeDataHelper: "%proto.C", loc }] as NonNullable<IrModule["classes"]> });
  expect(withoutUnreachedFunctions(metadata, new Set(["%proto.C"]))).toBe(metadata);
});

test("removable functions reach each other only from a reached one", () => {
  const mod = module([
    fn("%live.a", [call("%live.b")]), fn("%live.b"),
    fn("%dead.a", [call("%dead.b"), call("%dead.c")]), fn("%dead.b", [call("%dead.a")]), fn("%dead.c"),
    fn("%main", [call("%live.a")]),
  ]);
  expect(names(withoutUnreachedFunctions(mod, new Set(names(mod))))).toEqual(["%live.a", "%live.b", "%main"]);
});

test("convention references, backend roots, extra roots and class members stay", () => {
  const classRef = stmt({ kind: "classRef", className: "C", type: { kind: "classval", className: "C" }, loc } as unknown as IrExpr);
  const mod = module([
    fn("%static.data.C"), fn(CLASS_CONSTRUCT_PACKED), fn("%dyn.class.properties"), fn("%builtin.Array.ctorValue"),
    fn("%export.me"), fn("%C.method"), fn("%fn.dead"), fn("%main", [classRef]),
  ], { classes: [{ name: "C", fields: [], loc }] as NonNullable<IrModule["classes"]> });
  const kept = withoutUnreachedFunctions(mod, new Set(names(mod)), ["%export.me"]);
  expect(names(kept)).toEqual(names(mod).filter((n) => n !== "%fn.dead"));
});
