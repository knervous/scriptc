// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import * as ts from "../ts7/adapter.js";
import { BOOL, DYN, JSVAL, STRING, arrayOf, funcOf, type IrExpr } from "../../ir/ir.js";
import { browserTarget } from "../browser-target.js";
import { strLit } from "../../ir/build.js";
import { locOf } from "../program.js";
import type { Lowerer } from "./lowerer.js";

/** A stored global object has identity and survives module/function boundaries.
 * Known globals without a value implementation refuse at runtime; absent host
 * capabilities answer undefined. The checker supplies names, never values. */
export function lowerGlobalValue(lowerer: Lowerer, expr: ts.Expression): IrExpr {
  const loc = locOf(expr);
  const names = lowerer.checker.getPropertiesOfType(lowerer.typeOf(expr)).map((property) => property.name);
  return {
    kind: "libCall", fn: "global.native", args: [{
      kind: "arrayLit", elems: names.map((name) => strLit(name, loc)), type: arrayOf(STRING), loc,
    }], type: DYN, loc,
  };
}

/** `Function("return this")` and `new Function("return this")`: bundled
 * libraries' global-object probe (lodash's _root.js, regenerator, core-js).
 * The function the Function constructor builds from exactly that source
 * returns its sloppy-mode `this`: the global object when called without a
 * receiver (or with null/undefined), the receiver itself when it is an
 * object or function, and its wrapper object when it is a primitive (sloppy
 * mode boxes it). Browser target: a lifted function answering exactly that
 * (the page's globalThis, the page's wrapper objects). Null for any other
 * call, which keeps the Function constructor's fence (there
 * is no runtime code generation). */
export function lowerFunctionReturnThis(lowerer: Lowerer, expr: ts.CallExpression | ts.NewExpression): IrExpr | null {
  if (!browserTarget()) return null;
  let callee: ts.Expression = expr.expression;
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "Function" || !lowerer.isStdlibGlobal(callee, "Function")) return null;
  const args = expr.arguments ?? [];
  if (args.length !== 1 || !ts.isStringLiteralLike(args[0]!)) return null;
  if (args[0]!.text.trim().replace(/;$/, "").trim() !== "return this") return null;
  const loc = locOf(expr);
  const name = "%builtin.Function.returnThis";
  if (!lowerer.liftedFns.some((fn) => fn.name === name)) {
    const self: IrExpr = { kind: "varRef", localId: "this.0", type: DYN, loc };
    const test = (test: "nullish" | "object" | "function"): IrExpr => ({ kind: "dynTest", test, value: self, type: BOOL, loc });
    const globalObject = lowerer.coerceToExpected({ kind: "jsOp", op: "globalGet", name: "globalThis", args: [], type: JSVAL, loc }, DYN);
    lowerer.liftedFns.push({
      name, params: [], returnType: DYN, loc,
      locals: [{ id: "this.0", name: "this", type: DYN, mutable: false }],
      body: [
        { kind: "varDecl", localId: "this.0", init: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc }, loc },
        { kind: "if", cond: test("nullish"), then: [{ kind: "return", value: globalObject, loc }], else_: null, loc },
        { kind: "if", cond: test("object"), then: [{ kind: "return", value: self, loc }], else_: null, loc },
        { kind: "if", cond: test("function"), then: [{ kind: "return", value: self, loc }], else_: null, loc },
        // A primitive receiver: sloppy mode boxes it (the page's wrapper object, as Object(v) gives).
        { kind: "return", value: { kind: "dynCall", callee: lowerer.coerceToExpected({ kind: "jsOp", op: "globalGet", name: "Object", args: [], type: JSVAL, loc }, DYN),
          calleeName: "Object", args: [self], type: DYN, loc }, loc },
      ],
    });
  }
  return { kind: "closure", fnName: name, captures: [], type: funcOf([], DYN), loc };
}
