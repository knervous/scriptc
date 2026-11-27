// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { keyedHelperName } from "../stable-names.js";
import { pathModuleValue } from "../lower-builtin-values.js";
import { InternalCompilerError } from "../../../errors.js";
import * as ts from "../../ts7/adapter.js";
import {
  BOOL,
  DYN,
  F64,
  JSVAL,
  STRING,
  UNDEFINED_T,
  VOID,
  arrayOf,
  canDynCheckTo,
  isUnitType,
  shapeHasAccessorSlots,
  typeEquals,
} from "../../../ir/ir.js";
import type { IrExpr, IrLocal, IrRecordShape, IrStmt, IrType, SrcLoc } from "../../../ir/ir.js";
import { isCjsExportTableLiteral, isJsSourceFile, locOf } from "../../program.js";
import { NARROW_FIRST } from "../surfaces.js";
import { browserTarget, nativeDyn } from "../../browser-target.js";
import { lowerIslandObjectLiteral } from "../lower-island.js";
import { recordShapeMismatchDiag } from "../../../diagnostics/diagnostic.js";
import { PoisonError, dynUndefinedExpr, neverTaintedJsType } from "../lowerer.js";
import type { Lowerer } from "../lowerer.js";
import { lowerIndexMergeHelper } from "../lower-containers.js";
import { omittedArgFor } from "../lower-calls.js";
import type { IndexMergeContributor } from "../lower-containers.js";
import { isGenericCallableMemberType, jsOpenObjectType } from "../../type-mapper.js";
import { numLit, strLit, varRef } from "../../../ir/build.js";
import { isSafeToRepeat } from "./evaluation-safety.js";
import { tryLowerExpression } from "./try-lower-expression.js";
import { fenceSymbolFieldCopy } from "../symbol-fields.js";
import { planUnionRetag } from "../union-retag.js";

/** `{ a: 1, b: "x" }` → recordLit. The record type comes from the
 * contextual type when tsc has one (annotated declarations, arguments,
 * nested literals) and from the literal's own type otherwise — both intern
 * to the same shapeId unless width subtyping is in play (an `as` cast can
 * smuggle a wider/narrower literal past tsc's freshness check), which the
 * exact-shape checks below reject with SC2002. Fields lower IN SOURCE
 * ORDER: JS evaluates property values in source order. */
/** The dropped-field names of the PromiseSettledResult honest subset
 * (SEMANTICS.md 46): when the literal's target type is (a union
 * containing) the lib's PromiseFulfilledResult / PromiseRejectedResult,
 * the record mapping kept only `status` — `value` and `reason` evaluate
 * for effect and are not stored. Null for every other target. */
function settledDropNames(lowerer: Lowerer, tsType: ts.Type): Set<string> | null {
  let names: Set<string> | null = null;
  const parts: readonly ts.Type[] = tsType.isUnionType() ? ts.constituentTypes(tsType) : [tsType];
  for (const part of parts) {
    const sym = part.getSymbol();
    if (
      !sym ||
      !lowerer.checker.declarationsOf(sym).some(
        (d) => ts.isInterfaceDeclaration(d) && lowerer.isStdlibFile(d.getSourceFile()),
      )
    ) {
      continue;
    }
    // Browser target: PromiseRejectedResult carries `reason` (dyn) and a fulfilled
    // value with a field representation carries `value`; only a void/unit fulfilled
    // value still drops. Elsewhere (no checked-dynamic slot for `reason`) both drop
    // to the honest { status } subset, as before.
    if (sym.name === "PromiseFulfilledResult" || (!browserTarget() && sym.name === "PromiseRejectedResult")) {
      if (names === null) names = new Set();
      names.add(sym.name === "PromiseFulfilledResult" ? "value" : "reason");
    }
  }
  return names;
}

/** `{ [KEY]: v }` where KEY is a compile-time-known string or number:
 * the key folds into an ordinary (spelled) property name — the record
 * shape is exactly what tsc computed for the literal (the late-bound
 * name IS the checker's literal type), so the fold is just spelling.
 * PURE key forms only, so skipping the key's evaluation is exact (JS
 * evaluates the key before the value; effectful expressions keep the
 * fence): any side-effect-free expression — identifiers, property
 * chains with no accessor on them (enum members, `other.name` reads),
 * literals, parenthesized/as-wrapped forms, operators over those —
 * whose checker type is ONE string or number literal (or a union whose
 * arms all spell the same name — `E1.x || E2.x` where both are 0).
 * Number keys take JS's canonical spelling (`{ [E.member]: v }` stores
 * "0" — ToPropertyKey), exactly the name tsc late-bound. Templates
 * fold structurally span by span as well (a template of literals whose
 * checker type widened still spells one string). Symbol-typed and
 * runtime-valued keys stay out. */
function literalComputedKey(lowerer: Lowerer, name: ts.ComputedPropertyName): string | null {
  return foldedStringKeyOf(lowerer, name.expression);
}

/** The names of a computed key whose checker type is a UNION of two or more
 * string literals (`field: 'a' | 'b'`): which of them it is stays a runtime
 * fact, so each name's slot takes `key === name ? value : earlier`. Null for
 * every other key. */
function literalUnionKeyNames(lowerer: Lowerer, name: ts.ComputedPropertyName): string[] | null {
  const t = lowerer.typeOf(name.expression);
  if (!t.isUnionType()) return null;
  const names: string[] = [];
  for (const arm of ts.constituentTypes(t)) {
    if (!arm.isStringLiteralType()) return null;
    names.push(arm.value);
  }
  return names.length >= 2 ? names : null;
}

export function foldedStringKeyOf(lowerer: Lowerer, expr: ts.Expression): string | null {
  if (ts.isParenthesizedExpression(expr)) return foldedStringKeyOf(lowerer, expr.expression);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) {
    // Structural fold first — exact even where the checker widened the
    // template's own type; the general type-directed fold below is the
    // fallback (a template the checker DID type as one literal).
    let out = expr.head.text;
    let folded = true;
    for (const span of expr.templateSpans) {
      const part = foldedStringKeyOf(lowerer, span.expression);
      if (part === null) {
        folded = false;
        break;
      }
      out += part + span.literal.text;
    }
    if (folded) return out;
  }
  // The general fold: a PURE expression whose checker type spells one
  // property name. An as-cast folds by its OWN checker type — that is
  // the name tsc late-bound the property under, so shape and storage
  // stay one name (the standard trust-the-checker bet); a cast that
  // WIDENS to string un-late-binds the property, its type is no literal,
  // and the fence stays.
  if (!pureKeyExpr(lowerer, expr)) return null;
  return literalKeySpellingOf(lowerer.typeOf(expr));
}

/** The property-name spelling of a single-literal checker type: string
 * literals directly, number literals in JS's canonical ToString spelling
 * (enum members included — their literal flags carry the value), and
 * unions whose arms all spell the SAME name (`E1.x || E2.x` — two enum
 * literal types, one value). Null for everything else. */
function literalKeySpellingOf(t: ts.Type): string | null {
  if (t.isStringLiteralType()) return t.value;
  if (t.isNumberLiteralType()) return String(t.value);
  if (t.isUnionType()) {
    let out: string | null = null;
    for (const arm of ts.constituentTypes(t)) {
      const s = arm.isStringLiteralType() ? arm.value : arm.isNumberLiteralType() ? String(arm.value) : null;
      if (s === null || (out !== null && s !== out)) return null;
      out = s;
    }
    return out;
  }
  return null;
}

/** True iff evaluating `expr` can have no observable effect, so a fold
 * may skip it: literals, identifier reads, property chains whose every
 * member is a plain field/enum member (an accessor anywhere on the chain
 * is a call), operators and casts over those. Calls, `new`, assignments,
 * and element accesses stay impure. */
function pureKeyExpr(lowerer: Lowerer, expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) return pureKeyExpr(lowerer, expr.expression);
  if (ts.isAsExpression(expr) || ts.isTypeAssertion(expr)) return pureKeyExpr(lowerer, expr.expression);
  if (ts.isIdentifier(expr)) return true;
  if (ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr)) return true;
  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword ||
      expr.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPropertyAccessExpression(expr)) {
    const sym = lowerer.checker.getSymbolAtLocation(expr.name);
    if (sym && sym.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) return false;
    return pureKeyExpr(lowerer, expr.expression);
  }
  if (ts.isPrefixUnaryExpression(expr) &&
      (expr.operator === ts.SyntaxKind.MinusToken || expr.operator === ts.SyntaxKind.PlusToken ||
       expr.operator === ts.SyntaxKind.ExclamationToken || expr.operator === ts.SyntaxKind.TildeToken)) {
    return pureKeyExpr(lowerer, expr.operand);
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    const pureOp =
      op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      (op >= ts.SyntaxKind.LessThanToken && op <= ts.SyntaxKind.CaretToken &&
        op !== ts.SyntaxKind.InstanceOfKeyword && op !== ts.SyntaxKind.InKeyword);
    return pureOp && pureKeyExpr(lowerer, expr.left) && pureKeyExpr(lowerer, expr.right);
  }
  if (ts.isConditionalExpression(expr)) {
    return pureKeyExpr(lowerer, expr.condition) && pureKeyExpr(lowerer, expr.whenTrue) && pureKeyExpr(lowerer, expr.whenFalse);
  }
  if (ts.isTemplateExpression(expr)) return expr.templateSpans.every((s) => pureKeyExpr(lowerer, s.expression));
  return false;
}

/** A property's field name: identifier/string-literal keys directly,
 * foldable computed keys through literalComputedKey (the syntax pass
 * fenced everything else). */
function propNameText(lowerer: Lowerer, name: ts.PropertyName): string {
  if (ts.isComputedPropertyName(name)) {
    const k = literalComputedKey(lowerer, name);
    if (k === null) throw new InternalCompilerError("lowerer bug: unfoldable computed key past the fence");
    return k;
  }
  // Numeric literals name their canonical string key (JS's ToPropertyKey
  // — the same name the checker gives the property symbol).
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  return (name as ts.Identifier | ts.StringLiteral).text;
}

/** The runtime-keyed JS object literal (a computed key that doesn't fold):
 * builds a dyn object member-by-member. Keys evaluate before their values,
 * properties in source order — JS's object-literal evaluation exactly.
 * Identifier/string keys are compile-time strings; numeric keys take
 * their canonical number string (`{ 0x10: v }` stores "16" — JS's
 * ToPropertyKey); computed keys evaluate and pass through ToString (the
 * dyn's String() for dyn operands — `{ [field]: v }` where field is a
 * checked-dynamic param). Values convert through the usual dyn boundary
 * (dynFrom's domain, functions box); a value with no dyn representation
 * fences per property. Spreads create own data properties in source order;
 * accessors retain their captured getter and setter closures. */
export function lowerDynObjectLiteral(
  lowerer: Lowerer,
  expr: ts.ObjectLiteralExpression,
  boxValue?: (node: ts.Expression, value: IrExpr) => IrExpr,
): IrExpr {
  const loc = locOf(expr);
  let fields: { key: IrExpr; value: IrExpr }[] = [];
  let acc: IrExpr | null = null;
  let hasAccessors = false;
  const flushFields = (): void => {
    if (fields.length === 0) return;
    if (hasAccessors) {
      for (const field of fields) {
        const descriptor: IrExpr = { kind: "dynObjLit", type: DYN, loc, fields: [
          { key: { kind: "strLit", value: "value", type: STRING, loc }, value: field.value },
          ...["writable", "enumerable", "configurable"].map(name => ({
            key: strLit(name, loc),
            value: { kind: "dynFrom", value: { kind: "boolLit", value: true, type: BOOL, loc }, type: DYN, loc } as IrExpr,
          })),
        ] };
        acc = { kind: "libCall", fn: "dyn.defineProperty", args: [acc!, lowerer.coerceToExpected(field.key, DYN), descriptor], type: DYN, loc };
      }
      fields = [];
      return;
    }
    const chunk: IrExpr = { kind: "dynObjLit", fields, type: DYN, loc };
    acc = acc === null
      ? chunk
      : { kind: "libCall", fn: "dyn.assign", args: [acc, chunk], type: DYN, loc };
    fields = [];
  };
  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop) && !ts.isComputedPropertyName(prop.name) && prop.name.text === "__proto__") {
      flushFields();
      acc ??= { kind: "dynObjLit", fields: [], type: DYN, loc };
      if (prop.initializer.kind === ts.SyntaxKind.NullKeyword) {
        acc = { kind: "libCall", fn: "dyn.setPrototype", args: [acc, lowerer.lowerExprExpecting(prop.initializer, DYN)], type: DYN, loc: locOf(prop) };
        continue;
      }
      // `__proto__: v` sets the prototype when v is an object or null and is
      // otherwise ignored: the __proto__ accessor's rule (dyn.keySet).
      if (!nativeDyn()) lowerer.unsupported("SC1090", prop, "object-literal prototypes other than null (use Object.setPrototypeOf)");
      const tmp = lowerer.declareHiddenLocal("%protoLiteral", DYN), ploc = locOf(prop);
      const ref: IrExpr = { kind: "varRef", localId: tmp.id, type: DYN, loc: ploc };
      acc = { kind: "seqExpr", stmts: [{ kind: "varDecl", localId: tmp.id, init: acc, loc: ploc },
        { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySet", args: [ref, { kind: "strLit", value: "__proto__", type: STRING, loc: ploc }, lowerer.lowerExprExpecting(prop.initializer, DYN)], type: VOID, loc: ploc }, loc: ploc }],
        result: ref, type: DYN, loc: ploc };
      continue;
    }
    if (ts.isSpreadAssignment(prop)) {
      flushFields();
      const builtin = lowerer.builtinNamespaceModuleOf(prop.expression);
      const raw = builtin === "path" || builtin === "path/posix" || builtin === "path/win32"
        ? pathModuleValue(lowerer, builtin === "path" ? "path/posix" : builtin, locOf(prop))
        : isJsSourceFile(expr.getSourceFile())
          ? lowerer.lowerExprExpecting(prop.expression, DYN)
          : lowerer.lowerExpr(prop.expression);
      fenceSymbolFieldCopy(lowerer, prop.expression, raw.type);
      const source = boxValue
        ? boxValue(prop.expression, raw)
        : lowerer.coerceToExpected(raw, DYN);
      if (source.type.kind !== "dyn") {
        lowerer.unsupported("SC1101", prop.expression, `spreading '${lowerer.fmt(source.type)}' into a checked-dynamic object literal`);
      }
      acc ??= { kind: "dynObjLit", fields: [], type: DYN, loc };
      acc = { kind: "libCall", fn: "dyn.copyDataProperties", args: [acc, source], type: DYN, loc: locOf(prop) };
      continue;
    }
    const name = prop.name;
    let key: IrExpr;
    if (ts.isComputedPropertyName(name)) {
      const folded = literalComputedKey(lowerer, name);
      if (folded !== null) {
        key = { kind: "strLit", value: folded, type: STRING, loc: locOf(name) };
      } else {
        let k = lowerer.lowerExpr(name.expression);
        if (k.type.kind === "union" && lowerer.dynConvertible(k.type)) k = lowerer.coerceToExpected(k, DYN);
        // A page value (TS any in a JavaScript file): its ToPropertyKey, like an untyped key.
        if (k.type.kind === "jsval" && nativeDyn()) k = lowerer.coerceToExpected(k, DYN);
        if (k.type.kind === "symbol") k = lowerer.coerceToExpected(k, DYN);
        else if (k.type.kind === "dyn") k = { kind: "libCall", fn: "dyn.propertyKey", args: [k], type: DYN, loc: locOf(name) };
        else if (k.type.kind === "f64" || k.type.kind === "bool") {
          k = { kind: "toString", operand: k, type: STRING, loc: locOf(name) };
        }
        if (k.type.kind !== "string" && k.type.kind !== "dyn") {
          lowerer.unsupported(
            "SC1090",
            name,
            `'${lowerer.fmt(k.type)}'-typed computed property keys (string, number, boolean, and unknown keys stringify)`,
          );
        }
        key = k;
      }
    } else if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      key = { kind: "strLit", value: name.text, type: STRING, loc: locOf(name) };
    } else if (ts.isNumericLiteral(name)) {
      key = { kind: "strLit", value: String(Number(name.text)), type: STRING, loc: locOf(name) };
    } else {
      lowerer.unsupported("SC1090", prop, "non-identifier property names");
    }
    if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
      flushFields();
      hasAccessors = true;
      acc ??= { kind: "dynObjLit", fields: [], type: DYN, loc };
      if (!isJsSourceFile(expr.getSourceFile())) lowerer.rejectThisInObjectMethod(prop.body ?? prop);
      const fn = lowerer.lowerLambda(prop);
      const descriptor: IrExpr = {
        kind: "dynObjLit", type: DYN, loc: locOf(prop), fields: [
          { key: { kind: "strLit", value: ts.isGetAccessorDeclaration(prop) ? "get" : "set", type: STRING, loc }, value: lowerer.coerceToExpected(fn, DYN) },
          ...["enumerable", "configurable"].map(name => ({
            key: strLit(name, loc),
            value: { kind: "dynFrom", value: { kind: "boolLit", value: true, type: BOOL, loc }, type: DYN, loc } as IrExpr,
          })),
        ],
      };
      acc = { kind: "libCall", fn: "dyn.defineProperty", args: [acc, lowerer.coerceToExpected(key, DYN), descriptor], type: DYN, loc };
      continue;
    }
    const valueExpr: ts.Node = ts.isMethodDeclaration(prop)
      ? prop
      : ts.isShorthandPropertyAssignment(prop)
        ? (prop.name as ts.Identifier)
        : prop.initializer;
    // Lambda values that fail to lower become trap closures (the
    // per-call fence granularity — fenceClosureProbe) so the object
    // still builds; everything else keeps the per-property fence below.
    let raw: IrExpr;
    const propDiagsBefore = lowerer.diags.length;
    try {
      const lowerValue = (): IrExpr =>
        ts.isMethodDeclaration(prop)
          ? (isJsSourceFile(expr.getSourceFile()) ? lowerer.lowerLambda(prop) : (lowerer.rejectThisInObjectMethod(prop.body ?? prop), lowerer.lowerLambda(prop)))
          : !boxValue && ts.isObjectLiteralExpression(valueExpr)
            ? lowerer.lowerExprExpecting(valueExpr, DYN)
            : lowerer.lowerExpr(valueExpr as ts.Expression);
      raw =
        fenceClosureProbe(lowerer, valueExpr, undefined, lowerValue) ??
        lowerValue();
    } catch (err) {
      // A PURE member read a JS file cannot lower (a namespace object
      // in an export aggregate): the slot takes a boxed fence closure —
      // the diagnostics defer to the runtime-fence ledger, the object
      // builds, and only USING the member stops the run.
      const pureMember = ts.isIdentifier(valueExpr);
      if (!(err instanceof PoisonError) || !pureMember) throw err;
      const fence = lowerer.deferToRuntimeFence(propDiagsBefore, prop, {
        kind: "closure",
        name: () => lowerer.closureName(locOf(prop), "_dynfence"),
        returnType: VOID,
        type: { kind: "func", params: [], ret: VOID },
      });
      if (!fence) throw err;
      raw = fence;
    }
    let v = boxValue
      ? boxValue(valueExpr as ts.Expression, raw)
      : lowerer.coerceToExpected(raw, DYN);
    // A JS object's array-valued properties retain the same source array.
    // Repeated references must compare equal and mutations remain shared.
    if (!boxValue && isJsSourceFile(prop.getSourceFile()) && v.kind === "dynFrom" && v.value.type.kind === "array") {
      v = { ...v, liveRef: true };
    }
    if (v.type.kind !== "dyn") {
      const convDiagsBefore = lowerer.diags.length;
      try {
        lowerer.unsupported(
          "SC1101",
          valueExpr,
          `holding '${lowerer.fmt(v.type)}' values in a runtime-keyed (computed-key) object literal`,
        );
      } catch (err) {
        // A member value the checked-dynamic tree cannot hold — a func whose signature
        // cannot box, an island ('any') handle, a record carrying func
        // fields (the export aggregate's typed utilities and npm-handle
        // members): the same call-time fence deferral as an unlowerable
        // member — the slot takes a boxed fence closure; only USING it
        // stops the run. Probe mode and ICEs keep the poison.
        if (!(err instanceof PoisonError)) throw err;
        const fence = lowerer.deferToRuntimeFence(convDiagsBefore, prop, {
          kind: "closure",
          name: () => lowerer.closureName(locOf(prop), "_dynfence"),
          returnType: VOID,
          type: { kind: "func", params: [], ret: VOID },
        });
        if (!fence) throw err;
        v = lowerer.coerceToExpected(fence, DYN);
      }
    }
    fields.push({ key, value: v });
  }
  flushFields();
  if (acc !== null) return acc;
  return { kind: "dynObjLit", fields: [], type: DYN, loc };
}

