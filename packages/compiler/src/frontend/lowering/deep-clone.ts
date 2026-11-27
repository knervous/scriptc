import { keyedHelperName } from "./stable-names.js";
import { BOOL, DYN, F64, STRING, canDynCheckTo, isUnitType, shapeHasAccessorSlots, typeKey, type IrExpr, type IrStmt, type IrType, type SrcLoc } from "../../ir/ir.js";
import { numLit, varRef } from "../../ir/build.js";
import type { Lowerer } from "./lowerer.js";
import { dynUndefinedExpr } from "./lowerer.js";
import { nativeDyn } from "../browser-target.js";

/** structuredClone of a statically typed value: a fresh deep copy built from
 * the type itself — scalars and unit arms by value, arrays element by element,
 * fixed records field by field, unions by arm. One interned helper per type
 * (recursive types call their own helper), so the copy shares nothing with
 * the original. Null when some part of the type has no structured-clone copy
 * here (class instances, functions, maps, index-signature records, ...). */
const helpersByLowerer = new WeakMap<Lowerer, Map<string, string>>();

function isScalar(t: IrType): boolean {
  return t.kind === "f64" || t.kind === "string" || t.kind === "bool" || isUnitType(t);
}

function cloneable(lowerer: Lowerer, t: IrType, seen: Set<string>): boolean {
  if (isScalar(t)) return true;
  const key = typeKey(t);
  if (seen.has(key)) return true;
  seen.add(key);
  switch (t.kind) {
    case "array": return cloneable(lowerer, t.elem, seen);
    case "record": {
      const shape = lowerer.shapes.get(t.shapeId);
      if (!shape || shapeHasAccessorSlots(shape)) return false;
      // A pure index-signature record (`Record<string, T>`): its keys in insertion order, each value cloned at T.
      if (shape.indexValue !== undefined) return shape.fields.length === 0 && !shape.tuple && cloneable(lowerer, shape.indexValue, seen);
      return shape.fields.every((f) => cloneable(lowerer, f.type, seen));
    }
    case "union": {
      const def = lowerer.unions.get(t.unionId);
      // A class-instance arm (interface class arms) clones by the structured clone algorithm itself (a plain object of
      // its own data properties), checked back into the union: see helperFor.
      return !!def && def.arms.every((a) => cloneable(lowerer, a, seen) || classArmByDyn(lowerer, t, a));
    }
    default: return false;
  }
}

/** The IR expression for the clone of `value`, or null when not cloneable. */
export function deepCloneValue(lowerer: Lowerer, value: IrExpr, loc: SrcLoc): IrExpr | null {
  if (isScalar(value.type)) return value;
  if (!cloneable(lowerer, value.type, new Set())) return null;
  return { kind: "call", callee: helperFor(lowerer, value.type, loc), args: [value], type: value.type, loc };
}

function cloneInner(lowerer: Lowerer, value: IrExpr, loc: SrcLoc): IrExpr {
  if (isScalar(value.type)) return value;
  return { kind: "call", callee: helperFor(lowerer, value.type, loc), args: [value], type: value.type, loc };
}

