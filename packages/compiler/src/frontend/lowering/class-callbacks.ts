// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import * as ts from "../ts7/adapter.js";
import { BOOL, DYN, STRING, VOID, isClassOwnEnumerableFieldName, type IrExpr, type IrStmt, type SrcLoc } from "../../ir/ir.js";
import { varRef } from "../../ir/build.js";
import { isJsSourceFile, locOf } from "../program.js";
import { dynUndefinedExpr, type Lowerer } from "./lowerer.js";
import { findMethodOn, type ClassInfo } from "./lower-classes.js";
import { classPropertiesHelper } from "./class-dynamic-dispatch.js";
import { classPrototypeData } from "./class-prototypes.js";
import { tryLowerExpression } from "./expressions/try-lower-expression.js";

/** Observed method slots can be replaced through instance properties or
 * their shared prototype chain; so can a JavaScript class's zero-argument
 * notifications, which untyped code assigns without a declaration to see.
 * A TypeScript class's method is observed only when the program replaces it
 * (collectVirtualJsMethods): every other call to it stays static. */
export function isClassCallback(lowerer: Lowerer, info: ClassInfo, name: string): boolean {
  if (!isClassOwnEnumerableFieldName(name) || name.startsWith("get:") || name.startsWith("set:")) return false;
  if (info.def.runtime || info.builtinError || info.builtinEmitter || info.builtinStream || info.fields.has(name)) return false;
  // Generic classes (the family and each instantiation) and mixin instances have no prototype data object to fall back on when the bag has no entry.
  if (info.generic || info.genericInstance || info.mixinInstance) return false;
  const found = findMethodOn(lowerer, info, name);
  if (!found) return false;
  // A method a generic or mixin ancestor declares has no prototype data entry either (a layer's inherited
  // `dispose()` from a generic `DynamicLayerCore<...>` read undefined from the bag: "is not a function").
  for (let c: ClassInfo | null = info; c && c !== found.declarer.base; c = c.base) {
    if (c.generic || c.genericInstance || c.mixinInstance) return false;
  }
  if (found.sig.abstract) return false;
  if (lowerer.prototypeMethodAccesses.has(name)) return true;
  const declarer = found.declarer.decl;
  return found.sig.params.length === 0 && found.sig.ret.kind === "void" && declarer !== null && isJsSourceFile(declarer.getSourceFile());
}

function callbackBag(lowerer: Lowerer, receiver: IrExpr, loc: SrcLoc, name: string): IrExpr {
  const info = receiver.type.kind === "object" ? lowerer.classes.get(receiver.type.className) : null;
  if (info && lowerer.prototypeMethodAccesses.has(name)) classPrototypeData(lowerer, info, loc);
  return { kind: "call", callee: classPropertiesHelper(lowerer, loc).name,
    args: [lowerer.coerceToExpected(receiver, DYN)], type: DYN, loc };
}

export function lowerClassCallbackAssign(lowerer: Lowerer, expr: ts.BinaryExpression): IrStmt | null {
  const access = expr.left;
  if (!ts.isPropertyAccessExpression(access) || access.questionDotToken) return null;
  const receiver = tryLowerExpression(lowerer, access.expression);
  if (!receiver) return null;
  const info = receiver.type.kind === "object" ? lowerer.classes.get(receiver.type.className) : undefined;
  if (!info || !isClassCallback(lowerer, info, access.name.text)) return null;
  const loc = locOf(expr);
  return { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySet", args: [callbackBag(lowerer, receiver, loc, access.name.text),
    { kind: "strLit", value: access.name.text, type: STRING, loc }, lowerer.lowerExprExpecting(expr.right, DYN)], type: VOID, loc }, loc };
}

/** Read the property before arguments run, retaining callback identity
 * and the original native receiver for JavaScript's `this` binding. */
export function classCallbackValue(lowerer: Lowerer, receiver: IrExpr, name: string, fallback: IrExpr, loc: SrcLoc): IrExpr {
  const bag = lowerer.declareHiddenLocal("%callbackBag", DYN);
  const value = varRef(bag.id, DYN, loc);
  const key: IrExpr = { kind: "strLit", value: name, type: STRING, loc };
  const result: IrExpr = lowerer.prototypeMethodAccesses.has(name) ? { kind: "dynKeyGet", value, key, type: DYN, loc }
    : { kind: "ternary", cond: { kind: "libCall", fn: "dyn.hasKey", args: [value, key], type: BOOL, loc },
    then: { kind: "dynKeyGet", value, key, type: DYN, loc }, else_: lowerer.coerceToExpected(fallback, DYN), type: DYN, loc };
  return { kind: "seqExpr", stmts: [{ kind: "varDecl", localId: bag.id, init: callbackBag(lowerer, receiver, loc, name), loc }], result, type: DYN, loc };
}

export function classCallbackCall(lowerer: Lowerer, receiver: IrExpr, name: string, args: IrExpr[], fallback: IrExpr, loc: SrcLoc, calleeName = name): IrExpr {
  const bag = lowerer.declareHiddenLocal("%callbackBag", DYN);
  const present = lowerer.declareHiddenLocal("%callbackPresent", BOOL);
  const callback = lowerer.declareHiddenLocal("%callback", DYN);
  const value = varRef(bag.id, DYN, loc);
  const key: IrExpr = { kind: "strLit", value: name, type: STRING, loc };
  const call: IrExpr = { kind: "dynCall", callee: varRef(callback.id, DYN, loc), receiver: lowerer.coerceToExpected(receiver, DYN),
    calleeName, args, type: DYN, loc };
  const result: IrExpr = lowerer.prototypeMethodAccesses.has(name) ? call
    : { kind: "ternary", cond: varRef(present.id, BOOL, loc), then: call,
    else_: fallback.type.kind === "void"
      ? { kind: "seqExpr", stmts: [{ kind: "exprStmt", expr: fallback, loc }], result: dynUndefinedExpr(loc), type: DYN, loc }
      : lowerer.coerceToExpected(fallback, DYN), type: DYN, loc };
  const answer = fallback.type.kind === "void" ? result : lowerer.coerceToExpected(result, fallback.type);
  return { kind: "seqExpr", stmts: [
    { kind: "varDecl", localId: bag.id, init: callbackBag(lowerer, receiver, loc, name), loc },
    { kind: "varDecl", localId: present.id, init: lowerer.prototypeMethodAccesses.has(name)
      ? { kind: "boolLit", value: true, type: BOOL, loc }
      : { kind: "libCall", fn: "dyn.hasKey", args: [value, key], type: BOOL, loc }, loc },
    { kind: "varDecl", localId: callback.id, init: { kind: "dynKeyGet", value, key, type: DYN, loc }, loc },
  ], result: answer, type: answer.type, loc };
}