/** Spreading a source whose shape carries accessor slots: Node's copy
 * invokes each getter exactly once in insertion order — even for keys a
 * later contributor overrides — while the field-copy desugar assumes pure
 * reads it may drop or reorder. Getter-call counts would silently diverge,
 * so accessor-carrying sources fence by name. */
function fenceAccessorSpreadSource(lowerer: Lowerer, prop: ts.Node, srcShape: IrRecordShape | undefined): void {
if (srcShape && shapeHasAccessorSlots(srcShape)) {
  lowerer.unsupported(
    "SC1090",
    prop,
    "object spread of sources carrying get/set accessor properties (Node invokes each getter once during the copy — the field-copy desugar cannot model the calls; bind the reads to consts first)",
  );
}
}

/** A later spread's field that is always its own property. An optional one (an undefined-armed union, or a dyn or page
 * slot holding the absent value) copies nothing when unset, so the earlier contributor's value must stay. */
function alwaysOwn(lowerer: Lowerer, t: IrType): boolean {
  if (t.kind === "dyn" || t.kind === "jsval" || t.kind === "undefinedT") return false;
  return t.kind !== "union" || lowerer.armTag(t.unionId, UNDEFINED_T) < 0;
}

/** Only definitely present later records replace earlier defaults. A
 * callback binding may store undefined despite its checker annotation. */
function laterSpreadType(lowerer: Lowerer, expr: ts.Expression): IrType | null {
  let source = expr;
  while (ts.isParenthesizedExpression(source)) source = source.expression;
  if (ts.isIdentifier(source)) return lowerer.lowerExpr(source).type;
  // A member read (`saved?.hud` after `saved?.gen === 2 ?`) can be narrowed
  // present by the checker while its storage still holds the nullish arm (a
  // runtime-optional local): the lowered read decides what a later spread
  // is guaranteed to define.
  if (ts.isPropertyAccessExpression(source) || ts.isElementAccessExpression(source)) {
    const lowered = tryLowerExpression(lowerer, source);
    if (lowered) return lowered.type;
  }
  return lowerer.mapTypeOf(lowerer.typeOf(source));
}
/** The JS trap-closure fallback for FUNCTION-VALUED object properties: a
 * lambda whose body fails to lower inside a JS object literal becomes a
 * closure of the field's exact func type whose body is the runtime fence —
 * the object still BUILDS (commander's `_outputConfiguration` table: the
 * driven writeOut/writeErr entries work; an unloweraable color probe traps
 * only if something CALLS it). The failed lambda's diagnostics move to the
 * runtime-fence inventory, exactly like a fenced JS statement. Null when
 * the fallback does not apply (not a JS file, not a lambda, no func slot)
 * — the caller lowers normally. ICEs (SC9001) never convert. */
function fenceClosureProbe(
lowerer: Lowerer,
node: ts.Node,
slotType: IrType | undefined,
attempt: () => IrExpr,
): IrExpr | null {
if (!isJsSourceFile(node.getSourceFile())) return null;
let inner: ts.Node = node;
while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
if (!ts.isArrowFunction(inner) && !ts.isFunctionExpression(inner) && !ts.isMethodDeclaration(inner)) {
  return null;
}
// The trap's ABI: the field's func slot when one exists; otherwise (the
// dyn-object literal path — the value boxes into dyn) the all-dyn
// signature of the lambda's own arity, which canBoxFuncIntoDyn always
// admits.
const fieldType: IrType & { kind: "func" } =
  slotType !== undefined && slotType.kind === "func"
    ? slotType
    : { kind: "func", params: inner.parameters.map(() => DYN), ret: DYN };
if (slotType !== undefined && slotType.kind !== "func") return null;
const diagsBefore = lowerer.diags.length;
try {
  return attempt();
} catch (e) {
  if (!(e instanceof PoisonError)) throw e;
  const params = fieldType.params.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
  const fence = lowerer.deferToRuntimeFence(diagsBefore, node, {
    kind: "closure",
    name: () => lowerer.closureName(locOf(node), "", "%fence.fn"),
    params,
    returnType: fieldType.ret,
    paramsMutable: true,
    type: fieldType,
    fallback: { code: "SC1090", message: "this function's body has no static lowering" },
    bareMessage: true,
    allowDiagSink: true,
  });
  if (!fence) throw e;
  return fence;
}
}

/** The union arm an object LITERAL inhabits when its fields must widen
 * PER FIELD into exactly one record arm — the reducer-action pattern
 * (`{ kind: "a", parsed: 1 }` into `{ kind: "a"; parsed: number | null }
 * | { kind: "b" }`). The IR shapes erased the literal types tsc
 * discriminated on, so the probe runs against the contextual union's
 * CHECKER members: every literal field must exist on the member
 * (excess-property freshness — tsc already enforced it), every arm field
 * missing from the literal must be optional-flavored (an undefined-armed
 * union, or a dyn slot — the absent-completion rule), and each present
 * field's TypeScript type must fit the member's field type — literal against
 * literal decides by VALUE (the discriminant), everything else through the
 * checker. The chosen arm then directs construction of nested literals;
 * probing their inferred IR layout too early can reject the right arm and
 * select a smaller unrelated record that drops fields. Exactly ONE fitting arm
 * answers it; zero or several answer null and the caller keeps its
 * fences. A spread uses the checker's resulting properties so overridden
 * discriminants and narrowed recursive source arms keep their identity.
 * Accessors, methods, and unfoldable computed keys keep their own paths. */
function literalUnionArmOf(
lowerer: Lowerer,
expr: ts.ObjectLiteralExpression,
tsType: ts.Type,
recordArms: (IrType & { kind: "record" })[],
): (IrType & { kind: "record" }) | null {
if (!tsType.isUnionType()) return null;
const props: { name: string; type: ts.Type }[] = [];
let hasSpread = false;
for (const p of expr.properties) {
  if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name)) {
    props.push({ name: propNameText(lowerer, p.name), type: lowerer.typeOf(p.initializer) });
  } else if (ts.isShorthandPropertyAssignment(p) && ts.isIdentifier(p.name)) {
    props.push({ name: p.name.text, type: lowerer.typeOf(p.name) });
  } else if (ts.isSpreadAssignment(p)) {
    hasSpread = true;
  } else {
    return null;
  }
}
if (hasSpread) {
  const own = lowerer.typeOf(expr);
  // Conditional/union spreads need runtime selection, not one guessed arm.
  if (own.isUnionType()) return null;
  props.length = 0;
  for (const property of lowerer.checker.getPropertiesOfType(own)) {
    props.push({ name: property.name, type: lowerer.checker.getTypeOfSymbol(property) });
  }
}
/** Cheap literal discriminants avoid checker traffic for unrelated arms.
 * Compound types need the checker's semantic assignability, including
 * recursive unions, never intersections, and contextual empty arrays. */
const fits = (litT: ts.Type, ftT: ts.Type): boolean => {
  if (ftT.isStringLiteralType()) return litT.isStringLiteralType() && litT.value === ftT.value;
  if (ftT.isNumberLiteralType()) return litT.isNumberLiteralType() && litT.value === ftT.value;
  if (ftT.flags & ts.TypeFlags.BooleanLiteral) {
    return (litT.flags & ts.TypeFlags.BooleanLiteral) !== 0 && lowerer.checker.typeToString(litT) === lowerer.checker.typeToString(ftT);
  }
  if (ftT.flags & ts.TypeFlags.Null) return (litT.flags & ts.TypeFlags.Null) !== 0;
  if (ftT.flags & ts.TypeFlags.Undefined) return (litT.flags & ts.TypeFlags.Undefined) !== 0;
  return lowerer.checker.isTypeAssignableTo(litT, ftT);
};
const armShapeIds = new Set(recordArms.map((a) => a.shapeId));
const candidates = new Set<string>();
for (const member of ts.constituentTypes(tsType)) {
  const mMapped = lowerer.mapTypeOf(member);
  if (mMapped?.kind !== "record" || !armShapeIds.has(mMapped.shapeId) || candidates.has(mMapped.shapeId)) continue;
  const shape = lowerer.shapes.get(mMapped.shapeId);
  if (!shape || shape.tuple || shape.indexValue) continue;
  // Excess-property freshness: every literal field must exist on the
  // member (tsc rejected the others for a fresh literal).
  if (!props.every((p) => lowerer.checker.getPropertyOfType(member, p.name) !== undefined)) continue;
  // Arm fields the literal leaves unset must be optional-flavored (the
  // absent-completion rule: an undefined-armed union or a dyn slot).
  const names = new Set(props.map((p) => p.name));
  const absentOk = shape.fields.every((f) => {
    if (names.has(f.name)) return true;
    if (f.type.kind === "dyn") return true;
    if (f.type.kind !== "union") return false;
    return lowerer.unions.get(f.type.unionId)?.arms.some((a) => a.kind === "undefinedT") ?? false;
  });
  if (!absentOk) continue;
  const fieldsFit = props.every((p) => {
    const sym = lowerer.checker.getPropertyOfType(member, p.name);
    if (!sym) return false;
    return fits(p.type, lowerer.checker.getTypeOfSymbol(sym));
  });
  if (fieldsFit) candidates.add(mMapped.shapeId);
}
if (candidates.size !== 1) return null;
const [only] = [...candidates];
return recordArms.find((a) => a.shapeId === only) ?? null;
}

/** Object spread treats nullish sources as empty. Preserve evaluation once,
 * then turn `Record<K, V> | undefined` into either that record or a fresh
 * empty record of the same represented shape. */
function lowerOptionalIndexSpreadSource(lowerer: Lowerer, source: IrExpr, loc: SrcLoc): IrExpr | null {
if (source.type.kind !== "union") return null;
const def = lowerer.unions.get(source.type.unionId);
if (!def || def.arms.length !== 2) return null;
const undefinedTag = def.arms.findIndex((arm) => arm.kind === "undefinedT");
const recordTag = def.arms.findIndex((arm) => arm.kind === "record");
if (undefinedTag < 0 || recordTag < 0) return null;
const recordType = def.arms[recordTag]!;
if (recordType.kind !== "record") return null;

const prefix: IrStmt[] = [];
let stable = source;
if (!isSafeToRepeat(source)) {
  const local = lowerer.declareHiddenLocal("%spread", source.type);
  prefix.push({ kind: "varDecl", localId: local.id, init: source, loc });
  stable = varRef(local.id, source.type, loc);
}
const selected: IrExpr = {
  kind: "ternary",
  cond: { kind: "unionIsTag", unionId: source.type.unionId, tag: undefinedTag, negated: false, value: stable, type: BOOL, loc },
  then: { kind: "recordLit", fields: [], type: recordType, loc },
  else_: { kind: "unionNarrow", unionId: source.type.unionId, tag: recordTag, value: stable, type: recordType, loc },
  type: recordType,
  loc,
};
return prefix.length === 0 ? selected : { kind: "seqExpr", stmts: prefix, result: selected, type: recordType, loc };
}

