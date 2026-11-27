import { BOOL, isUnitType, typeEquals } from "../../ir/ir.js";
import type { IrExpr, IrType } from "../../ir/ir.js";
import { isSafeToRepeat } from "./expressions/evaluation-safety.js";
import { nodeThrowExpr, type Lowerer } from "./lowerer.js";

/** A checked extraction found a value arm other than the one the checker promised (a narrowing the program invalidated before the read). */
export const OTHER_ARM_FAILURE_MESSAGE =
  "a value of another type is not representable in the target union (a value narrowed or asserted past it still held it)";

/** The checked extraction of union arm `tag`, in place: the arm's payload when the tag matches, otherwise the TypeError of the consuming
 * operation (`messageFor` names Node's error for finding another arm, e.g. `o.f is not a function`, or null for the stranded-value
 * message). Null when the operand cannot be evaluated more than once.
 *
 * The failure path stays small for wide unions: arms are grouped by their message (every non-nullish arm without its own shares one), so it
 * tests at most the null and undefined arms before a final throw. */
export function checkedArmExtraction(
  lowerer: Lowerer,
  value: IrExpr,
  tag: number,
  arm: IrType,
  messageFor: (found: IrType) => string | null,
): IrExpr | null {
  if (value.type.kind !== "union" || !isSafeToRepeat(value)) return null;
  const unionId = value.type.unionId;
  const from = lowerer.unions.get(unionId);
  const stored = from?.arms[tag];
  if (!from || from.arms.length < 2 || !stored || !typeEquals(stored, arm)) return null;
  const loc = value.loc;
  const isTag = (t: number): IrExpr => ({ kind: "unionIsTag", unionId, tag: t, negated: false, value, type: BOOL, loc });
  const groups = new Map<string, number[]>();
  from.arms.forEach((found, t) => {
    if (t === tag) return;
    const message = messageFor(found) ?? `${isUnitType(found) ? (found.kind === "undefinedT" ? "undefined" : "null") : `a '${lowerer.fmt(found)}' value`} is not representable in the target union (a value narrowed or asserted past it still held it)`;
    const tags = groups.get(message);
    if (tags) tags.push(t);
    else groups.set(message, [t]);
  });
  // The largest group needs no test of its own: it is whatever remains.
  const ordered = [...groups].sort((a, b) => a[1].length - b[1].length);
  const [lastMessage] = ordered.pop()!;
  let failure: IrExpr = nodeThrowExpr(1, "", lastMessage, arm, loc);
  for (const [message, tags] of ordered.reverse()) {
    let cond = isTag(tags[0]!);
    for (const t of tags.slice(1)) cond = { kind: "logical", op: "||", left: cond, right: isTag(t), type: BOOL, loc };
    failure = { kind: "ternary", cond, then: nodeThrowExpr(1, "", message, arm, loc), else_: failure, type: arm, loc };
  }
  return { kind: "ternary", cond: isTag(tag), then: { kind: "unionNarrow", unionId, tag, value, type: arm, loc }, else_: failure, type: arm, loc };
}
