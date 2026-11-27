import * as ts from "../../ts7/adapter.js";
type Node = ts.Node;
import type { Lowerer } from "../lowerer.js";
import { nodeThrowExpr } from "../lowerer.js";
import { BOOL, NULL_T, UNDEFINED_T, VOID, type IrExpr, type IrStmt, type IrType, isUnitType, typeEquals } from "../../../ir/ir.js";
import { varRef } from "../../../ir/build.js";
import { locOf } from "../../program.js";

/** Assign a common data field without projecting the union's records into
 * a new structural shape. Each tag writes the original payload, so aliases
 * and identity-keyed collections observe the mutation: a record arm its
 * field, a class arm its field or its setter (virtual when a subclass
 * overrides it). Missing fields and differently typed storage retain their
 * own fences. */
export function lowerUnionFieldWrite(
  lowerer: Lowerer,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  rhs: ts.Expression,
  /** The statically known key of an element write (`o[k] = v`, k a literal or a literal-bound key parameter). */
  elementKey?: string,
): IrStmt | null {
  let unitRhs: Node | undefined = rhs;
  while (unitRhs !== undefined && ts.isParenthesizedExpression(unitRhs)) unitRhs = unitRhs.expression;
  const unit = unitRhs !== undefined && ts.isIdentifier(unitRhs) && unitRhs.text === "undefined" ? "undefined"
    : unitRhs !== undefined && unitRhs.kind === ts.SyntaxKind.NullKeyword ? "null" : undefined;
  const plan = planUnionFieldWrite(lowerer, access, elementKey, unit);
  if (!plan) return null;
  const { receiver, loc } = plan;
  const object = lowerer.declareHiddenLocal("%unionWriteObject", receiver.type);
  const objectRef = varRef(object.id, object.type, loc);
  const value = lowerer.lowerExprExpecting(rhs, plan.fieldType);
  // The `undefined` / `null` literal is stored as is in each arm: no effects, and a unit-typed local would not be a literal wrap into
  // the arm's undefined-armed slot.
  const stored = isUnitType(value.type) ? null : lowerer.declareHiddenLocal("%unionWriteValue", value.type);
  // Snapshot the reference before evaluating the RHS, which can change the
  // original binding. Evaluate and retain the value once before dispatch.
  const body: IrStmt[] = [
    { kind: "varDecl", localId: object.id, init: receiver, loc },
    ...(stored === null ? [] : [{ kind: "varDecl" as const, localId: stored.id, init: value, loc }]),
  ];
  return { kind: "block", body: [...body, ...plan.dispatch(objectRef, stored === null ? value : varRef(stored.id, stored.type, loc))], loc };
}

/** The per-tag write of a common field on a union receiver: the receiver (already lowered), the
 * field's declared type the stored value must have, and the dispatch over the held arm. */
export interface UnionFieldWritePlan {
  receiver: IrExpr;
  fieldType: IrType;
  name: string;
  loc: ReturnType<typeof locOf>;
  /** The tag dispatch writing `value` (of `fieldType`) into the arm `objectRef` holds. */
  dispatch(objectRef: IrExpr, value: IrExpr): IrStmt[];
}