export function lowerObjectLiteral(lowerer: Lowerer, expr: ts.ObjectLiteralExpression,
  expected?: IrType & { kind: "record" },): IrExpr {
  // Unannotated JavaScript accumulator fields have no element contract.
  // Preserve their checked arrays instead of assigning never[] a numeric ABI.
  if (!expected && isJsSourceFile(expr.getSourceFile()) && expr.properties.some((prop) =>
      ts.isPropertyAssignment(prop) && (ts.isArrayLiteralExpression(prop.initializer) &&
      prop.initializer.elements.length === 0 || neverTaintedJsType(lowerer, prop.initializer, lowerer.typeOf(prop.initializer))))) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  if (!expected && isJsSourceFile(expr.getSourceFile()) && expr.properties.some((prop) =>
      ts.isPropertyAssignment(prop) && lowerer.mapTypeOf(lowerer.typeOf(prop.initializer))?.kind === "array" &&
      tryLowerExpression(lowerer, prop.initializer)?.type.kind === "dyn")) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // A JS constructor parameter can hold omitted values even when its
  // documentation names a number. Inferred literal fields must preserve
  // the represented binding rather than checking it back into that type.
  if (!expected && isJsSourceFile(expr.getSourceFile()) && expr.properties.some((prop) => {
    let value = ts.isPropertyAssignment(prop) ? prop.initializer
      : ts.isShorthandPropertyAssignment(prop) ? prop.name : null;
    while (value && ts.isParenthesizedExpression(value)) value = value.expression;
    if (!value || !ts.isIdentifier(value)) return false;
    const stored = lowerer.peekLocal(value)?.type ?? lowerer.globalOf(value)?.type;
    const inferred = lowerer.mapTypeOf(lowerer.typeOf(value));
    return stored?.kind === "dyn" && inferred !== null && inferred.kind !== "dyn" && lowerer.dynConvertible(inferred);
  })) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // JavaScript object methods/accessors carry a live receiver. Keep the
  // literal in checked native storage instead of erasing its prototype ABI.
  if (isJsSourceFile(expr.getSourceFile()) && (expr.properties.length === 0 || expr.properties.some((prop) =>
      ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)))) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  const loc = locOf(expr);
  // Module collection already chose checked storage for this JavaScript
  // binding. Construct in that representation: an intermediate record would
  // check nested aliases back into inferred shapes and lose their identity.
  if (isJsSourceFile(expr.getSourceFile()) && ts.isVariableDeclaration(expr.parent) &&
      expr.parent.initializer === expr && ts.isIdentifier(expr.parent.name) &&
      lowerer.globalOf(expr.parent.name)?.type.kind === "dyn") {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // A checked spread carries runtime symbol keys and receiver-sensitive
  // methods absent from its inferred record shape. Copy the real properties.
  if (!expected && isJsSourceFile(expr.getSourceFile()) && expr.properties.some((property) =>
      ts.isSpreadAssignment(property) && (lowerer.builtinNamespaceModuleOf(property.expression)?.startsWith("path") ||
        tryLowerExpression(lowerer, property.expression)?.type.kind === "dyn"))) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // `__proto__: v` (identifier or string key) sets the literal's prototype.
  // A typed record has none: JavaScript literals build as dyn objects (which
  // take a null prototype and refuse others), TypeScript ones are refused
  // rather than given an own `__proto__` field.
  {
    const proto = expr.properties.find((prop) => ts.isPropertyAssignment(prop) && !ts.isComputedPropertyName(prop.name) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && prop.name.text === "__proto__");
    if (proto) {
      if (isJsSourceFile(expr.getSourceFile())) return lowerDynObjectLiteral(lowerer, expr);
      lowerer.unsupported("SC1090", proto, "a `__proto__` key in a typed object literal (a typed record has no prototype; build the object untyped and use Object.setPrototypeOf)");
    }
  }
  // A spread of a HOST value (a React hook's result, slate's element
  // attributes, a DOM dictionary): its keys are the page object's, not the
  // type contract's, so the literal is a page object whose spread copies the
  // host value's own enumerable properties, later keys winning; a typed slot
  // takes the result through the usual checked boundary.
  if (!isJsSourceFile(expr.getSourceFile()) && browserTarget() &&
      expr.properties.some((p) => ts.isSpreadAssignment(p) && tryLowerExpression(lowerer, p.expression)?.type.kind === "jsval")) {
    return lowerIslandObjectLiteral(lowerer, expr);
  }
  const unionClone = lowerUnionRecordClone(lowerer, expr);
  if (unionClone !== null) return unionClone;
  // The RUNTIME-KEYED literal (JS): a computed key that doesn't fold to a
  // compile-time string means the literal's shape is not a compile-time
  // fact — no record shape can hold it. The whole literal builds as a dyn
  // object instead (`{ [field]: criteria, actual: 0, ... }` —
  // test/common's _mustCallInner context), where keys are runtime string
  // values. TypeScript keeps the record world and its fence: this shape
  // only arises in checked-dynamic JS.
  if (
    isJsSourceFile(expr.getSourceFile()) &&
    expr.properties.some(
      (p) => {
        const n = ts.isSpreadAssignment(p) ? undefined : p.name;
        return n !== undefined && ts.isComputedPropertyName(n);
      },
    )
  ) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // Syntax fence FIRST: unsupported member forms get their specific
  // message even when they also make the literal's type unmappable
  // (a getter or a `this`-returning method would otherwise surface as an
  // opaque type fence on the whole literal).
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      // Supported shapes: FULL spreads of known record shapes read as
      // identifiers or other side-effect-free reads, all BEFORE any
      // explicit property (the field-copy desugar reads spread fields
      // first, exactly JS's eager copy order); and CONDITIONAL spreads
      // `...(c ? {k: v} : {})` — the optional-field idiom tsc types as
      // `k?: ...` — which desugar to one conditional field at the
      // spread's own position (any position: they introduce one fresh
      // name, collision-fenced below). Everything else stays fenced.
      const cs = conditionalSpreadArms(prop.expression);
      if (cs === "unsupported") {
        lowerer.unsupported(
          "SC1090",
          prop,
          "conditional spreads outside the idiom `...(c ? { fields } : {})` (one arm a literal of plain members, the other empty, `undefined`, or a record-valued expression)",
        );
      }
      // Spread ORDER is fenced in the field-by-field desugar below, not
      // here: the index-signature merge path supports any order (keyed
      // last-write-wins writes), so `{ K: v, ...extra }` into a pure
      // Record shape compiles — the buildServiceEnv pattern.
      continue;
    }
    if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
      // JavaScript CJS-export tables reach reads through the lifted-
      // accessor path (cjsExportAccessorRead) — the literal VALUE
      // narrows to its plain fields below (accessor names are not
      // record storage; SEMANTICS.md documents the enumeration
      // divergence). TypeScript accessors lower into the shape's
      // reserved closure slots (%get:/%set: — see accessorSlotProp);
      // `this` in the body is fenced up front: the closure slot has no
      // receiver (capturing the record under construction would be an
      // RC cycle), and the generic lexical-this walk would silently
      // capture an ENCLOSING method's `this` — the object-method rule.
      if (!isJsSourceFile(expr.getSourceFile())) {
        rejectThisInObjectAccessor(lowerer, prop.body ?? prop);
      }
    }
    // Unfoldable computed keys are NOT fenced here: an index-signature
    // target lowers them as runtime keyed writes (the merge path below);
    // every other target re-fences them after the merge path declined
    // (fenceUnfoldableComputedKeys).
    // Identifier keys, STRING-LITERAL keys (`"content-type": v` —
    // record field names are data, never C identifiers; the mangler
    // encodes what C can't spell), NUMERIC-LITERAL keys in their
    // canonical string spelling (`{ 0: v }` stores "0", `{ 0x10: v }`
    // stores "16" — JS's ToPropertyKey; the checker names the property
    // symbol the same way), and FOLDABLE computed keys (above).
    if (
      !prop.name ||
      !(
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ||
        ts.isNumericLiteral(prop.name) || ts.isComputedPropertyName(prop.name)
      )
    ) {
      lowerer.unsupported("SC1090", prop, "non-identifier property names");
    }
    // Shorthand methods are just closure-valued fields — but their `this`
    // is dynamically bound (typed as the literal by tsc, so noImplicitThis
    // lets it through) and records don't model it; the generic
    // lexical-this walk would silently capture an ENCLOSING method's
    // `this`, so any `this` in the body is rejected up front.
    if (ts.isMethodDeclaration(prop)) lowerer.rejectThisInObjectMethod(prop.body ?? prop);
  }

  let tsType = lowerer.checker.getContextualType(expr) ?? lowerer.typeOf(expr);
  // An inferred binding pattern supplies placeholders such as
  // { nested: { value: any } }. Construct the literal's own fields so
  // those placeholders do not erase instantiated generic storage.
  if (!expected && ts.isVariableDeclaration(expr.parent) && !expr.parent.type &&
      ts.isObjectBindingPattern(expr.parent.name) && expr.parent.initializer === expr) {
    tsType = lowerer.typeOf(expr);
  }
  // `as never` supplies no construction layout. Keep the literal's own
  // fields so an exhaustiveness witness cannot erase a reachable value.
  if (lowerer.checker.isNeverType(tsType)) tsType = lowerer.typeOf(expr);
  // `lit satisfies T` is TYPE-LEVEL only: the expression's checker type —
  // and therefore the shape every downstream consumer sees — is the
  // literal's OWN type (T still contextually types members, so inferred
  // parameter types flow). Building at T would reshape the value tsc
  // says has the literal's type: `{...} satisfies Movable &
  // Record<string, unknown>` must NOT become an index-signature record.
  // Own type wins whenever it maps to a record; an unmappable own type
  // keeps the contextual fallback (a bare-null field whose satisfies
  // target names the wider slot type).
  {
    let p: ts.Node | undefined = expr.parent;
    while (ts.isParenthesizedExpression(p)) p = p.parent;
    if (ts.isSatisfiesExpression(p)) {
      const own = lowerer.typeOf(expr);
      if (lowerer.mapTypeOf(own)?.kind === "record") tsType = own;
    }
  }
  // An async function's return position types the literal
  // `T | PromiseLike<T>` (the lib's await-unwrapping contract). The
  // PromiseLike arm never maps, and the record the return slot actually
  // holds is exactly the checker's awaited type — strip to it BEFORE the
  // own-type fallback below: the awaited contextual type carries the
  // slot's field types (`lanIp: string | null`), which the literal's own
  // type narrows away (a field written as `lanIp: null` types as bare
  // `null`, which maps to nothing on its own).
  if (tsType.isUnionType() && ts.constituentTypes(tsType).some((t) => t.getSymbol()?.name === "PromiseLike")) {
    tsType = lowerer.checker.getAwaitedType(tsType) ?? tsType;
  }
  let mapped = lowerer.mapTypeOf(tsType);
  // An `unknown`/`any` slot (React's `jsx(type, props: unknown)`) admits any
  // value and supplies no layout: build the literal as its own shape, which
  // the slot then takes through the usual dynamic boundary.
  if (!mapped && !expected && (tsType.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0) {
    const own = lowerer.typeOf(expr);
    const ownMapped = lowerer.mapTypeOf(own);
    if (ownMapped) {
      tsType = own;
      mapped = ownMapped;
    }
  }
  // A checked-dynamic source has runtime keys even when later explicit
  // fields make the literal's inferred type look like a fixed record.
  // Keep a checked-dynamic destination in that representation so copying
  // preserves keys, evaluation order, and fields overwritten afterwards.
  if (mapped?.kind === "dyn" && expr.properties.some((p) =>
    ts.isSpreadAssignment(p) && lowerer.mapTypeOf(lowerer.typeOf(p.expression))?.kind === "dyn")) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // A JavaScript call can contextually type an object literal as string even
  // though the literal itself is a record. Keep its own shape so a caller
  // performing ToString can convert it after the value is built.
  if (mapped?.kind === "string" && isJsSourceFile(expr.getSourceFile())) {
    const own = lowerer.mapTypeOf(lowerer.typeOf(expr));
    if (own?.kind === "record") mapped = own;
  }
  // An EMPTY-record context under a NON-empty literal (`Object.keys({
  // ...process.env })` — the lib's `{}`-typed parameters admit every
  // object): `{}` carries no shape information, so the literal builds as
  // its OWN type, exactly the unmappable-context fallback below. An
  // empty LITERAL keeps the context (the shapes agree).
  if (mapped?.kind === "record" && expr.properties.length > 0) {
    const ctxShape = lowerer.shapes.get(mapped.shapeId);
    if (ctxShape && ctxShape.fields.length === 0 && !ctxShape.indexValue && !ctxShape.tuple) {
      mapped = lowerer.mapTypeOf(lowerer.typeOf(expr)) ?? mapped;
    }
  }
  // A literal with a property the contextual TYPE ITSELF lacks — only
  // reachable through type assertions and satisfies (fresh-literal
  // excess-property checks reject the direct spelling): the context
  // cannot hold the value, so the literal builds at its OWN type and the
  // slot's width coercion narrows it (divergence 36's copy stance — the
  // extra fields drop in the copy). The probe is against the CHECKER's
  // contextual type, not the mapped shape: a property the contextual
  // type carries but the shape dropped (settled value/reason,
  // generic-callable members) belongs to the drop paths below, and
  // index-signature contexts keep every key (overflow capture).
  if (mapped?.kind === "record" && expr.properties.length > 0) {
    const ctxShape = lowerer.shapes.get(mapped.shapeId);
    if (ctxShape && !ctxShape.indexValue && !ctxShape.tuple) {
      const names = new Set(ctxShape.fields.map((f) => f.name));
      const ctxHasProp = (name: string): boolean => {
        const members = tsType.isUnionType() ? ts.constituentTypes(tsType) : [tsType];
        return members.some((m) => lowerer.checker.getPropertyOfType(m, name) !== undefined);
      };
      const extraOf = (text: string): boolean => !names.has(text) && !ctxHasProp(text);
      const extra = expr.properties.some((p) => {
        if (ts.isSpreadAssignment(p) || !p.name) return false;
        if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return extraOf(p.name.text);
        if (ts.isNumericLiteral(p.name)) return extraOf(String(Number(p.name.text)));
        return false; // computed keys keep their existing paths
      });
      if (extra) mapped = lowerer.mapTypeOf(lowerer.typeOf(expr)) ?? mapped;
    }
  }
  // A union-typed slot (`const r: Res = { kind: "ok", ... }`) contextually
  // types the literal as the WHOLE union; build the literal as its own
  // (arm) shape and let the slot's coercion wrap it into the union. An
  // unknown-typed slot (`JSON.stringify({ a: 1 })`) likewise. An
  // UNMAPPABLE context falls back the same way — the literal's own type
  // is the plain record the slot coerces. A CLASS-INSTANCE context
  // (`const p: Point = { x, y }` — tsc's structural view of data
  // classes) falls back too: the literal builds as its own record and
  // the slot's width coercion constructs through the trivial
  // parameter-property constructor (recordToClassPlan), or fences with
  // the record-shape story.
  // A jsval-mapped context reaches here only when lowerExpr's island
  // gate DECLINED it (a project-declared typedef that absorbed to the
  // island through checker-`any` field residue): the literal builds at
  // its own type like every unmappable context.
  // An index-signature literal can inherit a callable contextual type for
  // a prototype-named DATA property (notably `toString`). Object literals
  // have no call signature; construct their own data shape and let the
  // surrounding assignment/assertion enforce the destination contract.
  // A structural type that classes or narrower records flow into
  // (interfaceClassArms) is a union keeping its own record arm: a literal
  // of it builds that record, and the slot's coercion injects it.
  const armsBase = (t: IrType | null): IrType | null => {
    const shapeId = t?.kind === "union" ? lowerer.armsUnionBase.get(t.unionId) : undefined;
    return shapeId ? { kind: "record", shapeId } : t;
  };
  // A literal with get/set accessors standing for the interface's data
  // fields is its OWN record arm (interface-class-arms keeps it apart): build
  // that arm, whose accessor slots hold the closures.
  const accessorArm = (t: IrType | null): IrType | null => {
    if (t?.kind !== "union" || !expr.properties.some((p) => ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))) return null;
    const names = expr.properties.map((p) => {
      if (!p.name) return null;
      const n = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      return n === null ? null : ts.isGetAccessorDeclaration(p) ? `%get:${n}` : ts.isSetAccessorDeclaration(p) ? `%set:${n}` : n;
    });
    if (names.some((n) => n === null)) return null;
    return (lowerer.unions.get(t.unionId)?.arms ?? []).find((arm) => {
      if (arm.kind !== "record") return false;
      const fields = lowerer.shapes.get(arm.shapeId)?.fields ?? [];
      // The arm's accessor slots must also carry the literal's own accessor
      // signatures: same-name getters with different return types (or setters
      // with different parameter types) belong to different arms.
      const signaturesMatch = expr.properties.every((p) => {
        if (!ts.isGetAccessorDeclaration(p) && !ts.isSetAccessorDeclaration(p)) return true;
        const n = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
        const field = fields.find((f) => f.name === (ts.isGetAccessorDeclaration(p) ? `%get:${n}` : `%set:${n}`));
        if (!field || field.type.kind !== "func") return true;
        const sig = lowerer.checker.getSignatureFromDeclaration(p);
        if (!sig) return true;
        const own = ts.isGetAccessorDeclaration(p)
          ? lowerer.mapTypeOf(lowerer.checker.getReturnTypeOfSignature(sig))
          : (p.parameters[0] ? lowerer.mapTypeOf(lowerer.checker.getTypeAtLocation(p.parameters[0])) : null);
        const slot = ts.isGetAccessorDeclaration(p) ? field.type.ret : field.type.params[0];
        return own === null || slot === undefined || typeEquals(own, slot);
      });
      return signaturesMatch && fields.some((f) => /^%[gs]et:/.test(f.name)) && names.every((n) => fields.some((f) => f.name === n)) &&
        fields.every((f) => names.includes(f.name) || (f.type.kind === "union" && lowerer.armTag(f.type.unionId, UNDEFINED_T) >= 0));
    }) ?? null;
  };
  mapped = accessorArm(mapped) ?? armsBase(mapped);
  if (mapped === null || mapped.kind === "union" || mapped.kind === "dyn" || mapped.kind === "object" || mapped.kind === "jsval" || mapped.kind === "func") {
    const ctxUnion = mapped?.kind === "union" ? mapped : null;
    mapped = armsBase(lowerer.mapTypeOf(lowerer.typeOf(expr))) ?? mapped;
    // A literal whose own shape re-tags into NO arm of the contextual
    // union, where the union has exactly ONE record arm: build AS that
    // arm — there is no ambiguity (tsc already checked the literal
    // against the union, and the record arm is the only shape it can
    // inhabit), and the arm's field types drive every property's
    // coercion (`{ env: {...spread...}, onCleanup }` against an
    // optional options param — the env value builds by ITS contextual
    // index-signature type and wraps into the arm's `| undefined`
    // field, where the literal's own inferred width would mismatch).
    // Empty literals (`_env = {}` — the fieldless own shape) and
    // literals against PURE index-signature arms (`{ OPENSSL_CONF:
    // candidate }` — keys become overflow entries) are the same rule's
    // simplest cases. The empty-array-in-union rule, record form.
    if (ctxUnion) {
      const def = lowerer.unions.get(ctxUnion.unionId);
      const recordArms = def?.arms.filter((a) => a.kind === "record") ?? [];
      if (recordArms.length === 1) {
        const armShape = lowerer.shapes.get(recordArms[0]!.shapeId);
        if (
          (mapped?.kind !== "record" || mapped.shapeId !== recordArms[0]!.shapeId) &&
          !armShape?.tuple &&
          // `{} | undefined` supplies no layout for a populated options
          // literal, just as a bare empty-record context supplies none.
          (expr.properties.length === 0 || (armShape && (armShape.fields.length > 0 || armShape.indexValue)))
        ) {
          mapped = recordArms[0]!;
        }
      } else if (recordArms.length > 1) {
        const ownShapeId = mapped?.kind === "record" ? mapped.shapeId : null;
        // SEVERAL record arms (the reducer-action / discriminated-message
        // pattern): the literal's own inferred shape re-tags into no arm
        // — its field types widened per field (`parsed: 1` against
        // `parsed: number | null`), so the IR-level candidate probe is
        // ambiguous (a narrower arm also admits the literal by dropping
        // fields). The LITERAL types tsc checked carry the discriminant
        // the shapes erased: match the literal's fields against each
        // union member's CHECKER types (literal-vs-literal field pairs
        // decide by value — the `kind: "a"` discriminant), and when
        // exactly ONE member fits, build AS that arm — its field types
        // drive every property's coercion, exactly the single-record-arm
        // rule above. Ambiguous literals keep the SC2003 fence.
        // Recursive arms can have identical stored field layouts while
        // retaining distinct nominal knots. An inferred spread shape can
        // match the wrong knot, so consult discriminants even if that shape
        // already appears in the union.
        if (ownShapeId === null || !recordArms.some((a) => a.shapeId === ownShapeId) || expr.properties.some(ts.isSpreadAssignment)) {
          const arm = literalUnionArmOf(lowerer, expr, tsType, recordArms);
          if (arm) mapped = arm;
        }
      }
    }
  }
  // The CJS EXPORT-TABLE literal in VALUE position (JS): importers reach
  // every member through alias plumbing and accessor lifts — the record
  // VALUE exists for the module's own reads (Object.keys, internal
  // member reads), so it keeps exactly the plain fields whose values
  // lower; accessor entries and members with no value representation
  // (rest-param function types) narrow away. SEMANTICS.md documents the
  // enumeration divergence.
  if (
    isJsSourceFile(expr.getSourceFile()) &&
    (!mapped || expr.properties.some((p) => ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))) &&
    isCjsExportTableLiteral(expr)
  ) {
    const fields: { name: string; value: IrExpr }[] = [];
    for (const prop of expr.properties) {
      if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) continue;
      const propName = ts.isSpreadAssignment(prop) ? undefined : prop.name;
      if (!propName || !(ts.isIdentifier(propName) || ts.isStringLiteral(propName))) continue;
      const name = propName.text;
      let v: IrExpr | null = null;
      if (ts.isShorthandPropertyAssignment(prop)) {
        v = tryLowerExpression(lowerer, propName as ts.Identifier);
      } else if (ts.isPropertyAssignment(prop)) {
        v = tryLowerExpression(lowerer, prop.initializer);
      }
      if (!v || v.type.kind === "void" || v.type.kind === "caught" || v.type.kind === "jsval") continue;
      if (isUnitType(v.type)) continue;
      fields.push({ name, value: v });
    }
    // Canonical (sorted) field order — the shape registry's invariant;
    // the dropped reads are all pure, so reordering loses nothing.
    fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const shapeId = lowerer.shapes.intern(fields.map((f) => ({ name: f.name, type: f.value.type })));
    return { kind: "recordLit", fields, type: { kind: "record", shapeId }, loc };
  }
  // The JS declaration fallback, literal-side (the checked-dynamic tree-array rule's
  // object form): a literal whose shape has no static home — an
  // unmappable contextual type over unmappable own fields (the
  // PropertyDescriptorMap argument of Object.defineProperties, nested
  // descriptor records with `any` values) — builds as a dyn OBJECT:
  // each field converts through the usual dyn boundary, and dynamic
  // consumers ride the keyed-dyn paths. TypeScript keeps the fence.
  if (mapped?.kind === "dyn" || (!mapped && isJsSourceFile(expr.getSourceFile())) ||
      (!expected && mapped && jsOpenObjectType(expr, mapped, lowerer.shapes, lowerer.unions).kind === "dyn")) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // A page-value slot (browser target: `unknown` props handed to React's
  // jsx runtime, a DOM dictionary): the literal is built as a page object,
  // each field crossing the boundary on its own.
  if (mapped?.kind === "jsval" && browserTarget()) return lowerIslandObjectLiteral(lowerer, expr);
  if (!mapped || mapped.kind !== "record") lowerer.badType(expr, tsType);
  let type: IrType = mapped;
  // A fresh, plain literal can construct its fields directly for a known
  // destination with the same field set. This matters for inferred
  // conditional records: an empty array in one arm has no element layout
  // until the join supplies it. Existing values still use width coercion;
  // extra fields, spreads, accessors, and keyed shapes retain their paths.
  if (expected && !isJsSourceFile(expr.getSourceFile()) &&
      expr.properties.every((p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))) {
    const own = lowerer.shapes.get(type.shapeId)!;
    const target = lowerer.shapes.get(expected.shapeId)!;
    if (!own.tuple && !target.tuple && !own.indexValue && !target.indexValue &&
        !shapeHasAccessorSlots(own) && !shapeHasAccessorSlots(target) &&
        target.fields.every((field) => own.fields.some((candidate) => candidate.name === field.name) ||
          field.type.kind === "union" && lowerer.armTag(field.type.unionId, UNDEFINED_T) >= 0) &&
        own.fields.every((field) => target.fields.some((candidate) => candidate.name === field.name))) {
      type = { kind: "record", shapeId: expected.shapeId };
    }
  }
  let shape = lowerer.shapes.get(type.shapeId)!;
  // JavaScript Dates carry native object identity in checked storage. An
  // inferred scalar Date field would erase that identity before boxing.
  if (isJsSourceFile(expr.getSourceFile()) && shape.fields.some((field) => field.type.kind === "date")) {
    return lowerDynObjectLiteral(lowerer, expr);
  }
  // ACCESSOR properties, JS literals only (TS accessors fill the shape's
  // %get:/%set: closure slots below): no record storage exists for them,
  // so the literal's shape NARROWS to its plain fields (reads resolve
  // through the lifted accessors; Object.keys over the value omits
  // accessor names — the documented divergence).
  if (isJsSourceFile(expr.getSourceFile())) {
    const accessorNames = new Set(
      expr.properties
        .filter((p) => ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))
        .map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : ""))
        .filter((n) => n !== ""),
    );
    if (accessorNames.size > 0) {
      const narrowed = shape.fields.filter((f) => !accessorNames.has(f.name));
      const narrowedId = lowerer.shapes.intern(
        narrowed.map((f) => ({ name: f.name, type: f.type })),
        false,
        shape.indexValue,
      );
      type = { kind: "record", shapeId: narrowedId };
      shape = lowerer.shapes.get(narrowedId)!;
    }
  }
  const fieldTypes = new Map(shape.fields.map((f) => [f.name, f.type]));
  // File-scope JavaScript object bindings live in the checked-dynamic tree
  // to preserve open writes and identity. The checker can infer fields
  // from later writes; those fields must remain absent when the literal
  // is first evaluated.
  const topLevelJsDecl = ts.isVariableDeclaration(expr.parent) &&
    expr.parent.initializer === expr &&
    ts.isVariableStatement(expr.parent?.parent?.parent) &&
    ts.isSourceFile(expr.parent?.parent?.parent?.parent);
  const assignedProperties = expr.properties.filter(
    (prop): prop is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop),
  );
  if (
    topLevelJsDecl && isJsSourceFile(expr.getSourceFile()) &&
    assignedProperties.length === expr.properties.length
  ) {
    const provided = new Set(assignedProperties.map((prop) => propNameText(lowerer, prop.name)));
    if (shape.fields.some((field) => !provided.has(field.name))) {
      return lowerDynObjectLiteral(lowerer, expr);
    }
  }
  // The clone probe may lower the leading spread before declining (a
  // static `as` cast can make the checker-visible shape match while its
  // erased IR value keeps a wider shape). Reuse that exact value in the
  // ordinary spread path so lowering still happens once.
  let leadingSpreadLowered: IrExpr | null = null;

  // The overwhelmingly common immutable-update form over a record:
  // `{ ...model, changed, other: value }`. The historic lowering expanded
  // the spread into one recordGet per untouched field at EVERY site, then
  // the backends inlined all of those retains and stores into the caller.
  // A 178-field model updated hundreds of times consequently produced a
  // half-million-line LLVM function. Keep the same evaluation/ownership
  // semantics in one compact IR node: source first, explicit overrides in
  // source order, and one backend clone helper per shape.
  //
  // Stay deliberately narrow. Tuple/index/accessor shapes, conditional or
  // multiple spreads, spread-after-explicit order, and shape-changing width
  // copies retain their existing lowering and diagnostics.
  if (
    !isJsSourceFile(expr.getSourceFile()) &&
    !shape.indexValue &&
    !shape.tuple &&
    !shapeHasAccessorSlots(shape) &&
    expr.properties.length >= 2 &&
    ts.isSpreadAssignment(expr.properties[0]!) &&
    !conditionalSpreadArms(expr.properties[0]!.expression) &&
    expr.properties.slice(1).every(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name !== undefined &&
        (ts.isIdentifier(p.name) ||
          ts.isStringLiteral(p.name) ||
          ts.isNumericLiteral(p.name) ||
          (ts.isComputedPropertyName(p.name) && literalComputedKey(lowerer, p.name) !== null)),
    )
  ) {
    const spread = expr.properties[0]! as ts.SpreadAssignment;
    const props = expr.properties.slice(1) as (
      | ts.PropertyAssignment
      | ts.ShorthandPropertyAssignment
    )[];
    const names = props.map((p) => propNameText(lowerer, p.name!));
    const unique = new Set(names);
    const sourceType = lowerer.mapTypeOf(lowerer.typeOf(spread.expression));
    if (
      sourceType?.kind === "record" &&
      sourceType.shapeId === type.shapeId &&
      unique.size === names.length &&
      names.every((name) => fieldTypes.has(name))
    ) {
      const source = lowerer.lowerExpr(spread.expression);
      if (source.type.kind === "record" && source.type.shapeId === type.shapeId) {
        const overrides: { name: string; value: IrExpr }[] = [];
        for (let i = 0; i < props.length; i++) {
          const p = props[i]!;
          const name = names[i]!;
          const fieldType = fieldTypes.get(name)!;
          const valueNode = ts.isPropertyAssignment(p) ? p.initializer : p;
          let value = ts.isPropertyAssignment(p)
            ? lowerer.lowerExpr(p.initializer)
            : lowerer.lowerShorthandValue(p);
          value = lowerer.coerceInto(valueNode, value, fieldType);
          if (!typeEquals(value.type, fieldType)) lowerer.badType(valueNode, lowerer.typeOf(valueNode));
          overrides.push({ name, value });
        }
        return { kind: "recordClone", source, overrides, type, loc };
      }
      leadingSpreadLowered = source;
    }
  }

  // A PURE index-signature target with spreads — `{ ...process.env }`,
  // `{ ...process.env, ...extraEnv }`, `{ ...env, PATH: p }` (the
  // spawn-env pattern): the field-by-field desugar below cannot
  // enumerate runtime overflow keys, so the literal lowers as ONE
  // interned merge-helper call — contributors apply in literal order
  // with keyed writes (JS last-write-wins), sources and values evaluate
  // once each in source order (the call's argument order). A CONDITIONAL
  // spread `...(c ? { k: v } : {})` contributes its one key as a ternary
  // — cond once, v lazily, the empty arm holding the value slot's
  // undefined arm (the explicit-undefined-is-absent stance: JSON and
  // child-env builders drop it, exactly Node's absent key); targets
  // with declared fields keep the historic desugar below.
  const isRuntimeComputedKey = (p: ts.ObjectLiteralElementLike): boolean =>
    !ts.isSpreadAssignment(p) &&
    p.name !== undefined &&
    ts.isComputedPropertyName(p.name) &&
    literalComputedKey(lowerer, p.name) === null;
  if (
    shape.indexValue &&
    shape.fields.length === 0 &&
    !shape.tuple &&
    (expr.properties.some((p) => ts.isSpreadAssignment(p)) || expr.properties.some(isRuntimeComputedKey))
  ) {
    const contributors: IndexMergeContributor[] = [];
    let mergeable = true;
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const cs = conditionalSpreadOf(prop.expression);
        if (cs === "unsupported" || (cs && cs.props.length !== 1)) {
          lowerer.unsupported(
            "SC1090",
            prop,
            "conditional spreads beyond `...(c ? { field: v } : {})` into an index-signature record (exactly one property against an empty arm)",
          );
        }
        if (cs) {
          const absent = lowerer.wrappedUndefined(shape.indexValue, locOf(prop));
          // A value slot with no undefined arm (`Record<string, { w: string }>`):
          // the helper takes the value as `T | undefined` and writes the key
          // only for the T arm — cond once, v lazily, an absent key absent.
          const guardSlot = !absent ? lowerer.withUndefinedArmOf(shape.indexValue) : null;
          if (guardSlot && guardSlot.kind === "union") {
            const csProp = cs.props[0]!;
            const cond = lowerer.lowerCondition(cs.cond);
            const vNode: ts.Node = ts.isPropertyAssignment(csProp) ? csProp.initializer : csProp;
            const v = lowerer.intoIndexValueSlot(
              ts.isPropertyAssignment(csProp) ? lowerer.lowerExpr(csProp.initializer) : lowerer.lowerShorthandValue(csProp),
              shape.indexValue,
              vNode,
            );
            const held = lowerer.coerceToExpected(v, guardSlot);
            const none = lowerer.wrappedUndefined(guardSlot, locOf(prop))!;
            contributors.push({
              kind: "guardedField",
              name: csProp.name.text,
              slot: guardSlot,
              value: { kind: "ternary", cond, then: cs.whenTrue ? held : none, else_: cs.whenTrue ? none : held, type: guardSlot, loc: locOf(prop) },
            });
            continue;
          }
          if (!absent) {
            lowerer.unsupported(
              "SC1090",
              prop,
              `conditional spreads into '${lowerer.fmt(shape.indexValue)}'-valued index-signature keys (the empty arm needs an undefined arm to hold — write the key in an if statement instead)`,
            );
          }
          const csProp = cs.props[0]!;
          const cond = lowerer.lowerCondition(cs.cond);
          const vNode: ts.Node = ts.isPropertyAssignment(csProp) ? csProp.initializer : csProp;
          const v = lowerer.intoIndexValueSlot(
            ts.isPropertyAssignment(csProp) ? lowerer.lowerExpr(csProp.initializer) : lowerer.lowerShorthandValue(csProp),
            shape.indexValue,
            vNode,
          );
          contributors.push({
            kind: "field",
            name: csProp.name.text,
            value: {
              kind: "ternary",
              cond,
              then: cs.whenTrue ? v : absent,
              else_: cs.whenTrue ? absent : v,
              type: shape.indexValue,
              loc: locOf(prop),
            },
          });
          continue;
        }
        let src = lowerer.lowerExpr(prop.expression);
        src = lowerOptionalIndexSpreadSource(lowerer, src, locOf(prop)) ?? src;
        if (src.type.kind !== "record") {
          lowerer.unsupported(
            "SC1090",
            prop,
            `object spread of '${lowerer.fmt(src.type)}' sources into an index-signature shape (only index-signature records merge — ${NARROW_FIRST})`,
          );
        }
        fenceAccessorSpreadSource(lowerer, prop, lowerer.shapes.get(src.type.shapeId));
        contributors.push({ kind: "spread", shapeId: src.type.shapeId, value: src });
        continue;
      }
      if (
        (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
        prop.name &&
        (ts.isIdentifier(prop.name) ||
          ts.isStringLiteral(prop.name) ||
          ts.isNumericLiteral(prop.name) ||
          (ts.isComputedPropertyName(prop.name) && literalComputedKey(lowerer, prop.name) !== null))
      ) {
        const value = ts.isPropertyAssignment(prop)
          ? lowerer.intoIndexValueSlot(lowerer.lowerExpr(prop.initializer), shape.indexValue, prop.initializer)
          : lowerer.intoIndexValueSlot(lowerer.lowerShorthandValue(prop), shape.indexValue, prop);
        contributors.push({ kind: "field", name: propNameText(lowerer, prop.name), value });
        continue;
      }
      // A RUNTIME-keyed property (`{ ...m, ["a" + "b"]: "" }`, `{ [K]:
      // v }` where K is a runtime string): the key evaluates before its
      // value (JS's per-property order — both are helper arguments) and
      // writes through the signature exactly like a spread's keys.
      // Number/boolean/unknown keys stringify (ToPropertyKey).
      if (ts.isPropertyAssignment(prop) && ts.isComputedPropertyName(prop.name)) {
        let k = lowerer.lowerExpr(prop.name.expression);
        if (k.type.kind === "union" && lowerer.dynConvertible(k.type)) k = lowerer.coerceToExpected(k, DYN);
        if (k.type.kind === "f64" || k.type.kind === "bool" || k.type.kind === "dyn") {
          k = { kind: "toString", operand: k, type: STRING, loc: locOf(prop.name) };
        }
        if (k.type.kind !== "string") {
          lowerer.unsupported(
            "SC1090",
            prop.name,
            `'${lowerer.fmt(k.type)}'-typed computed property keys (string, number, boolean, and unknown keys stringify)`,
          );
        }
        const value = lowerer.intoIndexValueSlot(lowerer.lowerExpr(prop.initializer), shape.indexValue, prop.initializer);
        contributors.push({ kind: "keyedField", key: k, value });
        continue;
      }
      mergeable = false;
      break;
    }
    if (mergeable) {
      const helper = lowerIndexMergeHelper(lowerer, type.shapeId, contributors, loc);
      if (helper === null) {
        lowerer.unsupported(
          "SC1090",
          expr,
          `object spread into '${lowerer.fmt(type)}' from these source shapes (spread sources must be index-signature records whose value type is, or lifts into, the target's)`,
        );
      }
      return {
        kind: "call",
        callee: helper,
        args: contributors.flatMap((c) => (c.kind === "keyedField" ? [c.key, c.value] : [c.value])),
        type,
        loc,
      };
    }
  }
  // Unfoldable computed keys outside the index-signature merge path:
  // no record shape can hold a runtime-decided name.
  for (const prop of expr.properties) {
    if (isRuntimeComputedKey(prop) && !(ts.isPropertyAssignment(prop) && ts.isComputedPropertyName(prop.name) && literalUnionKeyNames(lowerer, prop.name) !== null)) {
      lowerer.unsupported("SC1090", (prop as ts.PropertyAssignment).name, "computed property keys (compile-time-known keys fold — a pure expression whose checker type is one string or number literal: consts, enum members, quoted keys, templates of those — `{ [MARKER]: v }`; runtime string keys write through an index-signature target; symbol keys stay out)");
    }
  }

  // A declared destination combining fixed records and runtime-keyed
  // sources needs both layouts. Apply each source before evaluating the
  // next expression, with checked overflow collisions and optional-field
  // completion. Extra runtime keys follow the declared-shape width policy.
  if (
    !shape.indexValue &&
    !shape.tuple &&
    shape.fields.length > 0 &&
    expr.properties.length > 0 &&
    expr.properties.every((p) => ts.isSpreadAssignment(p) && !conditionalSpreadArms(p.expression)) &&
    expr.properties.some((p) => {
      const t = lowerer.mapTypeOf(lowerer.typeOf((p as ts.SpreadAssignment).expression));
      return t?.kind === "dyn" || t?.kind === "record" && !!lowerer.shapes.get(t.shapeId)?.indexValue;
    })
  ) {
    return lowerDeclaredSpreadMerge(lowerer, expr, type, shape, loc);
  }

  const shapeMismatch: (node: ts.Node) => never = (node) => {
    const own = lowerer.mapTypeOf(lowerer.typeOf(expr));
    lowerer.pushDiag(
      recordShapeMismatchDiag(
        lowerer.fmt(type),
        own ? lowerer.fmt(own) : lowerer.checker.typeToString(lowerer.typeOf(expr)),
        locOf(node),
        own?.kind === "record" && type.kind === "record"
          ? (lowerer.describeRecordWidthBlocker(own.shapeId, type.shapeId) ?? undefined)
          : undefined,
      ),
    );
    throw new PoisonError();
  };

  const fields: { name: string; value: IrExpr; overflow?: true; drop?: true }[] = [];
  const spreadStmts: IrStmt[] = [];
  const hasSpread = expr.properties.some(ts.isSpreadAssignment);
  const captured = new Set<IrExpr>();
  const carrySources: IrExpr[] = [];
  const capture = (value: IrExpr): IrExpr => {
    const local = lowerer.declareHiddenLocal("%spreadValue", value.type);
    spreadStmts.push({ kind: "varDecl", localId: local.id, init: value, loc: value.loc });
    const ref = varRef(local.id, value.type, value.loc);
    captured.add(ref);
    return ref;
  };
  // Member names DROPPED from the shape (JS deferral — unlowerable pure
  // member reads narrow away; see the catch in the property loop).
  const droppedNames = new Set<string>();
  for (const prop of expr.properties) {
    // A later contributor can mutate an earlier source or overwrite a
    // value with effects. Snapshot pending fields at their source position,
    // before evaluating the next contributor, even if they are overwritten.
    if (hasSpread) {
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!;
        if (field.drop) {
          spreadStmts.push({ kind: "exprStmt", expr: field.value, loc: field.value.loc });
          fields.splice(i--, 1);
          continue;
        }
        if (!captured.has(field.value)) field.value = capture(field.value);
      }
    }
    if (ts.isSpreadAssignment(prop)) {
      const csArms = conditionalSpreadArms(prop.expression);
      let genericSrc: { node: ts.Expression; value: IrExpr } | null = null;
      if (csArms && csArms !== "unsupported") {
        // `...(c ? { a: v, b: w } : {})` (also `: undefined`, `c && {...}`,
        // either orientation, or both arms literal): per NAME one conditional
        // field at the spread's own position. The condition evaluates exactly
        // once (a hidden local when several names read it), each value only
        // when its arm is taken (ternary arms are lazy). An arm that lacks a
        // name leaves the EARLIER contributor's value in place (spread presence
        // semantics: `{ ...defaults, ...(c ? { a } : {}) }` keeps defaults.a
        // when c is false); with no earlier contributor it holds the interned
        // undefined arm — the omitted-optional-field representation, which is
        // why the target field must then be optional (tsc types it that way).
        const armProps = (arm: CondArm): CondSpreadProp[] => ("props" in arm ? arm.props : []);
        const trueProps = armProps(csArms.whenTrue), falseProps = armProps(csArms.whenFalse);
        const exprArm: { node: ts.Expression; whenTrue: boolean } | null =
          "expr" in csArms.whenTrue ? { node: csArms.whenTrue.expr, whenTrue: true }
          : "expr" in csArms.whenFalse ? { node: csArms.whenFalse.expr, whenTrue: false } : null;
        const names: string[] = [];
        for (const cp of [...trueProps, ...falseProps]) if (!names.includes(cp.name.text)) names.push(cp.name.text);
        let cond = lowerer.lowerCondition(csArms.cond);
        if (names.length + (exprArm ? 1 : 0) > 1) cond = capture(cond);
        for (const name of names) {
          const fieldType = fieldTypes.get(name);
          if (!fieldType) {
            if (shape.indexValue) {
              lowerer.unsupported(
                "SC1090",
                prop,
                "conditional spreads into index-signature keys (overflow entries model presence — write the key in an if statement instead)",
              );
            }
            shapeMismatch(prop);
          }
          const earlier = fields.findIndex((f) => f.name === name && !f.drop);
          const absent = earlier >= 0 ? fields[earlier]!.value : omittedArgFor(lowerer, fieldType, locOf(prop));
          if (!absent) {
            lowerer.unsupported(
              "SC1090",
              prop,
              `conditional spreads onto the required field '${name}' (the empty arm leaves it undefined — declare the field optional)`,
            );
          }
          const armValue = (list: CondSpreadProp[]): IrExpr => {
            const cp = list.find((x) => x.name.text === name);
            if (!cp) return absent;
            const valueNode = ts.isPropertyAssignment(cp) ? cp.initializer : cp;
            let v = ts.isPropertyAssignment(cp) ? lowerer.lowerExpr(cp.initializer) : lowerer.lowerShorthandValue(cp);
            v = lowerer.coerceInto(valueNode, v, fieldType);
            if (!typeEquals(v.type, fieldType)) lowerer.badType(valueNode, lowerer.typeOf(valueNode));
            return v;
          };
          const entry = {
            name,
            value: {
              kind: "ternary" as const,
              cond,
              then: armValue(trueProps),
              else_: armValue(falseProps),
              type: fieldType,
              loc: locOf(prop),
            },
          };
          if (earlier >= 0) fields[earlier] = entry;
          else fields.push(entry);
        }
        if (!exprArm) continue;
        // A record-valued arm (`c ? {} : build()`): spread `c ? X : undefined`
        // through the optional-source desugar below — the source evaluates
        // only when its arm is taken, and the absent arm copies nothing.
        const armCond: IrExpr = exprArm.whenTrue ? cond : { kind: "unary", op: "!", operand: cond, type: BOOL, loc: locOf(prop) };
        const x = lowerer.lowerExpr(exprArm.node);
        const held = lowerer.withUndefinedArmOf(x.type);
        const none = held ? lowerer.wrappedUndefined(held, locOf(prop)) : null;
        if (!held || !none || held.kind !== "union") {
          lowerer.unsupported("SC1090", exprArm.node, `a conditional spread of '${lowerer.fmt(x.type)}' (the source type cannot take an absent arm)`);
        }
        genericSrc = {
          node: exprArm.node,
          value: capture({ kind: "ternary", cond: armCond, then: lowerer.coerceToExpected(x, held), else_: none, type: held, loc: locOf(prop) }),
        };
      }
      // `{ ...base, ... }` — field-by-field copy of a known record
      // shape. Every source field must land on the target shape with an
      // equal type (a wider source would silently DROP fields JS keeps —
      // the width fence, same as literals). Later contributors override
      // earlier ones (JS last-write-wins). Evaluate the source exactly
      // once, including empty sources and those whose fields are all
      // overridden. Field snapshots above preserve the copy order.
      let srcNode: ts.Expression = genericSrc ? genericSrc.node : prop.expression;
      while (ts.isParenthesizedExpression(srcNode)) srcNode = srcNode.expression;
      let srcLowered = genericSrc ? genericSrc.value : capture(
        prop === expr.properties[0] && leadingSpreadLowered !== null
          ? leadingSpreadLowered
          : lowerer.lowerExpr(srcNode));
      // A plain record source: where untyped data converts into records (WasmGC native dyn) it can carry undeclared own keys the result keeps.
      if (!genericSrc && srcLowered.type.kind === "record") carrySources.push(srcLowered);
      // Array callbacks can receive a record-or-undefined ABI even when
      // TypeScript describes a required record. Select the copy strategy
      // from that stored representation so absent sources copy nothing.
      // Checked-dynamic bindings still use the checker's field contract.
      let srcType = srcLowered.type.kind === "dyn"
        ? lowerer.mapTypeOf(lowerer.typeOf(srcNode))
        : srcLowered.type;
      // A union binding whose arms the checker has narrowed away here (nullish
      // arms after `entry ? { ...entry } : ...`, a number after `typeof x === "number"`):
      // copy from the narrowed arms.
      if (srcType?.kind === "union" && srcLowered.type.kind === "union") {
        const flow = lowerer.mapTypeOf(lowerer.typeOf(srcNode));
        const storedArms = lowerer.unions.get(srcType.unionId)?.arms ?? [];
        const flowArms = flow?.kind === "union" ? lowerer.unions.get(flow.unionId)?.arms ?? [] : [];
        if (flow?.kind === "union" && !typeEquals(flow, srcType) &&
            flowArms.length < storedArms.length &&
            flowArms.every((arm) => storedArms.some((s) => typeEquals(s, arm)))) {
          const helper = lowerer.narrowedRetagHelper(srcNode, srcType.unionId, flow.unionId, locOf(prop));
          if (helper) {
            srcLowered = capture({ kind: "call", callee: helper, args: [srcLowered], type: flow, loc: locOf(prop) });
            srcType = flow;
          }
        }
      }
      // The checker has narrowed the source to ONE record arm of the stored
      // union (a required array-callback element stored as record-or-undefined,
      // the else branch of `typeof x === "number"`): the other arms cannot occur
      // here, so copy from that arm itself.
      if (!genericSrc && srcType?.kind === "union" && srcLowered.type.kind === "union") {
        const flow = lowerer.mapTypeOf(lowerer.typeOf(srcNode));
        if (flow?.kind === "record" && (lowerer.unions.get(srcType.unionId)?.arms ?? []).some((arm) => typeEquals(arm, flow))) {
          srcLowered = capture(lowerer.coerceToExpected(srcLowered, flow));
          srcType = flow;
        }
      }
      // `...options.installConfig` — a spread of `Partial<X> | undefined`
      // (the optional-options merge idiom `{ ...DEFAULTS, ...overrides }`):
      // JS spreads nothing for the unit arm and copies present keys
      // otherwise. Per target field the desugar builds
      // `present ? extracted : earlier` — present tests the source's
      // record tag AND (optional source fields) the field's own value
      // arm; absent keeps the earlier contributor's value (both reads
      // are pure, so the reorder into the ternary is unobservable).
      if (srcType?.kind === "union") {
        const def = lowerer.unions.get(srcType.unionId);
        // A class arm (interfaceClassArms) spreads its instance's own data fields.
        const recArms = def?.arms.filter((a) => a.kind === "record" || a.kind === "object") ?? [];
        if (
          !def ||
          recArms.length === 0 ||
          !def.arms.every((a) => a.kind === "record" || a.kind === "object" || isUnitType(a))
        ) {
          lowerer.unsupported(
            "SC1090",
            prop,
            `object spread of '${lowerer.fmt(srcType)}' sources (only known record shapes spread — ${NARROW_FIRST})`,
          );
        }
        // A checked-dynamic VALUE under the union-mapped checker type
        // (a JS dyn-holding binding): the present/absent desugar tests
        // union tags a dyn box does not carry — fence honestly instead
        // of the validator's ICE.
        const probedSrc = srcLowered ?? tryLowerExpression(lowerer, srcNode);
        if (probedSrc?.type.kind === "dyn") {
          lowerer.unsupported(
            "SC1090",
            prop,
            `object spread of a checked-dynamic '${lowerer.fmt(srcType)}' source (${NARROW_FIRST})`,
          );
        }
        // Several record arms (an interface's class arms, two literal shapes):
        // each arm contributes its own fields behind its tag test, falling back
        // to the arms before it and then to the earlier contributor, so exactly
        // the held arm's fields are copied, in its own order.
        // The fields contributed before this spread: only those may answer for an optional field the held arm leaves
        // unset. An entry this spread's own earlier arm made is another arm's read (an unguarded cast when it is the
        // innermost fallback), never the value for this arm.
        const contributedBefore = new Set(fields.filter((x) => !x.drop).map((x) => x.name));
        for (const recArm of recArms) {
          const recTag = def.arms.indexOf(recArm);
          const srcShape = recArm.kind === "record" ? lowerer.shapes.get(recArm.shapeId) : undefined;
          if (recArm.kind === "record" && !srcShape) throw new InternalCompilerError(`lowerer bug: spread of unknown shape ${recArm.shapeId}`);
          const classInfo = recArm.kind === "object" ? lowerer.classes.get(recArm.className) : undefined;
          if (recArm.kind === "object" && !classInfo) throw new InternalCompilerError(`lowerer bug: spread of unknown class ${recArm.className}`);
          if (srcShape) fenceAccessorSpreadSource(lowerer, prop, srcShape);
          // The arm's own data fields: a record's shape fields, a class instance's
          // fields (inherited included; `#private` and compiler-internal slots are not
          // enumerable properties of the instance).
          const armFields: { name: string; type: IrType }[] = srcShape
            ? srcShape.fields
            : [...classInfo!.fields].filter(([name]) => !name.startsWith("#") && !name.startsWith("%")).map(([name, type]) => ({ name, type }));
          if (srcShape && (srcShape.indexValue || shape.indexValue)) {
            lowerer.unsupported(
              "SC1090",
              prop,
              "object spread involving index-signature shapes (overflow keys are runtime state — copy the fields you need explicitly)",
            );
          }
          const laterNames = new Set<string>();
          for (const later of expr.properties.slice(expr.properties.indexOf(prop) + 1)) {
            if (ts.isSpreadAssignment(later)) {
              if (conditionalSpreadArms(later.expression)) continue;
              const lt = laterSpreadType(lowerer, later.expression);
              if (lt?.kind === "record") {
                for (const lf of lowerer.shapes.get(lt.shapeId)?.fields ?? []) if (alwaysOwn(lowerer, lf.type)) laterNames.add(lf.name);
              }
              continue;
            }
            if (
              later.name &&
              (ts.isIdentifier(later.name) ||
                ts.isStringLiteral(later.name) ||
                ts.isNumericLiteral(later.name) ||
                (ts.isComputedPropertyName(later.name) && literalComputedKey(lowerer, later.name) !== null))
            ) {
              laterNames.add(propNameText(lowerer, later.name));
            }
          }
          const srcRef = (): IrExpr => srcLowered ?? lowerer.lowerExpr(srcNode);
          for (const f of armFields) {
            if (laterNames.has(f.name)) continue;
            const targetType = fieldTypes.get(f.name);
            // No slot on the target shape: the copy DROPS the field
            // (divergence 36's stance, same as the plain-record spread).
            if (!targetType) continue;
            const armValue = (): IrExpr => ({ kind: "unionNarrow", unionId: srcType.unionId, tag: recTag, value: srcRef(), type: recArm, loc: locOf(prop) });
            const fRead = (): IrExpr => recArm.kind === "record"
              ? { kind: "recordGet", obj: armValue(), shapeId: recArm.shapeId, field: f.name, type: f.type, loc: locOf(prop) }
              : { kind: "fieldGet", obj: armValue(), className: recArm.className, field: f.name, type: f.type, loc: locOf(prop) };
            let cond: IrExpr = { kind: "unionIsTag", unionId: srcType.unionId, tag: recTag, negated: false, value: srcRef(), type: BOOL, loc: locOf(prop) };
            let thenVal: IrExpr;
            if (typeEquals(f.type, targetType)) {
              thenVal = fRead();
              // An unset optional field is no own property: the earlier
              // contributor (or the arms before this one) stays.
              const undefTag = f.type.kind === "union" ? lowerer.armTag(f.type.unionId, UNDEFINED_T) : -1;
              if (undefTag >= 0 && f.type.kind === "union" && contributedBefore.has(f.name)) {
                cond = { kind: "logical", op: "&&", left: cond,
                  right: { kind: "unionIsTag", unionId: f.type.unionId, tag: undefTag, negated: true, value: fRead(), type: BOOL, loc: locOf(prop) },
                  type: BOOL, loc: locOf(prop) };
              }
            } else if (
              f.type.kind === "union" &&
              lowerer.armTag(f.type.unionId, UNDEFINED_T) >= 0 &&
              typeEquals(lowerer.stripUndefinedArm(f.type), targetType)
            ) {
              // Optional source field into a required target slot: present
              // means the source holds the record AND the field its value
              // arm — the spread-override completion, union-source form.
              const ftUndef = lowerer.armTag(f.type.unionId, UNDEFINED_T);
              cond = {
                kind: "logical",
                op: "&&",
                left: cond,
                right: { kind: "unionIsTag", unionId: f.type.unionId, tag: ftUndef, negated: true, value: fRead(), type: BOOL, loc: locOf(prop) },
                type: BOOL,
                loc: locOf(prop),
              };
              const ftDef = lowerer.unions.get(f.type.unionId);
              if (targetType.kind === "union") {
                const retag = lowerer.unionRetagHelper(f.type.unionId, targetType.unionId, locOf(prop));
                if (!retag) {
                  lowerer.pushDiag(recordShapeMismatchDiag(lowerer.fmt(type), lowerer.fmt(recArm), locOf(prop), `spread field '${f.name}': '${lowerer.fmt(f.type)}' cannot re-tag into '${lowerer.fmt(targetType)}' behind the present-test`));
                  throw new PoisonError();
                }
                thenVal = { kind: "call", callee: retag, args: [fRead()], type: targetType, loc: locOf(prop) };
              } else if (ftDef && ftDef.arms.length === 2 && lowerer.armTag(f.type.unionId, targetType) >= 0) {
                thenVal = { kind: "unionNarrow", unionId: f.type.unionId, tag: lowerer.armTag(f.type.unionId, targetType), value: fRead(), type: targetType, loc: locOf(prop) };
              } else {
                lowerer.pushDiag(recordShapeMismatchDiag(lowerer.fmt(type), lowerer.fmt(recArm), locOf(prop), `spread field '${f.name}': '${lowerer.fmt(f.type)}' cannot narrow into '${lowerer.fmt(targetType)}' behind the present-test`));
                throw new PoisonError();
              }
            } else {
              // The width-lift fallback (arm wrap, re-tag, nested
              // reshape) — the same per-field rule the slot coercion
              // applies. Runs AFTER the optional-completion branch: a
              // present-test has its own semantics a re-tag's stranded
              // undefined trap must not shadow.
              const lift = lowerer.widthLiftPlan(f.type, targetType);
              if (!lift) {
                lowerer.pushDiag(recordShapeMismatchDiag(lowerer.fmt(type), lowerer.fmt(recArm), locOf(prop), `spread field '${f.name}': '${lowerer.fmt(f.type)}' does not lift into '${lowerer.fmt(targetType)}'`));
                throw new PoisonError();
              }
              thenVal = lowerer.applyWidthLift(lift, fRead(), targetType, locOf(prop));
            }
            const at = fields.findIndex((x) => x.name === f.name && !x.drop);
            // No earlier contributor, but every arm the value can hold has the
            // field (no nullish arm left): the first arm's read is the innermost
            // fallback, each later arm's tag test wraps it, and no value is left
            // to need a default.
            if (at < 0 && recArm === recArms[0] && cond.kind === "unionIsTag" && !def.arms.some(isUnitType) &&
                recArms.every((arm) => arm.kind === "record"
                  ? lowerer.shapes.get(arm.shapeId)?.fields.some((x) => x.name === f.name)
                  : lowerer.classes.get(arm.className)?.fields.has(f.name))) {
              fields.push({ name: f.name, value: thenVal });
              continue;
            }
            // A checked-dynamic or page-value slot (`metadata?: unknown`) holds the absent value as its own undefined.
            const elseVal = at >= 0 ? fields[at]!.value : omittedArgFor(lowerer, targetType, locOf(prop));
            if (!elseVal) {
              lowerer.unsupported(
                "SC1090",
                prop,
                `object spread of '${lowerer.fmt(srcType)}' sources where '${f.name}' has no earlier contributor (the absent arm leaves the required field unset — spread defaults first: { ...defaults, ...overrides })`,
              );
            }
            const merged: IrExpr = { kind: "ternary", cond, then: thenVal, else_: elseVal, type: targetType, loc: locOf(prop) };
            if (at >= 0) fields[at] = { name: f.name, value: merged };
            else fields.push({ name: f.name, value: merged });
          }
        }
        continue;
      }
      if (srcType?.kind !== "record" && srcType?.kind !== "object") {
        lowerer.unsupported(
          "SC1090",
          prop,
          `object spread of '${srcType ? lowerer.fmt(srcType) : lowerer.checker.typeToString(lowerer.typeOf(srcNode))}' sources (only known record shapes spread — ${NARROW_FIRST})`,
        );
      }
      // A class instance spreads its own data fields (inherited included; accessors and
      // methods live on the prototype, `#private` and compiler-internal slots are not
      // enumerable properties).
      const srcClass = srcType.kind === "object" ? lowerer.classes.get(srcType.className) : undefined;
      if (srcType.kind === "object" && !srcClass) throw new InternalCompilerError(`lowerer bug: spread of unknown class ${srcType.className}`);
      const srcShape = srcType.kind === "record" ? lowerer.shapes.get(srcType.shapeId) : undefined;
      if (srcType.kind === "record" && !srcShape) throw new InternalCompilerError(`lowerer bug: spread of unknown shape ${srcType.shapeId}`);
      if (srcShape) fenceAccessorSpreadSource(lowerer, prop, srcShape);
      const srcFieldList: { name: string; type: IrType }[] = srcShape
        ? srcShape.fields
        : [...srcClass!.fields].filter(([name]) => !name.startsWith("#") && !name.startsWith("%")).map(([name, type]) => ({ name, type }));
      // Index-signature shapes carry runtime-keyed overflow entries the
      // field-by-field desugar cannot enumerate — fenced on either side.
      if ((srcShape?.indexValue) || shape.indexValue) {
        lowerer.unsupported(
          "SC1090",
          prop,
          "object spread involving index-signature shapes (overflow keys are runtime state — copy the fields you need explicitly)",
        );
      }
      // Names a LATER contributor unconditionally defines: copying such a
      // source field is dead under JS last-write-wins (and spread reads
      // are side-effect-free), so it neither lowers nor width-checks —
      // the spread-then-override completion `{ ...config, stateDir }`
      // narrows an optional source field into a required target slot
      // exactly like Node does. Conditional spreads don't count (their
      // empty arm defines nothing) — their own collision fences hold.
      const laterNames = new Set<string>();
      for (const later of expr.properties.slice(expr.properties.indexOf(prop) + 1)) {
        if (ts.isSpreadAssignment(later)) {
          if (conditionalSpreadArms(later.expression)) continue;
          const lt = laterSpreadType(lowerer, later.expression);
          if (lt?.kind === "record") {
            for (const lf of lowerer.shapes.get(lt.shapeId)?.fields ?? []) if (alwaysOwn(lowerer, lf.type)) laterNames.add(lf.name);
          }
          continue;
        }
        if (
          later.name &&
          (ts.isIdentifier(later.name) ||
            ts.isStringLiteral(later.name) ||
            ts.isNumericLiteral(later.name) ||
            (ts.isComputedPropertyName(later.name) && literalComputedKey(lowerer, later.name) !== null))
        ) {
          laterNames.add(propNameText(lowerer, later.name));
        }
      }
      for (const f of srcFieldList) {
        if (laterNames.has(f.name)) continue;
        const targetType = fieldTypes.get(f.name);
        // A source field with NO slot on the target shape: the copy
        // DROPS it — a spread of a wider record into a narrower literal
        // is width subtyping in spread clothing, divergence 36's stance
        // (Node's object would keep the key); the read is pure, so
        // skipping evaluates nothing.
        if (!targetType) continue;
        const lift = typeEquals(f.type, targetType)
          ? null
          : lowerer.widthLiftPlan(f.type, targetType);
        if (!typeEquals(f.type, targetType) && !lift) {
          // Print the SOURCE shape, not the literal's own type: the
          // checker's own type already has later overrides applied, so
          // it can render identically to the target while the spread
          // source (the thing that actually mismatches) differs — an
          // invisible difference is a diagnostics bug.
          lowerer.pushDiag(recordShapeMismatchDiag(lowerer.fmt(type), lowerer.fmt(srcType), locOf(prop), `spread field '${f.name}': '${lowerer.fmt(f.type)}' does not lift into '${lowerer.fmt(targetType)}'`));
          throw new PoisonError();
        }
        const obj = srcLowered ?? lowerer.lowerExpr(srcNode);
        // A record-mapped CHECKER type whose VALUE lives in the checked-dynamic tree (a
        // JS file-scope object-literal global): read each field from
        // the checked-dynamic tree (dynKeyGet) and VALIDATE it into the source shape's
        // field type (dynCheck) — the checked-dynamic member-read
        // discipline. A missing key answers the dyn undefined, exactly
        // the undefined-armed optional's absent case; a mismatched
        // runtime value throws the catchable TypeError, never a silent
        // wrong copy. Runtime-ADDED keys drop — width subtyping in
        // spread clothing, divergence 36's stance.
        let value: IrExpr;
        if (obj.type.kind === "dyn") {
          if (!canDynCheckTo(f.type, (id) => lowerer.shapes.get(id), (id) => lowerer.unions.get(id))) {
            lowerer.unsupported(
              "SC1100",
              prop,
              `object spread of a checked-dynamic source whose field '${f.name}' ('${lowerer.fmt(f.type)}') cannot validate out of the checked-dynamic tree (copy the fields explicitly)`,
            );
          }
          value = {
            kind: "dynCheck",
            value: {
              kind: "dynKeyGet",
              key: { kind: "strLit", value: f.name, type: STRING, loc: locOf(prop) },
              value: obj,
              type: DYN,
              loc: locOf(prop),
            },
            type: f.type,
            loc: locOf(prop),
          };
        } else if (srcType.kind === "object") {
          value = { kind: "fieldGet", obj, className: srcType.className, field: f.name, type: f.type, loc: locOf(prop) };
        } else {
          value = {
            kind: "recordGet",
            obj,
            shapeId: srcType.shapeId,
            field: f.name,
            type: f.type,
            loc: locOf(prop),
          };
        }
        const read = value;
        // A liftable field widens into the target slot (arm wrap,
        // re-tag, nested reshape) — the same per-field rule the slot
        // coercion applies.
        if (lift) value = lowerer.applyWidthLift(lift, value, targetType, locOf(prop));
        const at = fields.findIndex((x) => x.name === f.name);
        // An optional source field left unset is no own property, so JS
        // copies nothing and the earlier contributor stays
        // (`{ visible: true, ...opts }`). A record's unset optional slot is
        // its undefined arm, the absence `in` and JSON.stringify report.
        const undefTag = f.type.kind === "union" ? lowerer.armTag(f.type.unionId, UNDEFINED_T) : -1;
        if (at >= 0 && !fields[at]!.drop && fields[at]!.value && undefTag >= 0 && f.type.kind === "union") {
          const present: IrExpr = { kind: "unionIsTag", unionId: f.type.unionId, tag: undefTag, negated: true, value: read, type: BOOL, loc: locOf(prop) };
          value = { kind: "ternary", cond: present, then: value, else_: fields[at]!.value!, type: targetType, loc: locOf(prop) };
        }
        if (at >= 0) fields[at] = { name: f.name, value };
        else fields.push({ name: f.name, value });
      }
      continue;
    }
    if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
      // JS accessor entries carry no storage (narrowed away above); TS
      // accessors fill the shape's reserved closure slots — the getter
      // body lowers as an ordinary zero-arg closure invoked per property
      // READ, the setter as a one-arg closure invoked per WRITE
      // (fieldGetExpr/fieldSetStmt dispatch on the slots). Creating the
      // closures is side-effect-free, so their position among the data
      // fields' source-order evaluation is unobservable — exactly JS,
      // where accessor definitions evaluate nothing.
      if (isJsSourceFile(expr.getSourceFile())) continue;
      const name = propNameText(lowerer, prop.name); // key-form-checked above
      const slotName = `${ts.isGetAccessorDeclaration(prop) ? "%get" : "%set"}:${name}`;
      const slotT = fieldTypes.get(slotName);
      if (!slotT || slotT.kind !== "func") {
        // The contextual shape stores a DATA value under this name
        // (`const p: { x: number } = { get x() {...} }` — tsc lets a
        // live accessor satisfy a data member): the slot would freeze
        // one getter answer where Node keeps the accessor live.
        if (fieldTypes.has(name)) {
          lowerer.unsupported(
            "SC1090",
            prop,
            `a get/set accessor satisfying the data property '${name}' of '${lowerer.fmt(type)}' (the record slot stores a plain value — Node would keep the accessor live through this type)`,
          );
        }
        shapeMismatch(prop);
      }
      const closure = lowerer.coerceInto(prop, lowerer.lowerLambda(prop), slotT);
      if (!typeEquals(closure.type, slotT)) lowerer.badType(prop, lowerer.typeOf(prop));
      fields.push({ name: slotName, value: closure });
      continue;
    }
    // `{ ...state, [field]: value }` with `field: 'a' | 'b'`: the key is one of
    // the literal names at run time. The key and the value evaluate once, in
    // source order after everything before them; each named slot then holds
    // `key === name ? value : earlier` (earlier = the spread/previous value, or
    // the omitted optional). Later contributors still override.
    if (ts.isPropertyAssignment(prop) && ts.isComputedPropertyName(prop.name) && literalComputedKey(lowerer, prop.name) === null) {
      const names = literalUnionKeyNames(lowerer, prop.name);
      if (names === null) throw new InternalCompilerError("lowerer bug: runtime computed key reached the field loop");
      for (const field of fields) if (!captured.has(field.value) && !field.drop) field.value = capture(field.value);
      let keyValue = lowerer.lowerExpr(prop.name.expression);
      // A key stored as a union of its literal names reads as the string it is.
      if (keyValue.type.kind === "union") keyValue = lowerer.coerceToExpected(keyValue, STRING);
      if (keyValue.type.kind !== "string") lowerer.badType(prop.name, lowerer.typeOf(prop.name.expression));
      const keyIr = capture(keyValue);
      const rawValue = capture(lowerer.lowerExpr(prop.initializer));
      for (const keyName of names) {
        const slotType = fieldTypes.get(keyName);
        if (!slotType) shapeMismatch(prop);
        const stored = lowerer.coerceInto(prop.initializer, rawValue, slotType);
        if (!typeEquals(stored.type, slotType)) lowerer.badType(prop.initializer, lowerer.typeOf(prop.initializer));
        const at = fields.findIndex((f) => f.name === keyName && !f.drop);
        const prior = at >= 0 ? fields[at]!.value : omittedArgFor(lowerer, slotType, locOf(prop));
        if (!prior) {
          lowerer.unsupported("SC1090", prop, `a computed key that may name the required field '${keyName}' with no earlier contributor (spread the earlier value first: { ...state, [key]: value })`);
        }
        const merged: IrExpr = {
          kind: "ternary",
          cond: { kind: "strEq", negated: false, left: keyIr, right: strLit(keyName, locOf(prop)), type: BOOL, loc: locOf(prop) },
          then: stored, else_: prior, type: slotType, loc: locOf(prop),
        };
        if (at >= 0) fields[at] = { name: keyName, value: merged };
        else fields.push({ name: keyName, value: merged });
      }
      continue;
    }
    const name = propNameText(lowerer, prop.name!); // key-form-checked above
    let fieldType = fieldTypes.get(name);
    // An undeclared name against an index-signature shape is an OVERFLOW
    // entry (tsc typechecked it against the signature's value type);
    // against a plain shape it is the width mismatch it always was —
    // EXCEPT the PromiseSettledResult honest subset's dropped fields
    // (value/reason — SEMANTICS.md 46): those evaluate for effect in
    // their source-order slot and store nothing.
    // A GENERIC-callable member (a generic method `m<T>(x: T) {...}` or a
    // generic arrow/function-expression property): excluded from the
    // record shape (isGenericCallableMemberType — no single closure slot
    // can hold it), so the literal stores nothing for it. Pure
    // function-creating forms skip outright (creating a closure has no
    // side effects; calls resolve statically against this declaration);
    // a computed initializer would need its evaluation kept — fenced.
    if (!fieldType && !ts.isSpreadAssignment(prop)) {
      const memberSym = prop.name ? lowerer.checker.getSymbolAtLocation(prop.name) : undefined;
      const memberT = memberSym ? lowerer.checker.getTypeOfSymbol(memberSym) : undefined;
      if (memberT && isGenericCallableMemberType(memberT, lowerer.checker)) {
        const pureInit = (() => {
          if (ts.isMethodDeclaration(prop)) return true;
          if (ts.isShorthandPropertyAssignment(prop)) return true; // a pure read
          if (!ts.isPropertyAssignment(prop)) return false;
          let init: ts.Expression = prop.initializer;
          while (ts.isParenthesizedExpression(init)) init = init.expression;
          return ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isIdentifier(init);
        })();
        if (!pureInit) {
          lowerer.unsupported(
            "SC1090",
            prop,
            `generic-function-valued properties with computed initializers ('${name}' has no record slot — its evaluation would be dropped; bind the function to a top-level declaration instead)`,
          );
        }
        continue;
      }
    }
    if (!fieldType && !shape.indexValue) {
      if (settledDropNames(lowerer, tsType)?.has(name)) {
        // Identifier and shorthand initializers are effect-free reads —
        // skipped outright. The caught `reason` MUST skip: lowering the
        // read would hit the catch-binding narrowness fence, and the
        // snapshot it names needs no evaluation.
        if (ts.isPropertyAssignment(prop) && !ts.isIdentifier(prop.initializer)) {
          const v = lowerer.lowerExpr(prop.initializer);
          // Effect-free lowerings (literals, plain reads) drop at
          // compile time; anything else — the awaited mapper — runs
          // (and may throw into the enclosing catch) with its result
          // released by the statement frame.
          if (
            v.kind !== "unitLit" && v.kind !== "numLit" && v.kind !== "strLit" &&
            v.kind !== "boolLit" && v.kind !== "varRef" && v.kind !== "closure"
          ) {
            fields.push({ name, value: v, drop: true });
          }
        }
        continue;
      }
      shapeMismatch(prop);
    }

    let value: IrExpr;
    let valueNode: ts.Node = prop;
    const propDiagsBefore = lowerer.diags.length;
    try {
    if (ts.isPropertyAssignment(prop)) {
      valueNode = prop.initializer;
      // Fresh construction gets the field's destination before lowering
      // nested arrays, records, or conditional branches. Existing values
      // retain their runtime representation until the field coercion.
      let init: ts.Expression = prop.initializer;
      while (ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      value =
        fenceClosureProbe(lowerer, prop.initializer, fieldType, () => lowerer.lowerExpr(prop.initializer)) ??
        (fieldType !== undefined && (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init) || ts.isConditionalExpression(init))
          ? lowerer.lowerExprExpecting(prop.initializer, fieldType)
          : lowerer.lowerExpr(prop.initializer));
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      value = lowerer.lowerShorthandValue(prop);
    } else if (ts.isMethodDeclaration(prop)) {
      value =
        fenceClosureProbe(lowerer, prop, fieldType, () => lowerer.lowerLambda(prop)) ?? lowerer.lowerLambda(prop);
    } else {
      lowerer.unsupported("SC1090", prop, `syntax '${ts.syntaxKindName((prop as ts.Node).kind)}'`);
    }
    } catch (err) {
      // A member VALUE a JS file cannot lower (a namespace object in an
      // export aggregate — the sharedWithCli `errors` member): the
      // member NARROWS AWAY like a CJS export-table accessor entry —
      // the diagnostics defer to the runtime-fence ledger, the shape
      // drops the field, and each READ of it meets its own per-site
      // fence. Pure member forms only (identifier/shorthand reads);
      // TypeScript, probe mode, and ICEs keep the poison.
      const pureMember =
        ts.isShorthandPropertyAssignment(prop) ||
        (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer));
      if (
        !(err instanceof PoisonError) ||
        !pureMember ||
        !isJsSourceFile(expr.getSourceFile()) ||
        lowerer.diagSink !== null ||
        lowerer.diags.length <= propDiagsBefore ||
        lowerer.diags.slice(propDiagsBefore).some((d) => d.code === "SC9001")
      ) {
        throw err;
      }
      lowerer.runtimeFences.push(...lowerer.diags.splice(propDiagsBefore));
      droppedNames.add(name);
      continue;
    }
    if (!fieldType) {
      // Overflow entry: the value flows into the index signature's value
      // slot — dyn slots take a dyn conversion (dynFrom), typed slots the
      // ordinary coercion path. Later duplicates override (map semantics
      // are last-write-wins already; a duplicate literal key is a tsc
      // error anyway).
      const slotted = lowerer.intoIndexValueSlot(value, shape.indexValue!, valueNode);
      fields.push({ name, value: slotted, overflow: true });
      continue;
    }
    const promotedField = fieldType ? lowerer.runtimeOptionalWidening(value.type, fieldType) : null;
    if (promotedField && fieldType) {
      type = lowerer.runtimeOptionalRecordField(type, name, promotedField);
      if (type.kind === "record") shape = lowerer.shapes.get(type.shapeId)!;
      fieldTypes.set(name, promotedField);
      fieldType = promotedField;
    }
    value = lowerer.coerceInto(valueNode, value, fieldType); // union-typed fields wrap arm values
    if (!typeEquals(value.type, fieldType)) lowerer.badType(valueNode, lowerer.typeOf(valueNode));
    // An explicit property overrides a spread-copied field: JS
    // last-write-wins. The entry moves to the END so explicit property
    // values keep their source-order evaluation among themselves. An
    // overridden conditional-spread entry was already snapshotted into a
    // hidden local at the top of this iteration, so its evaluation stays.
    const at = fields.findIndex((x) => x.name === name);
    if (at >= 0) fields.splice(at, 1);
    fields.push({ name, value });
  }
  // Optional fields may be omitted: the absent field holds an undefined
  // union arm or, for an island handle slot, the engine's undefined cell.
  // This matches writing `a: undefined` without exactOptionalPropertyTypes;
  // tsc rejects omission of required fields before lowering.
  // A REQUIRED missing field keeps the shape-mismatch rejection (possible
  // through `as`: the cast smuggles a narrower literal past freshness).
  if (droppedNames.size > 0) {
    const narrowed = shape.fields.filter((f) => !droppedNames.has(f.name));
    const narrowedId = lowerer.shapes.intern(
      narrowed.map((f) => ({ name: f.name, type: f.type })),
      false,
      shape.indexValue,
    );
    type = { kind: "record", shapeId: narrowedId };
    shape = lowerer.shapes.get(narrowedId)!;
  }
  if (fields.filter((f) => !f.overflow).length !== shape.fields.length) {
    const provided = new Set(fields.filter((f) => !f.overflow).map((f) => f.name));
    for (const f of shape.fields) {
      if (provided.has(f.name)) continue;
      // 'unknown' fields complete with the dyn undefined — the absent
      // property reads as undefined in Node, and a dyn slot holds
      // exactly that (the options-record call shape against
      // `{ plugins: unknown, ... }` — a JS caller the checker admits).
      // Optional on the destination's object type: a `T | null` slot (a
      // nullable return type) answers no property itself, so ask its
      // non-nullish members.
      const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
      const members = tsType.isUnionType() ? ts.constituentTypes(tsType).filter((t) => (t.flags & nullish) === 0) : [tsType];
      // A field none of those types declares comes from the wider layout the
      // literal is BUILT at (interface class arms: `const base = { count: 2 }`
      // flowing into `Result`): tsc admitted that flow, so the destination's
      // field is optional by construction.
      const props = members.map((t) => lowerer.checker.getPropertyOfType(t, f.name));
      const optional = props.every((prop) => prop === undefined) ||
        props.some((prop) => ((prop?.flags ?? 0) & ts.SymbolFlags.Optional) !== 0);
      const absentHandle: IrExpr | null = f.type.kind === "jsval" && optional
        ? { kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc }
        : null;
      const absent = lowerer.wrappedUndefined(f.type, loc) ??
        (f.type.kind === "dyn" ? dynUndefinedExpr(loc) : null) ??
        absentHandle;
      if (!absent) shapeMismatch(expr); // only optional and 'unknown' fields may be omitted
      fields.push({ name: f.name, value: absent });
    }
  }
  const literal: IrExpr = { kind: "recordLit", fields, type, loc };
  const result: IrExpr = carrySources.length > 0 && nativeDyn() && !shape.tuple && !shape.indexValue
    ? { kind: "libCall", fn: "record.carry", args: [literal, ...carrySources], type, loc } : literal;
  return spreadStmts.length === 0 ? result : { kind: "seqExpr", stmts: spreadStmts, result, type, loc };
}

