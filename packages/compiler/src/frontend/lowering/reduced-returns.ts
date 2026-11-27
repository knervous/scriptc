/* Inferred return types that TypeScript's subtype reduction narrowed below
 * the record values a function actually returns (upstream 15cc7310ac,
 * function-returns.ts there). */
import * as ts from "../ts7/adapter.js";
import type { IrType } from "../../ir/ir.js";
import { sortArms, typeKey } from "../../ir/ir.js";
import { isJsSourceFile } from "../program.js";
import type { Lowerer } from "./lowerer.js";

const widening = new Set<ts.Node>();

function recordFields(lowerer: Lowerer, t: IrType): readonly string[] | null {
  if (t.kind !== "record") return null;
  const shape = lowerer.shapes.get(t.shapeId);
  return shape === undefined || shape.tuple || shape.indexValue !== undefined ? null : shape.fields.map((f) => f.name);
}

/** Whether `wide`'s fields strictly include `narrow`'s (both plain records). */
function widerRecord(lowerer: Lowerer, wide: IrType, narrow: IrType): boolean {
  const own = recordFields(lowerer, wide);
  const fields = recordFields(lowerer, narrow);
  return own !== null && fields !== null && fields.length < own.length && fields.every((f) => own.includes(f));
}

/** An inferred return type is the checker's SUBTYPE-REDUCED union of the
 * returned values' types: `return aborted` (`{ status }`) beside `return
 * outcome()` (`{ status } | { status, value }`) infers just `{ status }`.
 * Records have fixed layouts, so that type cannot hold the wider value: the
 * return would fail the union wrap. A function whose return type is
 * inferred therefore returns the union of the record types it actually
 * returns. Declared return types keep their meaning. */
export function widenReducedReturn(lowerer: Lowerer, decl: ts.SignatureDeclaration, retTsType: ts.Type, mapped: IrType): IrType {
  if (decl.type !== undefined) return mapped;
  // Fork: JavaScript keeps its own inferred-record rule (a dynamic ABI).
  const sf = decl.getSourceFile();
  if (isJsSourceFile(sf) || sf.isDeclarationFile) return mapped;
  const body = (decl as { body?: ts.Node }).body;
  if (body === undefined || (decl as { asteriskToken?: ts.Node }).asteriskToken !== undefined) return mapped;
  if (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return mapped;
  // A function expression with a contextual signature returns that
  // signature's type; only free-standing inference is widened.
  if ((ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) && lowerer.checker.getContextualType(decl) !== undefined) return mapped;
  const arms = mapped.kind === "union" ? (lowerer.unions.get(mapped.unionId)?.arms ?? []) : [mapped];
  const recordArms = arms.filter((a) => a.kind === "record");
  if (recordArms.length === 0 || widening.has(decl)) return mapped;
  const checkerArms = new Set<ts.Type>(retTsType.isUnionType() ? ts.constituentTypes(retTsType) : [retTsType]);
  const narrower = (part: IrType): boolean =>
    !arms.some((a) => typeKey(a) === typeKey(part)) && recordArms.some((arm) => widerRecord(lowerer, part, arm));
  const extra = new Map<string, IrType>();
  const returned = (expr: ts.Expression): void => {
    // A call of another inferred function returns ITS widened type.
    const resolved = ts.isCallExpression(expr) ? lowerer.checker.getResolvedSignature(expr) : undefined;
    const callee = resolved ? lowerer.checker.signatureDeclaration(resolved) : undefined;
    if (callee !== undefined && ts.isFunctionLike(callee) && (callee as { body?: ts.Node }).body !== undefined && callee.type === undefined) {
      let t: IrType | null = null;
      widening.add(decl);
      try {
        t = lowerer.declaredReturnType(callee, expr);
      } catch {
        t = null;
      } finally {
        widening.delete(decl);
      }
      if (t === null) return;
      const parts = t.kind === "union" ? (lowerer.unions.get(t.unionId)?.arms ?? []) : [t];
      for (const part of parts) if (narrower(part)) extra.set(typeKey(part), part);
      return;
    }
    // Only a value type the checker's reduction dropped from the inferred
    // union is a candidate; a constituent of the inferred type is already
    // represented by it.
    const valueType = lowerer.typeOf(expr);
    for (const part of valueType.isUnionType() ? ts.constituentTypes(valueType) : [valueType]) {
      if (checkerArms.has(part) || !(part.flags & ts.TypeFlags.Object)) continue;
      if (!lowerer.checker.isTypeAssignableTo(part, retTsType)) continue;
      const t = lowerer.mapTypeOf(part);
      if (t !== null && narrower(t)) extra.set(typeKey(t), t);
    }
  };
  const scan = (node: ts.Node): void => {
    if (node !== decl && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) returned(node.expression);
    ts.forEachChild(node, scan);
  };
  if (ts.isArrowFunction(decl) && !ts.isBlock(body)) returned(body as ts.Expression);
  else scan(body);
  if (extra.size === 0) return mapped;
  const joined = new Map<string, IrType>();
  for (const a of [...arms, ...extra.values()]) joined.set(typeKey(a), a);
  const sorted = sortArms([...joined.values()]);
  const unionId = lowerer.unions.intern(sorted);
  lowerer.widenedReturns.add(unionId);
  return { kind: "union", unionId };
}

/** Whether `wide` is a widened inferred return that holds `narrow`'s arms
 * plus records that are width subtypes of `narrow`'s record arms: the shape
 * a subtype-reduced inferred type takes next to the values it was inferred
 * from. */
export function widensReducedRecords(lowerer: Lowerer, narrow: IrType, wide: IrType): boolean {
  if (wide.kind !== "union" || typeKey(narrow) === typeKey(wide)) return false;
  if (!lowerer.widenedReturns.has(wide.unionId)) return false;
  const narrowArms = narrow.kind === "union" ? (lowerer.unions.get(narrow.unionId)?.arms ?? []) : [narrow];
  const wideArms = lowerer.unions.get(wide.unionId)?.arms ?? [];
  const keys = new Set(wideArms.map(typeKey));
  if (!narrowArms.every((a) => keys.has(typeKey(a)))) return false;
  const narrowKeys = new Set(narrowArms.map(typeKey));
  const extras = wideArms.filter((a) => !narrowKeys.has(typeKey(a)));
  return extras.length > 0 && extras.every((extra) => narrowArms.some((arm) => widerRecord(lowerer, extra, arm)));
}

/** Whether `arm` is a record whose fields strictly include those of the
 * record `target`: a value of the target type under structural typing. */
export function isWidthSubtypeRecord(lowerer: Lowerer, arm: IrType, target: IrType): boolean {
  return arm.kind === "record" && target.kind === "record" && widerRecord(lowerer, arm, target);
}
