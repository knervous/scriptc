// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import * as ts from "../../ts7/adapter.js";
import { DYN, JSVAL, NULL_T, STRING, UNDEFINED_T, VOID, isUnitType, typeEquals } from "../../../ir/ir.js";
import type { IrExpr, IrStmt, IrType, SrcLoc } from "../../../ir/ir.js";
import { transformExpr } from "../../../ir/traverse.js";
import { isNodeEsmFile, locOf } from "../../program.js";
import { dynUndefinedExpr, type Lowerer } from "../lowerer.js";
import { nativeDyn } from "../../browser-target.js";
import { lowerAbsenceProbe } from "../lower-exprs.js";

/** One optional-chain STEP: `a?.b`, `a?.m(...)`, `a?.[i]` (the token on
 * the member access) and `f?.()` (the token on the call). The receiver
 * lowers once; when it is a unit-armed union, the
 * member/call lowers exactly as its non-optional spelling would — the
 * receiver node reads back as the chain's bound narrowed value
 * (chainRecv) and types as its non-nullish type — and the whole thing
 * becomes an optChain node: tag test, undefined on the unit path (JS:
 * null receivers still yield undefined), the body lazily otherwise,
 * argument side effects included. A receiver the checker types
 * never-nullish makes `?.` behave exactly like `.` — the guard folds
 * away and the plain lowering is the value (trust-the-checker, like
 * ??'s fold). Multi-step TAILS (`a?.b.c`, `x?.trim().toLowerCase()`)
 * short-circuit whole: the guarded member step is the chain's dot and
 * every later step lowers inside the guard, checker-narrowed non-nullish
 * (see chainTailDot). Multiple present variants keep their tag until the
 * guarded body retags them to the non-nullish receiver type. */
/** The unhandled `?.`-carrying MEMBER step in this node's receiver
 * spine, when the node is the TAIL of an optional chain whose token sits
 * deeper — `x?.trim().toLowerCase()` reads nothing past the guard when x
 * is nullish, so the whole tail must lower inside it. Walks
 * property/element accesses and call steps only (parens and `!` break
 * the chain per the grammar: `(a?.b).c` throws on undefined in JS);
 * the node's OWN token — and a call's immediate callee token — are the
 * plain entries' cases, not tails, and handled markers make the chain
 * lowering's re-dispatch walk past its own step. `f?.()` steps stay out
 * (a call carrying the token has no member step to re-enter — the
 * split-it fence keeps them). */
function chainTailDot(
  lowerer: Lowerer,
  expr: ts.Expression,
): ts.PropertyAccessExpression | ts.ElementAccessExpression | null {
  let cur: ts.Expression = expr;
  for (;;) {
    // An active chain's bound receiver read is a LEAF — its own token
    // was consumed by the chain that bound it.
    if (lowerer.chainRecvByNode.has(cur)) return null;
    if (ts.isCallExpression(cur)) {
      // `f?.()` steps route through their own entry (or are being
      // handled); a deeper token under one is that chain's business. A
      // handled one (an always-present class method's `?.(`) is a plain call.
      if (cur.questionDotToken && !lowerer.chainHandled.has(cur)) return null;
      cur = cur.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
      if (cur.questionDotToken) {
        // The node's own token and a call's immediate callee token are
        // the plain entries' cases; a handled one is mid-re-dispatch
        // (its receiver read, further down, ends the walk). The walk
        // NEVER continues past an unhandled deeper token: that guard is
        // where this tail's chain enters — anything below it belongs to
        // the receiver's own (nested) chain.
        if (cur === expr || lowerer.chainHandled.has(cur)) {
          cur = cur.expression;
          continue;
        }
        if (ts.isCallExpression(expr) && expr.expression === cur) return null;
        return cur;
      }
      cur = cur.expression;
      continue;
    }
    return null;
  }
}

/** True when `expr` is `require.main.filename` (either dot optional) on
 * the AMBIENT CommonJS require — the entry-module identity read. The
 * value is the ENTRY file's path, a compile-time constant like
 * __filename; ESM files stay out (Node never defines require there —
 * the ambient symbol would not resolve anyway). Shared by the property
 * lowering (the fold) and lowerStringMethodCall's receiver gate (the
 * checker types the chain `string | undefined`, but the folded receiver
 * IS a string). */
