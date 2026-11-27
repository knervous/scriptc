import { expect, test } from "vitest";
import type { IrExpr, IrFunction, IrModule, IrStmt, SrcLoc } from "./ir/ir.js";
import { collectFences } from "./release-fences.js";

const at = (start: number, file = "/src/a.ts"): SrcLoc => ({ file, start, end: start + 1 });
const statementFence = (code: string, loc?: SrcLoc): IrStmt => ({ kind: "runtimeFence", code, message: `${code} statement`, ...(loc ? { loc } : {}) } as IrStmt);
const expressionFence = (code: string, loc?: SrcLoc): IrStmt => {
  const l = loc ?? at(0);
  const expr = { kind: "libCall", fn: "error.nodeThrow", args: [
    { kind: "numLit", value: 0, type: { kind: "f64" }, loc: l },
    { kind: "strLit", value: code, type: { kind: "string" }, loc: l },
    { kind: "strLit", value: `${code} expression`, type: { kind: "string" }, loc: l },
  ], type: { kind: "void" }, ...(loc ? { loc } : {}) } as unknown as IrExpr;
  return { kind: "exprStmt", expr, loc: l } as IrStmt;
};
const fn = (name: string, body: IrStmt[], loc?: SrcLoc): IrFunction => ({ name, params: [], returnType: { kind: "void" }, locals: [], body, ...(loc ? { loc } : {}) } as unknown as IrFunction);
const mod = (functions: IrFunction[]): IrModule => ({ sourceFile: "/src/main.ts", functions } as unknown as IrModule);

test("a fence refuses in either form: statement fences and SC-coded expression throws", () => {
  const fences = collectFences(mod([fn("f", [statementFence("SC2020", at(10)), expressionFence("SC4005", at(20))])]));
  expect(fences.map((f) => [f.code, f.loc.start])).toEqual([["SC2020", 10], ["SC4005", 20]]);
});

test("proven-unreachable traps are exempt in both forms", () => {
  const fences = collectFences(mod([fn("f", [
    statementFence("SC9002", at(1)), statementFence("SC9003", at(2)),
    expressionFence("SC9002", at(3)), expressionFence("SC9003", at(4)),
    statementFence("SC9001", at(5)),
  ])]));
  expect(fences.map((f) => f.code)).toEqual(["SC9001"]);
});

test("Node-parity throws (no SC code) are not fences", () => {
  const plain = expressionFence("ERR_MISSING_ARGS", at(7));
  expect(collectFences(mod([fn("f", [plain])]))).toEqual([]);
});

test("a fence keeps its own span; one without a span takes its function's, then the module's", () => {
  const fences = collectFences(mod([
    fn("own", [statementFence("SC2001", at(30, "/src/b.ts"))], at(1, "/src/b.ts")),
    fn("fromFunction", [statementFence("SC2002")], at(40, "/src/c.ts")),
    fn("fromModule", [statementFence("SC2003")]),
  ]));
  expect(fences.map((f) => [f.code, f.loc.file, f.loc.start])).toEqual([
    ["SC2001", "/src/b.ts", 30], ["SC2002", "/src/c.ts", 40], ["SC2003", "/src/main.ts", 0],
  ]);
});

test("distinct fences sharing a span (a synthesized helper's) are each reported", () => {
  const shared = at(0, "/src/main.ts");
  const fences = collectFences(mod([fn("keys", [
    { kind: "runtimeFence", code: "SC4005", message: "reading 'preload' of A", loc: shared } as IrStmt,
    { kind: "runtimeFence", code: "SC4005", message: "reading 'load' of B", loc: shared } as IrStmt,
  ])]));
  expect(fences.map((f) => f.message)).toEqual(["reading 'preload' of A", "reading 'load' of B"]);
});

test("the same fence at the same span is reported once", () => {
  const fences = collectFences(mod([fn("f", [statementFence("SC2020", at(10))]), fn("g", [statementFence("SC2020", at(10))])]));
  expect(fences).toHaveLength(1);
});