/** A union of plain records can preserve its existing variant while
 * replacing shared fields. Dispatch before constructing the copy: only
 * the selected arm evaluates overrides, and recordClone snapshots fields
 * before an override can mutate the original. Nested references retain
 * their identity. Changing a discriminator or adding variant-specific
 * fields needs a different result layout and stays on the ordinary path. */
function lowerUnionRecordClone(lowerer: Lowerer, expr: ts.ObjectLiteralExpression): IrExpr | null {
  if (isJsSourceFile(expr.getSourceFile())) return null;
  const spread = expr.properties[0];
  if (!spread || !ts.isSpreadAssignment(spread)) return null;
  let sourceNode = spread.expression;
  while (ts.isParenthesizedExpression(sourceNode) || ts.isSatisfiesExpression(sourceNode)) sourceNode = sourceNode.expression;
  // Conditional spreads construct optional keys, including the empty arm.
  // Their dedicated lowering owns that layout rather than a union clone.
  if (ts.isConditionalExpression(sourceNode)) return null;
  const sourceType = lowerer.mapTypeOf(lowerer.typeOf(spread.expression));
  if (sourceType?.kind !== "union") return null;
  const def = lowerer.unions.get(sourceType.unionId);
  if (!def || def.arms.length < 2 || !def.arms.every((arm) => arm.kind === "record")) return null;
  const props: (ts.PropertyAssignment | ts.ShorthandPropertyAssignment)[] = [];
  const names: string[] = [];
  for (const prop of expr.properties.slice(1)) {
    if ((!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) ||
        (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))) return null;
    const name = prop.name.text;
    if (names.includes(name) || name === def.discriminant?.field || name === "__proto__") return null;
    props.push(prop);
    names.push(name);
  }
  for (const arm of def.arms) {
    if (arm.kind !== "record") return null;
    const shape = lowerer.shapes.get(arm.shapeId);
    if (!shape || shape.indexValue || shape.tuple || shapeHasAccessorSlots(shape) ||
        !names.every((name) => shape.fields.some((field) => field.name === name))) return null;
    for (let index = 0; index < props.length; index++) {
      const prop = props[index]!;
      const node = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
      const valueType = lowerer.mapTypeOf(lowerer.typeOf(node));
      const fieldType = shape.fields.find((field) => field.name === names[index])!.type;
      const lift = valueType ? lowerer.widthLiftPlan(valueType, fieldType) : null;
      // The inferred result must retain an override's own fields and
      // aliases. A structural copy into the source field's narrower shape
      // would silently reshape an unannotated spread expression.
      if (!lift) return null;
      if (lift.how === "retag" && valueType?.kind === "union" && fieldType.kind === "union") {
        const from = lowerer.unions.get(valueType.unionId);
        const to = lowerer.unions.get(fieldType.unionId);
        const plan = from && to ? planUnionRetag(from, to, (id) => lowerer.shapes.get(id),
          (source, target) => lowerer.widthLiftPlan(source, target)) : null;
        if (!plan || !plan.every((arm) => arm.kind === "direct"
          ? arm.route.lift.how === "copy" || arm.route.lift.how === "upcast"
          : arm.kind === "discriminant" && arm.routes.every((route) => route.lift.how === "copy" || route.lift.how === "upcast"))) return null;
      } else if (lift.how !== "copy" && lift.how !== "wrap" && lift.how !== "upcast") return null;
    }
  }
  let source = lowerer.lowerExpr(spread.expression);
  // Hidden runtime absence must never be mistaken for a record payload.
  // An earlier guard can remove that arm; an unguarded optional spread
  // still needs a destination able to represent the empty copy.
  if (!typeEquals(source.type, sourceType) && source.type.kind === "union" && ts.isIdentifier(spread.expression)) {
    const local = lowerer.resolveLocal(spread.expression);
    const symbol = lowerer.resolveValueSymbol(spread.expression);
    const captured = local?.boxed === true || symbol && lowerer.ctx.captureBySymbol.has(symbol);
    if (local && !captured && !lowerer.runtimeOptionalLocals.has(lowerer.runtimeOptionalRootOf(local))) {
      const helper = lowerer.narrowedRetagHelper(spread.expression, source.type.unionId, sourceType.unionId, source.loc);
      if (helper) source = { kind: "call", callee: helper, args: [source], type: sourceType, loc: source.loc };
    }
  }
  // A member read the checker narrowed past its absent arm (`options.sampler && { ...options.sampler }`): when the
  // narrowing is provably current (narrowing-stability.ts) the stored value holds a record arm, so the same retag
  // is exact. A narrowing a call may have invalidated keeps the loud refusal below.
  if (!typeEquals(source.type, sourceType) && source.type.kind === "union" && ts.isPropertyAccessExpression(spread.expression) &&
      !lowerer.narrowing.untrusted(spread.expression, sourceType)) {
    const helper = lowerer.narrowedRetagHelper(spread.expression, source.type.unionId, sourceType.unionId, source.loc);
    if (helper) source = { kind: "call", callee: helper, args: [source], type: sourceType, loc: source.loc };
  }
  if (!typeEquals(source.type, sourceType)) {
    lowerer.unsupported("SC1090", spread, "a union record clone whose stored source still includes absence");
  }
  const loc = locOf(expr);
  const saved = lowerer.declareHiddenLocal("%unionClone", sourceType);
  const ref = varRef(saved.id, sourceType, loc);
  let result: IrExpr | null = null;
  for (let tag = def.arms.length - 1; tag >= 0; tag--) {
    const arm = def.arms[tag]!;
    if (arm.kind !== "record") throw new InternalCompilerError("union clone arm is not a record");
    const shape = lowerer.shapes.get(arm.shapeId)!;
    const overrides: { name: string; value: IrExpr }[] = [];
    for (let index = 0; index < props.length; index++) {
      const prop = props[index]!;
      const name = names[index]!;
      const fieldType = shape.fields.find((field) => field.name === name)!.type;
      const value = ts.isPropertyAssignment(prop)
        ? lowerer.lowerExprExpecting(prop.initializer, fieldType)
        : lowerer.coerceInto(prop, lowerer.lowerShorthandValue(prop), fieldType);
      overrides.push({ name, value });
    }
    const clone: IrExpr = { kind: "recordClone",
      source: { kind: "unionNarrow", value: ref, unionId: sourceType.unionId, tag, type: arm, loc },
      overrides, type: arm, loc };
    const wrapped: IrExpr = { kind: "unionWrap", value: clone, unionId: sourceType.unionId, tag, type: sourceType, loc };
    result = result === null ? wrapped : {
      kind: "ternary", cond: { kind: "unionIsTag", value: ref, unionId: sourceType.unionId, tag, negated: false, type: BOOL, loc },
      then: wrapped, else_: result, type: sourceType, loc,
    };
  }
  if (result === null) throw new InternalCompilerError("union clone has no arms");
  return { kind: "seqExpr", stmts: [{ kind: "varDecl", localId: saved.id, init: source, loc }], result, type: sourceType, loc };
}