export function isRequireMainFilename(lowerer: Lowerer, expr: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expr) || expr.name.text !== "filename") return false;
  const main = expr.expression;
  if (!ts.isPropertyAccessExpression(main) || main.name.text !== "main") return false;
  if (!lowerer.isStdlibGlobal(main.expression, "require")) return false;
  return !isNodeEsmFile(expr.getSourceFile(), lowerer.program);
}

/** True when `expr` is the tail of an optional chain that must short-circuit
 * whole: an unhandled deeper `?.` guarded by a unit-armed union or an island
 * value. Dynamic tails need the guard because an ordinary read of the
 * short-circuited undefined would throw; never-nullish receivers fold at the token. */
export function isOptionalChainTail(lowerer: Lowerer, expr: ts.Expression): boolean {
  const tail = chainTailDot(lowerer, expr);
  if (!tail) return false;
  const recvT = lowerer.mapTypeOf(lowerer.typeOf(tail.expression));
  if (recvT?.kind === "jsval" || recvT?.kind === "dyn") return true;
  if (recvT?.kind !== "union") {
    // A keyed read the checker types as present (`rec[k]?.sub.x`, `arr[i]?.sub.x`) lowers
    // to an undefined-armed value under the guard: the tail must short-circuit whole.
    let recv: ts.Expression = tail.expression;
    while (ts.isParenthesizedExpression(recv) || ts.isNonNullExpression(recv)) recv = recv.expression;
    // A binding holding such a read (`const previous = boxes[i - 1]; previous?.min.y`): its runtime-optional value
    // has the undefined arm the checker's type lacks, and the tail must short-circuit whole too (the boundary
    // curtains' first box, whose predecessor is boxes[-1]).
    if (ts.isIdentifier(recv) && !lowerer.chainRecvByNode.has(recv)) {
      const optional = lowerer.runtimeOptionalSourceValue(recv, lowerer.lowerExpr(recv));
      if (optional?.type.kind !== "union") return false;
      return lowerer.unions.get(optional.type.unionId)?.arms.some(isUnitType) ?? false;
    }
    if (!ts.isElementAccessExpression(recv) || lowerer.chainRecvByNode.has(recv)) return false;
    const lowered = lowerer.lowerExpr(recv);
    if (lowered.type.kind !== "union") return false;
    const armed = lowerer.unions.get(lowered.type.unionId);
    return !!armed && armed.arms.some(isUnitType);
  }
  const def = lowerer.unions.get(recvT.unionId);
  return !!def && def.arms.some(isUnitType);
}

/** True when an EARLIER step of this access chain carries `?.` — JS
 * short-circuits the whole tail (`a?.b.c` reads nothing when a is
 * nullish), so a dyn tail read must answer undefined instead of
 * throwing. Walks the receiver spine only; the argument of the access
 * itself is not part of the guard. */
export function hasOptionalChainGuard(expr: ts.Expression): boolean {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (
      ts.isPropertyAccessExpression(cur) ||
      ts.isElementAccessExpression(cur) ||
      ts.isCallExpression(cur)
    ) {
      if (cur.questionDotToken) return true;
      cur = cur.expression;
      continue;
    }
    return false;
  }
}

/** A TAIL entry's intermediate steps (`x?.trim()` inside
 * `x?.trim().toLowerCase()`, `s?.items.map(f)`) checker-type with the
 * chain's `| undefined` even though inside the guard they are proven
 * non-nullish: narrow each (dotNode included) so the downstream
 * method/member dispatch rides the real receiver kind. Returns the nodes
 * this call registered, for the caller to clean up. */