function helperFor(lowerer: Lowerer, t: IrType, loc: SrcLoc): string {
  let cache = helpersByLowerer.get(lowerer);
  if (!cache) helpersByLowerer.set(lowerer, cache = new Map());
  const key = typeKey(t);
  const existing = cache.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%clone.deep", key);
  cache.set(key, name);
  const arg = (): IrExpr => varRef("a.0", t, loc);
  const locals: { id: string; name: string; type: IrType; mutable: boolean }[] = [{ id: "a.0", name: "a", type: t, mutable: true }];
  let body: IrStmt[];
  if (t.kind === "array") {
    const outT = t;
    locals.push({ id: "out.0", name: "out", type: outT, mutable: false }, { id: "n.0", name: "n", type: F64, mutable: false }, { id: "i.0", name: "i", type: F64, mutable: true });
    body = [
      { kind: "varDecl", localId: "out.0", init: { kind: "arrayLit", elems: [], type: outT, loc }, loc },
      { kind: "varDecl", localId: "n.0", init: { kind: "arrIntrinsic", method: "length", receiver: arg(), args: [], type: F64, loc }, loc },
      {
        kind: "for",
        init: { kind: "varDecl", localId: "i.0", init: numLit(0, loc), loc },
        cond: { kind: "bin", op: "<", left: varRef("i.0", F64, loc), right: varRef("n.0", F64, loc), type: BOOL, loc },
        update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: varRef("i.0", F64, loc), right: numLit(1, loc), type: F64, loc }, loc },
        body: [{
          kind: "exprStmt",
          expr: {
            kind: "arrIntrinsic", method: "push", receiver: varRef("out.0", outT, loc),
            args: [cloneInner(lowerer, { kind: "arrayGet", arr: arg(), index: varRef("i.0", F64, loc), type: t.elem, loc }, loc)],
            type: F64, loc,
          },
          loc,
        }],
        loc,
      },
      { kind: "return", value: varRef("out.0", outT, loc), loc },
    ];
  } else if (t.kind === "record" && lowerer.shapes.get(t.shapeId)!.indexValue !== undefined) {
    // Record<string, T>: a fresh empty record, then every own key (insertion order) set to the clone of its value.
    const indexValue = lowerer.shapes.get(t.shapeId)!.indexValue!;
    const ksT: IrType = { kind: "array", elem: STRING };
    locals.push({ id: "out.0", name: "out", type: t, mutable: false }, { id: "ks.0", name: "ks", type: ksT, mutable: false },
      { id: "n.0", name: "n", type: F64, mutable: false }, { id: "i.0", name: "i", type: F64, mutable: true }, { id: "k.0", name: "k", type: STRING, mutable: true });
    const ks = varRef("ks.0", ksT, loc), k = varRef("k.0", STRING, loc);
    body = [
      { kind: "varDecl", localId: "out.0", init: { kind: "recordLit", fields: [], type: t, loc }, loc },
      { kind: "varDecl", localId: "ks.0", init: { kind: "recordOvfKeys", obj: arg(), shapeId: t.shapeId, type: ksT, loc }, loc },
      { kind: "varDecl", localId: "n.0", init: { kind: "arrIntrinsic", method: "length", receiver: ks, args: [], type: F64, loc }, loc },
      {
        kind: "for",
        init: { kind: "varDecl", localId: "i.0", init: numLit(0, loc), loc },
        cond: { kind: "bin", op: "<", left: varRef("i.0", F64, loc), right: varRef("n.0", F64, loc), type: BOOL, loc },
        update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: varRef("i.0", F64, loc), right: numLit(1, loc), type: F64, loc }, loc },
        body: [
          { kind: "assign", localId: "k.0", value: { kind: "arrayGet", arr: ks, index: varRef("i.0", F64, loc), type: STRING, loc }, loc },
          { kind: "recordKeySet", obj: varRef("out.0", t, loc), shapeId: t.shapeId, key: k,
            value: cloneInner(lowerer, { kind: "recordKeyGet", obj: arg(), shapeId: t.shapeId, key: k, overflowOnly: true, type: indexValue, loc }, loc), loc },
        ],
        loc,
      },
      { kind: "return", value: varRef("out.0", t, loc), loc },
    ];
  } else if (t.kind === "record") {
    const shape = lowerer.shapes.get(t.shapeId)!;
    // A record built from untyped data keeps the source's undeclared keys: those clone through the dyn algorithm (every own key), checked back into the type.
    const viaDyn: IrStmt[] = nativeDyn() && !shape.tuple && !shape.indexValue && canDynCheckTo(t, (id) => lowerer.shapes.get(id), (id) => lowerer.unions.get(id))
      ? [{
        kind: "if", loc, else_: null,
        cond: { kind: "libCall", fn: "record.hasSrc", args: [arg()], type: BOOL, loc },
        then: [{ kind: "return", loc, value: { kind: "dynCheck", type: t, loc,
          value: { kind: "libCall", fn: "dyn.structuredClone", args: [{ kind: "dynFrom", value: arg(), type: DYN, loc }, dynUndefinedExpr(loc)], type: DYN, loc } } }],
      }] : [];
    body = [...viaDyn, {
      kind: "return",
      value: {
        kind: "recordLit",
        fields: shape.fields.map((f) => ({
          name: f.name,
          value: cloneInner(lowerer, { kind: "recordGet", obj: arg(), shapeId: t.shapeId, field: f.name, type: f.type, loc }, loc),
        })),
        type: t, loc,
      },
      loc,
    }];
  } else if (t.kind === "union") {
    const def = lowerer.unions.get(t.unionId)!;
    // Unit arms are the shared interned values: the argument itself is their copy.
    let result: IrExpr = arg();
    def.arms.forEach((armT, tag) => {
      if (isUnitType(armT)) return;
      const narrowed: IrExpr = { kind: "unionNarrow", value: arg(), unionId: t.unionId, tag, type: armT, loc };
      const wrapped: IrExpr = armT.kind === "object"
        ? { kind: "dynCheck", type: t, loc, value: { kind: "libCall", fn: "dyn.structuredClone", args: [{ kind: "dynFrom", value: narrowed, type: DYN, loc }, dynUndefinedExpr(loc)], type: DYN, loc } }
        : { kind: "unionWrap", value: cloneInner(lowerer, narrowed, loc), unionId: t.unionId, tag, type: t, loc };
      result = { kind: "ternary", cond: { kind: "unionIsTag", value: arg(), unionId: t.unionId, tag, negated: false, type: BOOL, loc }, then: wrapped, else_: result, type: t, loc };
    });
    body = [{ kind: "return", value: result, loc }];
  } else {
    body = [{ kind: "return", value: arg(), loc }];
  }
  lowerer.liftedFns.push({ name, params: [{ localId: "a.0", name: "a", type: t }], returnType: t, locals, body, loc });
  return name;
}

/** A class arm of a union clones through the dyn algorithm (native dyn only): the copy is a plain object, which the
 * union must be able to hold and check back (a record arm of the same data). */
function classArmByDyn(lowerer: Lowerer, union: IrType, arm: IrType): boolean {
  return arm.kind === "object" && nativeDyn() &&
    canDynCheckTo(union, (id) => lowerer.shapes.get(id), (id) => lowerer.unions.get(id));
}