/** A conditional spread's carrier property: `name: value` or shorthand,
 * with an identifier/string-literal name. */
export type CondSpreadProp = (ts.PropertyAssignment | ts.ShorthandPropertyAssignment) & { name: ts.Identifier | ts.StringLiteral };

/** One arm of a conditional spread: the literal's simple members (empty =
 * contributes nothing), or a non-literal expression whose record value
 * spreads when the arm is taken. */
export type CondArm = { props: CondSpreadProp[] } | { expr: ts.Expression };
export interface CondSpreadArms { cond: ts.Expression; whenTrue: CondArm; whenFalse: CondArm }

function unwrapParens(a: ts.Expression): ts.Expression {
  let x = a;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** An arm that spreads nothing: `{}`, `undefined`, `null`, `void 0`. */
function isEmptySpreadArm(a: ts.Expression): boolean {
  const x = unwrapParens(a);
  if (ts.isObjectLiteralExpression(x)) return x.properties.length === 0;
  if (x.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(x) && x.text === "undefined") return true;
  return ts.isVoidExpression(x);
}

function condArmOf(a: ts.Expression): CondArm | "unsupported" {
  const x = unwrapParens(a);
  if (isEmptySpreadArm(x)) return { props: [] };
  if (!ts.isObjectLiteralExpression(x)) return { expr: x };
  const props: CondSpreadProp[] = [];
  for (const p of x.properties) {
    if (
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
    ) {
      props.push(p as CondSpreadProp);
    } else {
      return "unsupported";
    }
  }
  return { props };
}

/** Parses every conditional-spread form: `c ? A : B` where one arm spreads
 * nothing (`{}` / `undefined` / `null` / `void 0`) or both are literals, and
 * `c && { ... }` (a false `c` spreads nothing). An arm is a literal's simple
 * members or an arbitrary record-valued expression (`c ? {} : build()`).
 * "unsupported" for non-idiom conditionals (both arms expressions, computed
 * or method members); null when the source isn't a conditional at all. */
export function conditionalSpreadArms(expr: ts.Expression): CondSpreadArms | "unsupported" | null {
  const e = unwrapParens(expr);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = unwrapParens(e.right);
    if (!ts.isObjectLiteralExpression(right)) return null;
    const arm = condArmOf(right);
    if (arm === "unsupported") return "unsupported";
    return { cond: e.left, whenTrue: arm, whenFalse: { props: [] } };
  }
  if (!ts.isConditionalExpression(e)) return null;
  const t = condArmOf(e.whenTrue);
  const f = condArmOf(e.whenFalse);
  if (t === "unsupported" || f === "unsupported") return "unsupported";
  if ("expr" in t && "expr" in f) return "unsupported";
  // Both arms empty is tsc-unreachable.
  return { cond: e.condition, whenTrue: t, whenFalse: f };
}