function narrowTailSteps(lowerer: Lowerer, expr: ts.Expression, dotNode: ts.Node): ts.Expression[] {
  const tailSteps: ts.Expression[] = [];
  if (dotNode !== expr && !(ts.isCallExpression(expr) && expr.expression === dotNode)) {
    for (let cur: ts.Expression = expr; cur !== dotNode; ) {
      const next: ts.Expression = ts.isCallExpression(cur)
        ? cur.expression
        : (cur as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
      if (next === dotNode) break;
      if (!lowerer.chainNarrowedType.has(next)) {
        lowerer.chainNarrowedType.set(
          next,
          lowerer.checker.getNonNullableType(lowerer.checker.getTypeAtLocation(next)),
        );
        tailSteps.push(next);
      }
      cur = next;
    }
    if (!lowerer.chainNarrowedType.has(dotNode)) {
      lowerer.chainNarrowedType.set(
        dotNode,
        lowerer.checker.getNonNullableType(lowerer.checker.getTypeAtLocation(dotNode)),
      );
      tailSteps.push(dotNode as ts.Expression);
    }
  }
  return tailSteps;
}

/** A chain's guarded step. A keyed read of an index signature (`p.attributes?.JOINTS_0`) reads a missing key as
 * undefined, as JS does, where the checker types the read as present. */
function chainStep(lowerer: Lowerer, expr: ts.Expression): IrExpr {
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    const probed = lowerAbsenceProbe(lowerer, expr);
    if (probed) return probed;
  }
  return lowerer.lowerExpr(expr);
}

/** True when `callee` (the callee of an `f?.()` step) is `o.m` / `o?.m` naming a non-optional instance method
 * declared in a compiled class, and the receiver's non-nullish type is that class's instance type or a subclass's
 * (the lowered receiver is that class, which carries the method). TypeScript forbids a subclass redeclaring a method
 * as a property, so such a member is always a function: the call's own `?.` can never short-circuit. Optional
 * methods (`m?()`), static methods, interface members, function-typed fields and anything ambient stay out. */
function isAlwaysPresentClassMethod(lowerer: Lowerer, callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) return false;
  if (callee.expression.kind === ts.SyntaxKind.SuperKeyword) return false;
  const symbol = lowerer.checker.getSymbolAtLocation(callee.name);
  if (!symbol) return false;
  const decls = lowerer.checker.declarationsOf(symbol);
  if (decls.length === 0) return false;
  for (const decl of decls) {
    if (!ts.isMethodDeclaration(decl) || decl.questionToken) return false;
    if (!ts.isClassDeclaration(decl.parent) && !ts.isClassExpression(decl.parent)) return false;
    if (decl.getSourceFile().isDeclarationFile) return false;
    if (ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword || m.kind === ts.SyntaxKind.DeclareKeyword)) return false;
    if (ts.getModifiers(decl.parent)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return false;
  }
  const recvTs = lowerer.checker.getNonNullableType(lowerer.typeOf(callee.expression));
  const recvT = lowerer.mapTypeOf(recvTs);
  if (recvT?.kind !== "object") return false;
  const info = lowerer.classes.get(recvT.className);
  if (!info || info.def.runtime) return false;
  return lowerer.findMethodOn(info, callee.name.text) !== null;
}

