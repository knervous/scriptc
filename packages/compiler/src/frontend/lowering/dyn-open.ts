import { BOOL, DYN, STRING, type IrExpr, type SrcLoc } from "../../ir/ir.js";
import { varRef } from "../../ir/build.js";
import type { Lowerer } from "./lowerer.js";

/** An untyped source that a native consumer (new Map / new Set, array destructuring) will iterate, opened first
 * where it must be: a compiled object that is not an array, plain object, collection or generator (a class
 * instance) goes through `dyn.iterator`, which the class dispatch rewrites to find the class's own
 * [Symbol.iterator] method; the opened iterator then stands as an iterable (`dyn.opened`). Everything else is
 * the source itself, for the consumer to open. */
export function openedIterable(lowerer: Lowerer, source: IrExpr, loc: SrcLoc): IrExpr {
  const held = lowerer.declareHiddenLocal("%opensrc", DYN);
  const ref = (): IrExpr => varRef(held.id, DYN, loc);
  return { kind: "seqExpr", stmts: [{ kind: "varDecl", localId: held.id, init: source, loc }], result: {
    kind: "ternary", cond: { kind: "libCall", fn: "dyn.needsOpen", args: [ref()], type: BOOL, loc },
    then: { kind: "libCall", fn: "dyn.opened", args: [{ kind: "libCall", fn: "dyn.iterator", args: [ref(), { kind: "strLit", value: "", type: STRING, loc }], type: DYN, loc }], type: DYN, loc },
    else_: ref(), type: DYN, loc,
  }, type: DYN, loc };
}