/** Parses the conditional-spread idiom `...(c ? { k: v, ... } : {})`
 * (either orientation; the empty arm may be `undefined`/`null`). Returns the
 * condition, the non-empty arm's properties, and which arm carries them;
 * "unsupported" for conditional sources OUTSIDE the idiom (both arms
 * non-empty, expression arms, computed/method members); null when the
 * spread source isn't a conditional at all. Callers slice their own honest
 * subset (the static record path takes any number; spawn's options walk
 * takes a `detached` boolean literal). */
export function conditionalSpreadOf(expr: ts.Expression):
  | { cond: ts.Expression; props: CondSpreadProp[]; whenTrue: boolean }
  | "unsupported"
  | null {
  const e = unwrapParens(expr);
  if (!ts.isConditionalExpression(e)) return null;
  const arms = conditionalSpreadArms(e);
  if (arms === null || arms === "unsupported") return "unsupported";
  const t = arms.whenTrue, f = arms.whenFalse;
  if (!("props" in t) || !("props" in f)) return "unsupported";
  const trueCarries = f.props.length === 0 && t.props.length > 0;
  const falseCarries = t.props.length === 0 && f.props.length > 0;
  if (!trueCarries && !falseCarries) return "unsupported";
  return { cond: e.condition, props: trueCarries ? t.props : f.props, whenTrue: trueCarries };
}