export function lowerOptionalChain(lowerer: Lowerer, expr: ts.CallExpression | ts.PropertyAccessExpression | ts.ElementAccessExpression,): IrExpr {
  const loc = locOf(expr);
  // The node CARRYING the ?. token and the receiver expression it guards.
  let dotNode: ts.Node;
  let recvNode: ts.Expression;
  if (ts.isCallExpression(expr) && expr.questionDotToken && !lowerer.chainHandled.has(expr)) {
    // `o.m?.(x)` / `o?.m?.(x)` where `m` is a class method every instance has: the call's own token never
    // short-circuits, so it lowers as `o.m(x)` / `o?.m(x)` (direct or virtual dispatch) instead of reading
    // the method as a value and calling it indirectly.
    if (isAlwaysPresentClassMethod(lowerer, expr.expression)) {
      lowerer.chainHandled.add(expr);
      try {
        return lowerer.lowerExpr(expr);
      } finally {
        lowerer.chainHandled.delete(expr);
      }
    }
    dotNode = expr; // f?.()
    recvNode = expr.expression;
  } else if (
    ts.isCallExpression(expr) &&
    (ts.isPropertyAccessExpression(expr.expression) || ts.isElementAccessExpression(expr.expression)) &&
    expr.expression.questionDotToken && !lowerer.chainHandled.has(expr.expression)
  ) {
    dotNode = expr.expression; // a?.m()
    recvNode = expr.expression.expression;
  } else if (
    (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) &&
    expr.questionDotToken && !lowerer.chainHandled.has(expr)
  ) {
    dotNode = expr; // a?.b / a?.[i]
    recvNode = expr.expression;
  } else {
    // TAIL entry: the token sits deeper in the receiver spine and JS
    // short-circuits the WHOLE tail with it (`x?.trim().toLowerCase()`
    // reads nothing when x is nullish). The guarded member step becomes
    // the chain's dot; every step above it lowers inside the guard, its
    // checker type narrowed non-nullish below (the tag test proved it).
    const tail = chainTailDot(lowerer, expr);
    if (!tail) {
      // A `f?.()` step under a member tail, or no token at all (a
      // dispatch bug): short-circuiting those is not modeled.
      lowerer.unsupported(
        "SC1090",
        expr,
        "multi-step optional chains (split them: const v = a?.b; then use v?.c)",
      );
    }
    dotNode = tail;
    recvNode = tail.expression;
  }
  // A keyed read the chain guards (`plan.pieces[k]?.variation`): a missing key is the undefined the chain stops at, even
  // where the checker types the read as always present (an index signature without noUncheckedIndexedAccess).
  let keyed: ts.Expression = recvNode;
  while (ts.isParenthesizedExpression(keyed)) keyed = keyed.expression;
  const loweredReceiver = (ts.isElementAccessExpression(keyed) ? lowerAbsenceProbe(lowerer, keyed) : null) ?? lowerer.lowerExpr(recvNode);
  const receiver = lowerer.runtimeOptionalSourceValue(recvNode, loweredReceiver) ?? loweredReceiver;
  if (receiver.type.kind === "dyn") {
    if (dotNode === expr && ts.isCallExpression(expr)) {
      const id = lowerer.closureName(loc, "", "chain");
      const callee: IrExpr = { kind: "chainRecv", id, type: DYN, loc };
      const stmts: IrStmt[] = [];
      let guarded = receiver;
      let thisValue: IrExpr | undefined;
      // Member calls retain their receiver, evaluated before the guarded
      // property read and only once, including effectful computed keys.
      if (ts.isPropertyAccessExpression(recvNode) || ts.isElementAccessExpression(recvNode)) {
        const object = lowerer.lowerExpr(recvNode.expression);
        const local = lowerer.declareHiddenLocal("%optionalThis", object.type);
        const reference: IrExpr = { kind: "varRef", localId: local.id, type: object.type, loc };
        stmts.push({ kind: "varDecl", localId: local.id, init: object, loc });
        thisValue = lowerer.coerceInto(recvNode.expression, reference, DYN);
        const previous = lowerer.chainRecvByNode.get(recvNode.expression);
        lowerer.chainRecvByNode.set(recvNode.expression, reference);
        try { guarded = lowerer.lowerExpr(recvNode); }
        finally {
          if (previous) lowerer.chainRecvByNode.set(recvNode.expression, previous);
          else lowerer.chainRecvByNode.delete(recvNode.expression);
        }
      }
      const spreads: { arg: number; what: string }[] = [];
      const args = expr.arguments.map((arg, index) => {
        if (!ts.isSpreadElement(arg)) return lowerer.lowerExprExpecting(arg, DYN);
        spreads.push({ arg: index, what: arg.expression.getText() });
        return lowerer.lowerExprExpecting(arg.expression, DYN);
      });
      const body: IrExpr = { kind: "dynCall", callee, ...(thisValue ? { receiver: thisValue } : {}),
        calleeName: recvNode.getText(), args, ...(spreads.length ? { spreads } : {}), type: DYN, loc };
      const result: IrExpr = { kind: "optChain", id, receiver: guarded, body, type: DYN, loc };
      return stmts.length ? { kind: "seqExpr", stmts, result, type: DYN, loc } : result;
    }
    // `pkg?.name` / `pkg?.scripts?.[k]` on a JSON.parse result: dyn
    // represents undefined directly, so the chain step IS the keyed
    // read with the optional (unit-answers-undefined) policy — no
    // optChain wrapper needed; nested steps compose the same way.
    if (dotNode === expr && ts.isPropertyAccessExpression(expr)) {
      const key: IrExpr = { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) };
      return lowerer.maybeNarrow({ kind: "dynKeyGet", key, optional: true, value: receiver, type: DYN, loc }, expr);
    }
    if (dotNode === expr && ts.isElementAccessExpression(expr)) {
      const id = lowerer.closureName(loc, "", "chain");
      const reference: IrExpr = { kind: "chainRecv", id, type: DYN, loc };
      lowerer.chainRecvByNode.set(recvNode, reference);
      lowerer.chainHandled.add(dotNode);
      try {
        const body = lowerer.lowerExpr(expr);
        return { kind: "optChain", id, receiver, body: lowerer.coerceToExpected(body, DYN), type: DYN, loc };
      } finally {
        lowerer.chainRecvByNode.delete(recvNode);
        lowerer.chainHandled.delete(dotNode);
      }
    }
    // The METHOD-call step (`rawName?.match(re)` on a dyn value): a
    // nullish receiver short-circuits to the undefined dyn singleton
    // (dyn represents undefined directly); anything else runs the
    // VALIDATED dynamic dispatch — the same one the truthy-guarded
    // spelling (`v ? v.match(...) : null`) compiles to, Node-shaped
    // TypeError on a kind mismatch included. The dispatch's static
    // result converts back into the checked-dynamic tree (the chain's checker type is
    // the error-any world's `any`, so dyn IS its representation).
    if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(dotNode) &&
      dotNode === expr.expression
    ) {
      const m = dotNode.name.text;
      const id = lowerer.closureName(loc, "", "chain");
      const recvRef: IrExpr = { kind: "chainRecv", id, type: DYN, loc: locOf(recvNode) };
      lowerer.chainRecvByNode.set(recvNode, recvRef);
      lowerer.chainHandled.add(dotNode);
      let body: IrExpr;
      try {
        body = lowerer.lowerExpr(expr);
      } finally {
        lowerer.chainRecvByNode.delete(recvNode);
        lowerer.chainHandled.delete(dotNode);
      }
      if (body.type.kind !== "dyn") {
        // An island value (a DOM member's result read off a checked-dynamic page value) is the chain's dynamic value by conversion.
        if (body.type.kind === "jsval") body = lowerer.coerceToExpected(body, DYN);
        else if (body.type.kind !== "void" && !lowerer.dynConvertible(body.type)) {
          lowerer.unsupported(
            "SC1100",
            expr,
            `optional METHOD calls on 'unknown' values where the result ('${lowerer.fmt(body.type)}' ` +
              `from '.${m}(...)') has no dynamic representation`,
          );
        }
        if (body.type.kind === "void") {
          return { kind: "optChain", id, receiver, body, type: VOID, loc };
        }
        body = lowerer.dynFromValue(body, loc);
      }
      return { kind: "optChain", id, receiver, body, type: DYN, loc };
    }
    const id = lowerer.closureName(loc, "", "chain");
    const reference: IrExpr = { kind: "chainRecv", id, type: DYN, loc };
    lowerer.chainRecvByNode.set(recvNode, reference);
    lowerer.chainHandled.add(dotNode);
    // A tail (`dyn?.items.map(f)`): the steps under the guard are proven
    // non-nullish, so a typed member read lowers as the plain dyn
    // extraction instead of the chain's `T | undefined` spelling.
    const tailSteps = narrowTailSteps(lowerer, expr, dotNode);
    try {
      const body = lowerer.lowerExpr(expr);
      if (body.type.kind === "void") return { kind: "optChain", id, receiver, body, type: VOID, loc };
      return { kind: "optChain", id, receiver, body: lowerer.coerceToExpected(body, DYN), type: DYN, loc };
    } finally {
      lowerer.chainRecvByNode.delete(recvNode);
      lowerer.chainHandled.delete(dotNode);
      for (const n of tailSteps) lowerer.chainNarrowedType.delete(n);
    }
  }
  // An 'any' (island-handle) receiver: the nullish test asks the ENGINE
  // value at runtime — null/undefined short-circuit to the engine's
  // undefined (JS: null receivers yield undefined too), anything else
  // proceeds as the plain island operation with the receiver evaluated
  // once (argument side effects stay lazy, like every optChain). The
  // result is an island value again ('any' in, 'any' out).
  if (receiver.type.kind === "jsval") {
    const id = lowerer.closureName(loc, "", "chain");
    const recvRef: IrExpr = { kind: "chainRecv", id, type: JSVAL, loc: locOf(recvNode) };
    if (dotNode === expr && ts.isCallExpression(expr)) {
      // `a.b?.(...)` — a MEMBER callee: JS calls it with `this` bound to
      // `a` and short-circuits a nullish member — exactly the engine's
      // own `o.name?.()` (optCallMethod: the RECEIVER is `a`, evaluated
      // once through the chain; a nullish `a` itself short-circuits
      // earlier like any optional chain). Computed members keep a fence.
      if (ts.isPropertyAccessExpression(recvNode) || ts.isElementAccessExpression(recvNode)) {
        if (
          ts.isPropertyAccessExpression(recvNode) &&
          !recvNode.questionDotToken
        ) {
          const obj = lowerer.lowerExpr(recvNode.expression);
          if (obj.type.kind !== "jsval") lowerer.badType(recvNode.expression, lowerer.typeOf(recvNode.expression));
          const args = expr.arguments.map((a) => lowerer.jsvalIn(lowerer.lowerExpr(a), a));
          return { kind: "jsOp", op: "optCallMethod", name: recvNode.name.text, args: [obj, ...args], type: JSVAL, loc };
        }
        lowerer.unsupported(
          "SC1090",
          expr,
          "optional calls of computed 'any' member values (a[k]?.() — bind the member to a const first)",
        );
      }
      const args = expr.arguments.map((a) => lowerer.jsvalIn(lowerer.lowerExpr(a), a));
      const body: IrExpr = { kind: "jsOp", op: "callFn", args: [recvRef, ...args], type: JSVAL, loc };
      return { kind: "optChain", id, receiver, body, type: JSVAL, loc };
    }
    // Member forms (`x?.y`, `x?.y(...)`, `x?.[i]`): re-dispatch the plain
    // island lowering with the receiver node bound to the chain.
    lowerer.chainRecvByNode.set(recvNode, recvRef);
    lowerer.chainHandled.add(dotNode);
    // A tail (`page?.items.map(f)`): see the dyn tail's narrowing.
    const tailSteps = narrowTailSteps(lowerer, expr, dotNode);
    let body: IrExpr;
    try {
      body = lowerer.lowerExpr(expr);
    } finally {
      lowerer.chainRecvByNode.delete(recvNode);
      lowerer.chainHandled.delete(dotNode);
      for (const n of tailSteps) lowerer.chainNarrowedType.delete(n);
    }
    // A tail's typed result (`page?.items.length` is a number, `.map(f)` an
    // array) re-enters the page value the chain answers with (undefined on
    // the short-circuit path).
    if (body.type.kind !== "jsval" && body.type.kind !== "void") body = lowerer.coerceToExpected(body, JSVAL);
    if (body.type.kind !== "jsval") lowerer.badType(expr, lowerer.typeOf(expr));
    return { kind: "optChain", id, receiver, body, type: JSVAL, loc };
  }
  const def = receiver.type.kind === "union" ? lowerer.unions.get(receiver.type.unionId) : undefined;
  if (!def || !def.arms.some(isUnitType)) {
    // Never nullish: `?.` IS `.` — re-dispatch the plain lowering. The
    // receiver subtree above is discarded (lowering is pure IR
    // construction); the fresh dispatch lowers it again in place. The
    // checker may still SPELL the receiver nullable while the lowering
    // answers the plain value (`process.getuid?.()` is the POSIX
    // number), so narrow the node too — downstream receiver-typed
    // dispatch must agree with the lowered value, not the spelling.
    lowerer.chainHandled.add(dotNode);
    const hadNarrow = lowerer.chainNarrowedType.has(recvNode);
    if (!hadNarrow) {
      lowerer.chainNarrowedType.set(
        recvNode,
        lowerer.checker.getNonNullableType(lowerer.checker.getTypeAtLocation(recvNode)),
      );
    }
    // A tail's steps above the token (`e.stack?.split(",")` in `e.stack?.split(",").join("|")`, where the
    // lowering answers `stack` as a plain string) are not nullish either.
    const tailSteps = narrowTailSteps(lowerer, expr, dotNode);
    try {
      return chainStep(lowerer, expr);
    } finally {
      lowerer.chainHandled.delete(dotNode);
      if (!hadNarrow) lowerer.chainNarrowedType.delete(recvNode);
      for (const n of tailSteps) lowerer.chainNarrowedType.delete(n);
    }
  }
  const rest = def.arms.filter((a) => !isUnitType(a));
  if (rest.length === 0) {
    const result = dynUndefinedExpr(loc);
    return { kind: "seqExpr", stmts: [{ kind: "exprStmt", expr: receiver, loc }], result, type: DYN, loc };
  }
  const narrowed = rest.length === 1
    ? rest[0]!
    : { kind: "union" as const, unionId: lowerer.unions.transform(def, rest) };
  const id = lowerer.closureName(loc, "", "chain");
  // A single present arm binds its payload. Multiple present arms bind
  // the original tagged value, then retag inside the guarded body. The
  // nullish arms never enter that body, and each record keeps its identity.
  let recvRef: IrExpr = {
    kind: "chainRecv", id,
    type: rest.length === 1 ? narrowed : receiver.type,
    loc: locOf(recvNode),
  };
  if (narrowed.kind === "union" && receiver.type.kind === "union") {
    recvRef = lowerer.coerceInto(recvNode, recvRef, narrowed);
  }

  // `f?.()`: the callee IS the guarded value — build the indirect call
  // directly (no member dispatch exists to re-enter).
  if (dotNode === expr && ts.isCallExpression(expr)) {
    if (narrowed.kind !== "func") lowerer.badType(recvNode, lowerer.typeOf(recvNode));
    const params = narrowed.params;
    const args = expr.arguments.map((a, i) => lowerer.lowerExprExpecting(a, params[i]));
    const body: IrExpr = { kind: "callValue", callee: recvRef, args, type: narrowed.ret, loc };
    return lowerer.finishOptionalChain(expr, id, receiver, body, loc);
  }

  // Member forms: re-dispatch the normal lowering with the receiver node
  // bound to the chain (reads as chainRecv, types as non-nullish).
  const narrowedTs = lowerer.checker.getNonNullableType(lowerer.checker.getTypeAtLocation(recvNode));
  lowerer.chainRecvByNode.set(recvNode, recvRef);
  lowerer.chainNarrowedType.set(recvNode, narrowedTs);
  lowerer.chainHandled.add(dotNode);
  // A TAIL entry's intermediate steps (`x?.trim()` inside
  // `x?.trim().toLowerCase()`) checker-type with the chain's `|
  // undefined` even though inside the guard they are proven non-nullish
  // — narrow each so the downstream method/member dispatch rides the
  // real receiver kind. Only nodes this chain registers are cleaned up.
  const tailSteps = narrowTailSteps(lowerer, expr, dotNode);
  let body: IrExpr;
  try {
    body = chainStep(lowerer, expr);
  } finally {
    lowerer.chainRecvByNode.delete(recvNode);
    lowerer.chainNarrowedType.delete(recvNode);
    lowerer.chainHandled.delete(dotNode);
    for (const n of tailSteps) lowerer.chainNarrowedType.delete(n);
  }
  return lowerer.finishOptionalChain(expr, id, receiver, body, loc);
}