export function planUnionFieldWrite(
  lowerer: Lowerer,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  elementKey?: string,
  /** The write stores the `undefined` / `null` literal: every present slot must be a union that holds that unit arm. */
  unitRhs?: "undefined" | "null",
): UnionFieldWritePlan | null {
  if (ts.isElementAccessExpression(access) && elementKey === undefined) return null;
  const mapped = lowerer.mapTypeOf(lowerer.typeOf(access.expression));
  // A probe cast (`(x as { f?: T }).f = v`) is erased: the receiver is x's own union value and
  // the view names the field's declared type (the write twin of probeCastRead).
  let operand: ts.Expression = access.expression;
  while (ts.isParenthesizedExpression(operand)) operand = operand.expression;
  if (access.questionDotToken || (mapped?.kind !== "union" && !ts.isAssertionExpression(operand))) return null;
  const receiver = lowerer.maybeNarrow(lowerer.lowerExpr(access.expression), access.expression);
  if (receiver.type.kind !== "union") return null;
  const unionId = receiver.type.unionId;
  const arms = lowerer.unions.get(unionId)?.arms;
  if (!arms?.length) return null;
  const name = ts.isPropertyAccessExpression(access) ? access.name.text : elementKey!;
  const loc = locOf(access);
  // Each arm's slot type and its write; null for a unit arm.
  const slots: ({ type: IrType; write: (obj: IrExpr, value: IrExpr) => IrStmt } | null)[] = [];
  for (const arm of arms) {
    if (arm.kind === "undefinedT" || arm.kind === "nullT") {
      slots.push(null);
      continue;
    }
    if (arm.kind === "record") {
      const field = lowerer.shapes.get(arm.shapeId)?.fields.find((f) => f.name === name);
      if (!field) return null;
      slots.push({ type: field.type, write: (obj, value) => ({ kind: "recordSet", obj, shapeId: arm.shapeId, field: name, value, loc }) });
      continue;
    }
    if (arm.kind !== "object") return null;
    const info = lowerer.classes.get(arm.className);
    if (!info) return null;
    const setter = lowerer.findMethodOn(info, `set:${name}`);
    const classField = info.fields.get(name);
    if (setter) {
      const param = setter.sig.params[0];
      if (!param) return null;
      slots.push({ type: param.type, write: (obj, value) => ({ kind: "exprStmt", expr: lowerer.accessorCall(arm.className, `set:${name}`, obj, [value], VOID, loc), loc }) });
    } else if (classField !== undefined && !lowerer.findMethodOn(info, `get:${name}`)) {
      slots.push({ type: classField, write: (obj, value) => ({ kind: "fieldSet", obj, className: arm.className, field: name, value, loc }) });
    } else {
      return null;
    }
  }
  const present = slots.filter((slot) => slot !== null);
  if (present.length === 0) return null;
  // One slot type: the value is stored as is. Otherwise (a narrower record
  // held by reference: `label: string` behind `label?: string`) the value is
  // the declared type, narrowed (checked) into each slot that holds one arm
  // of it; a write the narrower slot cannot hold throws TypeError.
  let fieldType: IrType = present[0]!.type;
  const fields: (((obj: IrExpr, value: IrExpr) => IrStmt) | null)[] = [];
  const unitType: IrType | null = unitRhs === "undefined" ? UNDEFINED_T : unitRhs === "null" ? NULL_T : null;
  if (present.every((slot) => typeEquals(slot.type, fieldType))) {
    for (const slot of slots) fields.push(slot ? slot.write : null);
  } else if (unitType !== null && present.every((slot) => slot.type.kind === "union" && lowerer.armTag(slot.type.unionId, unitType) >= 0)) {
    // `o.f = undefined` over arms whose optional `f` holds different element types: the unit lifts
    // into each slot's own union (no value of the differing arm types is involved).
    fieldType = unitType;
    for (const slot of slots) {
      if (!slot) {
        fields.push(null);
      } else {
        const slotType = slot.type;
        fields.push((obj, value) => slot.write(obj, lowerer.coerceToExpected(value, slotType)));
      }
    }
  } else {
    // An element write's own checker type is the generic access (`UI[K]`);
    // the key's declared property type is the same type once K is bound.
    const keyed = ts.isElementAccessExpression(access)
      ? lowerer.checker.getPropertyOfType(lowerer.typeOf(access.expression), name)
      : undefined;
    const declared = lowerer.mapTypeOf(keyed ? lowerer.checker.getTypeOfSymbol(keyed) : lowerer.typeOf(access));
    if (!declared) return null;
    fieldType = declared;
    for (const slot of slots) {
      if (!slot) {
        fields.push(null);
      } else if (typeEquals(slot.type, declared)) {
        fields.push(slot.write);
      } else {
        const helper = declared.kind !== "union" ? null
          : slot.type.kind === "union" ? subUnionNarrowHelper(lowerer, declared.unionId, slot.type.unionId, loc)
            : lowerer.narrowedArmHelper(declared.unionId, slot.type, loc);
        if (!helper) return null;
        const slotType = slot.type;
        fields.push((obj, value) => slot.write(obj, { kind: "call", callee: helper, args: [value], type: slotType, loc }));
      }
    }
  }
  const dispatch = (objectRef: IrExpr, storedRef: IrExpr): IrStmt[] => {
    let chain: IrStmt[] = [];
    for (let tag = fields.length - 1; tag >= 0; tag--) {
      const field = fields[tag];
      const write: IrStmt = field ? field(
        { kind: "unionNarrow", unionId, tag, value: objectRef, type: arms[tag]!, loc },
        storedRef,
      ) : {
        kind: "exprStmt",
        expr: nodeThrowExpr(1, "", `Cannot set properties of ${arms[tag]!.kind === "nullT" ? "null" : "undefined"} (setting '${name}')`, VOID, loc), loc,
      };
      chain = tag === fields.length - 1 ? [write] : [{
        kind: "if",
        cond: { kind: "unionIsTag", unionId, tag, value: objectRef, negated: false, type: BOOL, loc },
        then: [write], else_: chain, loc,
      }];
    }
    return chain;
  };
  return { receiver, fieldType, name, loc, dispatch };
}

/** The checked narrowing of the declared type's union into a narrower slot union (an optional
 * property written through a view whose slot is required): every arm the slot holds re-tags, and
 * an arm it cannot hold (the `undefined` of the optional) throws TypeError, as a narrower slot's
 * write does. Null when the slot holds an arm the declared union lacks. */
function subUnionNarrowHelper(lowerer: Lowerer, declaredId: string, slotId: string, loc: ReturnType<typeof locOf>): string | null {
  const declaredArms = lowerer.unions.get(declaredId)?.arms;
  const slotArms = lowerer.unions.get(slotId)?.arms;
  if (!declaredArms || !slotArms || !slotArms.every((arm) => lowerer.armTag(declaredId, arm) >= 0)) return null;
  const stranded = new Set<number>();
  declaredArms.forEach((arm, tag) => { if (!slotArms.some((held) => typeEquals(held, arm))) stranded.add(tag); });
  return lowerer.unionRetagHelper(declaredId, slotId, loc, stranded.size > 0 ? stranded : undefined);
}