/** `{ ...idx, ...idx2 }` typed a DECLARED shape (no index signature) — the
 * defaults-merge idiom over runtime-keyed sources (`{ ...fromEntries(a),
 * ...fromEntries(b) }` typed AppConfig). Lowers to ONE interned helper
 * call: sources evaluate once each as arguments (source order — computed
 * sources included, JS's evaluate-once), the result starts all-undefined
 * (every target field must be optional — the runtime keys decide
 * presence), and each source's keys apply in JS own-key order with a
 * per-key dispatch onto the declared fields: a matching key writes the
 * field — identity when the source's value slot IS the field type, a
 * validated extraction otherwise (a dyn slot dynChecks; a union slot
 * re-tags arm-by-arm, and a value outside the field's arms throws the
 * catchable TypeError — divergence 34's keyed-write stance, where Node's
 * untyped copy would store the lie) — and a key naming NO declared field
 * is DROPPED (the shape cannot represent it; Node keeps it invisibly —
 * divergence 68). Later contributors overwrite earlier ones
 * (last-write-wins). Fixed, hybrid, and pure index records may contribute. */
function lowerDeclaredSpreadMerge(lowerer: Lowerer, expr: ts.ObjectLiteralExpression,
  type: IrType & { kind: "record" },
  shape: IrRecordShape,
  loc: SrcLoc,): IrExpr {
  interface Src { value: IrExpr; shapeId: string; shape?: IrRecordShape }
  const srcs: Src[] = [];
  for (const prop of expr.properties) {
    const spread = prop as ts.SpreadAssignment; // caller-checked: all spreads
    const value = lowerer.lowerExpr(spread.expression);
    if (value.type.kind === "dyn") {
      srcs.push({ value, shapeId: "dyn" });
      continue;
    }
    const srcShape = value.type.kind === "record" ? lowerer.shapes.get(value.type.shapeId) : undefined;
    if (value.type.kind !== "record" || !srcShape || srcShape.tuple) {
      lowerer.unsupported("SC1090", prop,
        `object spread of '${lowerer.fmt(value.type)}' into '${lowerer.fmt(type)}' (only records spread into a declared shape)`);
    }
    fenceAccessorSpreadSource(lowerer, prop, srcShape);
    srcs.push({ value, shapeId: value.type.shapeId, shape: srcShape });
  }
  // Every target field must be optional: absent keys leave the undefined
  // arm, exactly the unset-optional representation.
  for (const f of shape.fields) {
    if (f.type.kind !== "union" || lowerer.armTag(f.type.unionId, UNDEFINED_T) < 0) {
      lowerer.unsupported(
        "SC1090",
        expr,
        `object spread of runtime-keyed sources onto the required field '${f.name}' (the keys decide presence at runtime — declare the field optional or spell it explicitly)`,
      );
    }
  }
  // Per (source value slot → field) conversion, checked up front so the
  // fence fires at the literal, not inside the interned helper.
  const conv = (iv: IrType, f: { name: string; type: IrType }, v: IrExpr): { value: IrExpr } | { stmts: (write: (value: IrExpr) => IrStmt) => IrStmt[] } => {
    if (typeEquals(iv, f.type)) return { value: v };
    if (iv.kind === "dyn") {
      return { value: { kind: "dynCheck", value: v, type: f.type, loc } };
    }
    if (iv.kind === "union" && f.type.kind === "union") {
      const fUnion = f.type;
      const def = lowerer.unions.get(iv.unionId);
      const fDef = lowerer.unions.get(fUnion.unionId);
      if (def && fDef && def.arms.some((a) => lowerer.armTag(fUnion.unionId, a) >= 0)) {
        // Arm-by-arm validated re-tag, inline in the helper: matching
        // arms map by identity (unit arms re-wrap, value arms narrow and
        // wrap); anything else throws the catchable TypeError.
        return {
          stmts: (write) => {
            const chain = (i: number): IrStmt[] => {
              if (i >= def.arms.length) {
                return [{
                  kind: "throw",
                  value: {
                    kind: "libCall",
                    fn: "error.new",
                    args: [{ kind: "strLit", value: `expected ${lowerer.fmt(fUnion)} at $.${f.name}`, type: STRING, loc }],
                    type: { kind: "object", className: "%TypeError" },
                    loc,
                  },
                  loc,
                }];
              }
              const arm = def.arms[i]!;
              const toTag = lowerer.armTag(fUnion.unionId, arm);
              if (toTag < 0) return chain(i + 1);
              const extracted: IrExpr = isUnitType(arm)
                ? { kind: "unionWrap", unionId: fUnion.unionId, tag: toTag, value: { kind: "unitLit", unit: arm.kind === "undefinedT" ? "undefined" : "null", type: arm, loc }, type: fUnion, loc }
                : { kind: "unionWrap", unionId: fUnion.unionId, tag: toTag, value: { kind: "unionNarrow", unionId: iv.unionId, tag: i, value: v, type: arm, loc }, type: fUnion, loc };
              return [{
                kind: "if",
                cond: { kind: "unionIsTag", unionId: iv.unionId, tag: i, negated: false, value: v, type: BOOL, loc },
                then: [write(extracted)],
                else_: chain(i + 1),
                loc,
              }];
            };
            return chain(0);
          },
        };
      }
    }
    lowerer.unsupported(
      "SC1090",
      expr,
      `object spread into '${lowerer.fmt(type)}' where the source's '${lowerer.fmt(iv)}' values cannot reach the '${lowerer.fmt(f.type)}' field '${f.name}' (the value slot must be the field type, 'unknown', or a union covering the field's arms)`,
    );
  };
  // Apply each source before evaluating the next expression. Passing all
  // sources as one helper's arguments would read an earlier record after a
  // later source factory mutated it, contrary to object spread evaluation.
  const out = lowerer.declareHiddenLocal("%declMerge", type);
  const outRef = varRef(out.id, type, loc);
  const stmts: IrStmt[] = [{
    kind: "varDecl", localId: out.id,
    init: { kind: "recordLit", fields: shape.fields.map((f) => ({ name: f.name, value: lowerer.wrappedUndefined(f.type, loc)! })), type, loc },
    loc,
  }];
  for (const source of srcs) {
    const key = `declmerge-source:${type.shapeId}:${source.shapeId}`;
    let helper = lowerer.widthHelpers.get(key);
    if (!helper) {
      helper = keyedHelperName(lowerer, "%rec.declmerge", key);
      const sourceType = source.value.type;
      const destination = varRef("out.0", type, loc);
      const receiver = varRef("source.0", sourceType, loc);
      const locals: IrLocal[] = [
        { id: "out.0", name: "out", type, mutable: false },
        { id: "source.0", name: "source", type: sourceType, mutable: false },
      ];
      const body: IrStmt[] = [];
      if (!source.shape) {
        // CopyDataProperties skips nullish sources, even when an erased
        // record view supplies the checker's apparent object type.
        body.push({
          kind: "if", cond: { kind: "dynTest", test: "nullish", value: receiver, type: BOOL, loc },
          then: [{ kind: "return", value: destination, loc }], else_: null, loc,
        });
      }
      for (const field of source.shape?.fields ?? []) {
        const target = shape.fields.find((candidate) => candidate.name === field.name);
        if (!target) continue; // The declared destination drops extra keys.
        const raw: IrExpr = { kind: "recordGet", obj: receiver, shapeId: source.shapeId, field: field.name, type: field.type, loc };
        const lift = lowerer.widthLiftPlan(field.type, target.type);
        if (!lift) {
          lowerer.unsupported("SC1090", expr,
            `object spread of field '${field.name}' from '${lowerer.fmt(field.type)}' into '${lowerer.fmt(target.type)}'`);
        }
        const write: IrStmt = {
          kind: "recordSet", obj: destination, shapeId: type.shapeId, field: field.name,
          value: lowerer.applyWidthLift(lift, raw, target.type, loc), loc,
        };
        // Optional declared fields use the established unset convention.
        // A dyn field, including a present undefined, is a real property;
        // its checked conversion runs and can overwrite an earlier value.
        const absent = field.type.kind === "union" ? lowerer.armTag(field.type.unionId, UNDEFINED_T) : -1;
        if (absent >= 0 && field.type.kind === "union") {
          body.push({ kind: "if", cond: {
            kind: "unionIsTag", unionId: field.type.unionId, tag: absent, negated: true, value: raw, type: BOOL, loc,
          }, then: [write], else_: null, loc });
        } else body.push(write);
      }
      const iv = source.shape ? source.shape.indexValue : DYN;
      if (iv) {
        const keysType = arrayOf(STRING);
        const keys = varRef("keys.0", keysType, loc);
        const index = varRef("index.0", F64, loc);
        const name = varRef("key.0", STRING, loc);
        const value = varRef("value.0", iv, loc);
        locals.push(
          { id: "keys.0", name: "keys", type: keysType, mutable: false },
          { id: "index.0", name: "index", type: F64, mutable: true },
          { id: "key.0", name: "key", type: STRING, mutable: false },
          { id: "value.0", name: "value", type: iv, mutable: false },
        );
        const dispatch = shape.fields.reduceRight<IrStmt[]>((rest, field) => {
          const write = (value: IrExpr): IrStmt => ({ kind: "recordSet", obj: destination, shapeId: type.shapeId, field: field.name, value, loc });
          const converted = conv(iv, field, value);
          return [{
            kind: "if",
            cond: { kind: "strEq", negated: false, left: name, right: { kind: "strLit", value: field.name, type: STRING, loc }, type: BOOL, loc },
            then: "value" in converted ? [write(converted.value)] : converted.stmts(write),
            else_: rest.length > 0 ? rest : null, loc,
          }];
        }, []);
        body.push(
          { kind: "varDecl", localId: "keys.0", init: source.shape
            ? { kind: "recordOvfKeys", obj: receiver, shapeId: source.shapeId, type: keysType, loc }
            : { kind: "dynCheck", value: { kind: "libCall", fn: "dyn.objKeys", args: [receiver], type: DYN, loc }, type: keysType, loc }, loc },
          {
            kind: "for",
            init: { kind: "varDecl", localId: "index.0", init: numLit(0, loc), loc },
            cond: { kind: "bin", op: "<", left: index, right: { kind: "arrIntrinsic", method: "length", receiver: keys, args: [], type: F64, loc }, type: BOOL, loc },
            update: { kind: "assign", localId: "index.0", value: { kind: "bin", op: "+", left: index, right: numLit(1, loc), type: F64, loc }, loc },
            body: [
              { kind: "varDecl", localId: "key.0", init: { kind: "arrayGet", arr: keys, index, type: STRING, loc }, loc },
              { kind: "varDecl", localId: "value.0", init: source.shape
                ? { kind: "recordKeyGet", obj: receiver, shapeId: source.shapeId, key: name, overflowOnly: true, type: iv, loc }
                : { kind: "dynKeyGet", value: receiver, key: name, type: DYN, loc }, loc },
              ...dispatch,
            ], loc,
          },
        );
      }
      body.push({ kind: "return", value: destination, loc });
      lowerer.liftedFns.push({
        name: helper,
        params: [{ localId: "out.0", name: "out", type }, { localId: "source.0", name: "source", type: sourceType }],
        returnType: type, locals, body, loc,
      });
      // Publish only a fully checked helper: rejected conversions must not
      // leave an entry that a later literal could reuse without a body.
      lowerer.widthHelpers.set(key, helper);
    }
    stmts.push({ kind: "exprStmt", expr: { kind: "call", callee: helper, args: [outRef, source.value], type, loc }, loc });
  }
  return { kind: "seqExpr", stmts, result: outRef, type, loc };
}