/** Whether a value of this lowered type can be null or undefined at run time. */
function receiverCanBeNullish(lowerer: Lowerer, type: IrType): boolean {
  if (type.kind === "dyn" || type.kind === "jsval" || type.kind === "undefinedT" || type.kind === "nullT") return true;
  if (type.kind !== "union") return false;
  return lowerer.armTag(type.unionId, UNDEFINED_T) >= 0 || lowerer.armTag(type.unionId, NULL_T) >= 0;
}

/** The optChain node around a lowered chain body: void bodies keep the
 * statement form (`cb?.();` — the checker's `void | undefined` result IS
 * void here); value bodies wrap into the checker's undefined-armed
 * result union. */
export function finishOptionalChain(lowerer: Lowerer, expr: ts.Expression,
  id: string,
  receiver: IrExpr,
  body: IrExpr,
  loc: SrcLoc,): IrExpr {
  if (body.type.kind === "void") {
    return { kind: "optChain", id, receiver, body, type: VOID, loc };
  }
  // A dyn body (`pricing?.[key]` — an unknown-valued index-signature
  // read) stays dyn: `unknown | undefined` IS unknown, and dyn represents
  // undefined directly (the unit path yields the undefined dyn value).
  if (body.type.kind === "dyn") {
    return { kind: "optChain", id, receiver, body, type: DYN, loc };
  }
  let type = lowerer.irTypeOf(expr);
  // A statement-position chain ending in a page call (`state?._buffer.destroy()`
  // on a GPUBuffer): the checker says void while the body is the page's
  // result value, which nothing reads. It rides the dyn chain form (the unit
  // path is the undefined dyn value) and the statement discards it.
  if (type.kind === "void" && body.type.kind === "jsval") {
    const dynBody = lowerer.coerceToExpected(body, DYN);
    if (dynBody.type.kind === "dyn") return { kind: "optChain", id, receiver, body: dynBody, type: DYN, loc };
  }
  // The checker's result is `any` (a link of the chain is any-typed: dyn, or
  // a page value on the dynamic browser target) while this body is typed:
  // the chain is built as dyn, which holds the short-circuit's undefined
  // directly (the dyn-body rule above), then converted like any dyn value.
  if (type.kind === "dyn" || type.kind === "jsval") {
    const chain: IrExpr = { kind: "optChain", id, receiver, body: lowerer.coerceToExpected(body, DYN), type: DYN, loc };
    return type.kind === "dyn" ? chain : lowerer.coerceToExpected(chain, type);
  }
  const hiddenOptionalResult =
    (type.kind !== "union" || lowerer.armTag(type.unionId, UNDEFINED_T) < 0) &&
    receiver.type.kind === "union" &&
    (lowerer.armTag(receiver.type.unionId, UNDEFINED_T) >= 0 || lowerer.armTag(receiver.type.unionId, NULL_T) >= 0) &&
    body.type.kind !== "generator" && body.type.kind !== "jsval"
      ? lowerer.withUndefinedArmOf(body.type)
      : null;
  if (hiddenOptionalResult) type = hiddenOptionalResult;
  if ((type.kind !== "union" || lowerer.armTag(type.unionId, UNDEFINED_T) < 0) && !receiverCanBeNullish(lowerer, receiver.type)) {
    // A defensive `?.` on a receiver whose type cannot hold null or
    // undefined (`zone?.longName` where zone is a non-null record) never
    // short-circuits: it is the plain member access. The receiver is still
    // evaluated exactly once, bound for the body's chainRecv references.
    const local = lowerer.declareHiddenLocal("%chain", receiver.type);
    const ref: IrExpr = { kind: "varRef", localId: local.id, type: receiver.type, loc };
    const inlined = transformExpr(body, {
      expr: (e) => (e.kind === "chainRecv" && e.id === id ? ref : e),
      stmt: (s) => s,
    });
    const value = lowerer.coerceToExpected(inlined, type);
    return { kind: "seqExpr", stmts: [{ kind: "varDecl", localId: local.id, init: receiver, loc }], result: value, type: value.type, loc };
  }
  if (type.kind !== "union" || lowerer.armTag(type.unionId, UNDEFINED_T) < 0) {
    lowerer.unsupported(
      "SC1090",
      expr,
      `'?.' where the result '${lowerer.fmt(type)}' has no undefined arm (narrow the receiver with 'if (x !== undefined)' instead)`,
    );
  }
  const wrapped = lowerer.coerceToExpected(body, type);
  if (!typeEquals(wrapped.type, type)) lowerer.badType(expr, lowerer.typeOf(expr));
  return { kind: "optChain", id, receiver, body: wrapped, type, loc };
}