/** The value of a shorthand property (`{ x }`): the binding `x` refers to.
 * The property name's own symbol is the PROPERTY, so resolution goes
 * through getShorthandAssignmentValueSymbol. */
export function lowerShorthandValue(lowerer: Lowerer, prop: ts.ShorthandPropertyAssignment): IrExpr {
  // 7 types the shorthand's name as PropertyName; it is always an
  // Identifier (the grammar allows nothing else in shorthand position).
  const propName = prop.name as ts.Identifier;
  const loc = locOf(propName);
  const symbol = lowerer.checker.getShorthandAssignmentValueSymbol(prop);
  // Import identifiers in shorthand position carry the property's symbol,
  // so the ordinary identifier expression path cannot resolve them.
  const builtin = lowerer.builtinImportOf(propName);
  if (builtin) {
    const callable = lowerer.lowerBuiltinCallableValue(builtin, loc);
    if (callable) return callable;
  }
  if (symbol) {
    if (lowerer.ctx.selfSymbol === symbol) {
      return { kind: "selfRef", type: lowerer.ctx.selfType!, loc };
    }
    // resolveLocal also normalizes a PARAMETER PROPERTY (`constructor(private engine)` then `{ engine }`):
    // the shorthand's value symbol is the property's, the local is keyed by the parameter's.
    const local = lowerer.resolveKey(symbol, propName) ?? lowerer.resolveLocal(propName);
    if (local) {
      return lowerer.maybeNarrow({ kind: "varRef", localId: local.id, type: local.type, loc }, propName);
    }
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? lowerer.checker.getAliasedSymbol(symbol) : symbol;
    lowerer.flushDeferred(resolved);
    const g = lowerer.globalsBySymbol.get(resolved);
    if (g) {
      return lowerer.maybeNarrow({ kind: "varRef", localId: g.id, type: g.type, loc }, propName);
    }
    const sig = lowerer.fnSigsBySymbol.get(resolved);
    const decl = lowerer.checker.declarationsOf(resolved)[0];
    if (
      sig && decl && ts.isFunctionDeclaration(decl) &&
      (ts.isSourceFile(decl.parent) || (decl.parent !== undefined && lowerer.nsBlocks.get(decl.parent) === "flattened"))
    ) {
      lowerer.noteEdge(sig.name);
      const funcType: IrType = {
        kind: "func",
        params: sig.params.filter((p) => p.mode !== "dynRest").map((p) => p.type),
        ret: sig.returnType,
        ...(sig.params.some((p) => p.mode === "dynRest") ? { rest: true as const } : {}),
      };
      lowerer.requireExactArityValue(prop, propName, sig.params, funcType);
      return { kind: "closure", fnName: sig.name, captures: [], type: funcType, loc };
    }
    const generic = lowerer.genericFnsBySymbol.get(resolved);
    if (generic?.implicitParams) return lowerer.lowerGenericFnValue(propName, generic);
    if (generic) {
      lowerer.unsupported(
        "SC1090",
        prop,
        `generic functions as values (call '${propName.text}' directly)`,
      );
    }
  }
  lowerer.rejectUnresolvedSymbol(
    symbol ? (symbol.flags & ts.SymbolFlags.Alias ? lowerer.checker.getAliasedSymbol(symbol) : symbol) : null,
    propName.text,
    prop,
    `the reference to '${propName.text}' (a binding form with no lowering)`,
  );
}

/** Rejects the method's own receiver, including lexical captures in
 * arrows. Nested ordinary functions bind their own ambient receiver. */
export function rejectThisInObjectMethod(lowerer: Lowerer, node: ts.Node): void {
  if (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isAccessor(node)) return;
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    lowerer.unsupported("SC1090", node, "references to 'this' in object literal methods");
  }
  ts.forEachChild(node, (child) => lowerer.rejectThisInObjectMethod(child));
}

/** The accessor twin of rejectThisInObjectMethod: a get/set accessor body
 * referencing `this` (`get x() { return this._x }`). The accessor lowers
 * as a closure stored IN the record — passing the record as a receiver
 * would capture the value under construction (an RC cycle), and the
 * generic lexical-this walk would silently bind an ENCLOSING method's
 * `this`; the fence names the fix (capture a binding instead). */
function rejectThisInObjectAccessor(lowerer: Lowerer, node: ts.Node): void {
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    lowerer.unsupported(
      "SC1090",
      node,
      "references to 'this' in object literal get/set accessors (the accessor lowers as a captured closure with no receiver — read a captured binding instead)",
    );
  }
  ts.forEachChild(node, (child) => rejectThisInObjectAccessor(lowerer, child));
}
