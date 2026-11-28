/* Await (and, for generators, yield) hoisting for the WasmGC resumable-frame lowering (after js2wasm's
 * async-await-hoist design): rewrite an async function's IR so every await
 * sits at statement level — `x = await p`, `await p;`, `return await p` — the
 * only shape the frame segmenter suspends at.
 *
 * Order-preserving lift: in an expression containing an await, every operand
 * evaluated before it (left to right) is captured into a fresh local first,
 * then the await becomes its own statement and the expression reads its
 * result local. Short-circuit forms (&&, ||, ?:, ??) with an await in a lazy
 * operand become an `if`, so the await runs only when JS would evaluate it.
 * New locals are appended to the function, so they get frame slots.
 *
 * Generators use the same pass with `yield` as the suspension point: a
 * `yield*` delegation lowers to a statement sequence ending in a result
 * (seqExpr), which is spliced in place; the completion record of a finally
 * across yields is anyref-typed (a boxed return value rides it).
 *
 * Unsupported shapes throw through `refuse` (never a silent reorder). */
import { type IrExpr, type IrFunction, type IrStmt, type IrType, type SrcLoc, typeKey } from "../../ir/ir.js";

type Refuse = (construct: string, loc?: SrcLoc) => never;
// An absent node (a `for (;;)` header's missing condition) has no await.
const hasAwaitNode = (node: unknown): boolean => node != null && JSON.stringify(node).includes('"kind":"await');
const hasYieldNode = (node: unknown): boolean => node != null && JSON.stringify(node).includes('"kind":"yieldExpr"');
/** Operands safe to re-read after an await (constants never change). */
const isConstant = (e: IrExpr) => e.kind === "numLit" || e.kind === "strLit" || e.kind === "boolLit" || e.kind === "unitLit";
const SHORT_CIRCUIT = new Set(["logical", "ternary", "nullish", "optChain"]);

export function hoistAwaits(f: IrFunction, refuse: Refuse, suspension: "await" | "yield" = "await", unionArms?: (unionId: string) => IrType[]): void {
  const generator = suspension === "yield";
  const hasAwait = generator ? hasYieldNode : hasAwaitNode;
  const isAwait = (e: IrExpr) => generator ? e.kind === "yieldExpr" : e.kind === "awaitExpr" || e.kind === "awaitUnionExpr";
  type SuspendExpr = IrExpr & { kind: "awaitExpr" | "yieldExpr" };
  const operand = (e: IrExpr): IrExpr => (e as SuspendExpr).value ?? ({ kind: "unitLit", unit: "undefined", type: { kind: "undefinedT" }, loc: e.loc } as IrExpr);
  let seq = 0;
  const fresh = (type: IrType, loc: SrcLoc): IrExpr & { kind: "varRef" } => {
    const id = `%await.${seq++}`;
    f.locals.push({ id, name: id, type, mutable: true });
    return { kind: "varRef", localId: id, type, loc };
  };

  /** Lift awaits out of `e`: returns prelude statements and the residual expression. */
  const lift = (e: IrExpr): [IrStmt[], IrExpr] => {
    if (!hasAwait(e)) return [[], e];
    if (isAwait(e)) {
      const value = operand(e);
      const [pre, v] = lift(value);
      // awaitUnionExpr's void form is a statement too.
      if (e.type.kind === "void") return [[...pre, { kind: "exprStmt", expr: { ...e, value: v } as IrExpr, loc: e.loc }], { kind: "unitLit", unit: "undefined", type: { kind: "undefinedT" }, loc: e.loc } as IrExpr];
      const t = fresh(e.type, e.loc);
      return [[...pre, { kind: "varDecl", localId: t.localId, init: { ...e, value: v } as IrExpr, loc: e.loc }], t];
    }
    if (SHORT_CIRCUIT.has(e.kind)) return liftShortCircuit(e);
    // `l || d`: the default runs only when l is falsy, so a suspension in it
    // cannot be lifted ahead of the test (one in l lifts like any operand).
    if (e.kind === "orDefault" && hasAwait(e.right)) return refuse(`${suspension} in the default of \`||\``, e.loc);
    // A statement sequence ending in a result (a yield* delegation; a lowering's temps around a call):
    // its statements run in place, then its result is read. Operands before it were captured above.
    if (e.kind === "seqExpr") { const [p, r] = lift(e.result); return [[...block(e.stmts), ...p], r]; }
    if (e.kind === "closure") return refuse(`${suspension} inside ${e.kind}`, e.loc);
    // Generic node: operands in field order (the frontend builds nodes in
    // evaluation order); capture each operand that precedes a later await.
    const node = { ...(e as unknown as Record<string, unknown>) };
    // (An array entry may itself wrap expressions: a record literal's `{ name, value }` fields.)
    const slots: { key: string; index?: number; sub?: string; expr: IrExpr }[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "type" || key === "loc") continue;
      if (Array.isArray(value)) value.forEach((v, index) => {
        if (isExpr(v)) slots.push({ key, index, expr: v });
        else if (v && typeof v === "object") for (const [sub, inner] of Object.entries(v as Record<string, unknown>)) if (isExpr(inner)) slots.push({ key, index, sub, expr: inner });
      });
      else if (isExpr(value)) slots.push({ key, expr: value });
    }
    const pre: IrStmt[] = [];
    const lastAwait = slots.reduce((last, s, i) => hasAwait(s.expr) ? i : last, -1);
    slots.forEach((slot, i) => {
      let [p, v] = lift(slot.expr);
      pre.push(...p);
      if (i < lastAwait && !isConstant(v) && v.type.kind !== "void") {
        const t = fresh(v.type, v.loc);
        pre.push({ kind: "varDecl", localId: t.localId, init: v, loc: v.loc });
        v = t;
      }
      if (slot.index === undefined) node[slot.key] = v;
      else {
        const arr = [...(node[slot.key] as unknown[])];
        arr[slot.index] = slot.sub === undefined ? v : { ...(arr[slot.index] as Record<string, unknown>), [slot.sub]: v };
        node[slot.key] = arr;
      }
    });
    return [pre, node as unknown as IrExpr];
  };

  const liftShortCircuit = (e: IrExpr): [IrStmt[], IrExpr] => {
    // Suspensions only in the part that always runs first (l of `l ?? r`, the receiver of `a?.b`)
    // lift ahead like any operand, and the node stays.
    if (e.kind === "nullish" && !hasAwait(e.right)) { const [pl, left] = lift(e.left); return [pl, { ...e, left }]; }
    if (e.kind === "optChain" && !hasAwait(e.body)) { const [pr, receiver] = lift(e.receiver); return [pr, { ...e, receiver }]; }
    const t = fresh(e.type, e.loc);
    const assign = (value: IrExpr): IrStmt[] => { const [p, v] = lift(value); return [...p, { kind: "assign", localId: t.localId, value: v, loc: e.loc }]; };
    if (e.kind === "ternary") {
      const [pc, c] = lift(e.cond);
      return [[...pc, { kind: "if", cond: c, then: assign(e.then), else_: assign(e.else_), loc: e.loc }], t];
    }
    if (e.kind === "logical") {
      // `l && r` / `l || r`: l is the result unless its truthiness says r runs (then r is). A value-returning form
      // (operands and result share one type, IR logical) decides on l's ToBoolean.
      const [pl, l] = lift(e.left);
      const first: IrStmt = { kind: "assign", localId: t.localId, value: l, loc: e.loc };
      const bool = { kind: "bool" } as IrType;
      const truthy: IrExpr = e.type.kind === "bool" ? t : { kind: "toBool", operand: t, type: bool, loc: e.loc } as IrExpr;
      const cond: IrExpr = e.op === "&&" ? truthy : { kind: "unary", op: "!", operand: truthy, type: bool, loc: e.loc } as IrExpr;
      return [[...pl, first, { kind: "if", cond, then: assign(e.right), else_: null, loc: e.loc }], t];
    }
    // `l ?? r` over an untyped l (the emitter's dyn nullish): r runs only when l is null or undefined, and the result is
    // l itself or r as a dynamic value.
    if (e.kind === "nullish" && e.left.type.kind === "dyn" && e.type.kind === "dyn") {
      const l = fresh(e.left.type, e.loc), bool = { kind: "bool" } as IrType;
      const [pl, left] = lift(e.left);
      const [pr, right] = lift(e.right);
      const asDyn: IrExpr = right.type.kind === "dyn" ? right : { kind: "dynFrom", value: right, type: e.type, loc: e.loc } as IrExpr;
      return [[...pl, { kind: "varDecl", localId: l.localId, init: left, loc: e.loc },
        { kind: "if", cond: { kind: "dynTest", test: "nullish", value: l, type: bool, loc: e.loc } as IrExpr,
          then: [...pr, { kind: "assign", localId: t.localId, value: asDyn, loc: e.loc }],
          else_: [{ kind: "assign", localId: t.localId, value: l, loc: e.loc }], loc: e.loc }], t];
    }
    // `l ?? r` with a suspension in r: r runs only when l is null or undefined, exactly as the
    // emitter's nullish (its two result shapes: l itself, or l narrowed to its one non-unit arm).
    // (A suspension in l itself lifts ahead like any operand: l always runs first.)
    if (e.kind === "nullish" && e.left.type.kind === "union" && unionArms) {
      const unionId = e.left.type.unionId, arms = unionArms(unionId);
      const unitTags = arms.flatMap((a, i) => a.kind === "nullT" || a.kind === "undefinedT" || a.kind === "void" ? [i] : []);
      const passThrough = typeKey(e.type) === typeKey(e.left.type);
      const presentTag = passThrough ? -1 : arms.findIndex(a => typeKey(a) === typeKey(e.type));
      if (unitTags.length > 0 && (passThrough || presentTag >= 0)) {
        const l = fresh(e.left.type, e.loc), bool = { kind: "bool" } as IrType;
        const cond = unitTags.map((tag): IrExpr => ({ kind: "unionIsTag", unionId, tag, negated: false, value: l, type: bool, loc: e.loc } as IrExpr))
          .reduce((a, b) => ({ kind: "logical", op: "||", left: a, right: b, type: bool, loc: e.loc } as IrExpr));
        const present: IrExpr = passThrough ? l : { kind: "unionNarrow", unionId, tag: presentTag, value: l, type: e.type, loc: e.loc } as IrExpr;
        const [pl, left] = lift(e.left);
        return [[...pl, { kind: "varDecl", localId: l.localId, init: left, loc: e.loc },
          { kind: "if", cond, then: assign(e.right), else_: [{ kind: "assign", localId: t.localId, value: present, loc: e.loc }], loc: e.loc }], t];
      }
    }
    return refuse(`${suspension} inside ${e.kind}`, e.loc);
  };

  const isExpr = (v: unknown): v is IrExpr => !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string" && "type" in (v as object) && "loc" in (v as object);

  /** Rewrite one statement list; statements keep their own nested bodies. */
  const block = (list: IrStmt[]): IrStmt[] => list.flatMap(stmt);
  const stmt = (s: IrStmt): IrStmt[] => {
    if (!hasAwait(s)) return [s];
    switch (s.kind) {
      case "varDecl": if (!s.init || isAwait(s.init) && !hasAwait(operand(s.init))) return [s]; { const [p, v] = liftTop(s.init); return [...p, { ...s, init: v }]; }
      case "assign": if (isAwait(s.value) && !hasAwait(operand(s.value))) return [s]; { const [p, v] = liftTop(s.value); return [...p, { ...s, value: v }]; }
      case "return": if (!s.value || isAwait(s.value) && !hasAwait(operand(s.value))) return [s]; { const [p, v] = liftTop(s.value); return [...p, { ...s, value: v }]; }
      case "exprStmt": {
        if (isAwait(s.expr) && !hasAwait(operand(s.expr))) return [s];
        const [p, v] = liftTop(s.expr);
        return v.kind === "unitLit" || v.kind === "varRef" ? p : [...p, { ...s, expr: v }];
      }
      case "throw": { const [p, v] = lift(s.value); return [...p, { ...s, value: v }]; }
      case "if": { const [p, c] = lift(s.cond); return [...p, { ...s, cond: c, then: block(s.then), else_: s.else_ ? block(s.else_) : null }]; }
      case "block": return [{ ...s, body: block(s.body) }];
      case "tryCatch": {
        const out = { ...s, tryBody: block(s.tryBody), catchBody: s.catchBody ? block(s.catchBody) : null, finallyBody: s.finallyBody ? block(s.finallyBody) : null };
        // A finally across awaits keeps its completion record in the frame.
        // (A generator's saved return value is a boxed anyref: the `caught` slot type.)
        if (s.finallyBody) (out as { asyncSlots?: unknown }).asyncSlots = { kind: fresh({ kind: "bool" } as IrType, s.loc).localId, val: fresh({ kind: "caught" } as IrType, s.loc).localId };
        return [out];
      }
      case "while": case "doWhile": case "for": case "forOf": case "switch":
        if (hasAwait((s as { cond?: unknown; disc?: unknown; iterable?: unknown }).cond ?? (s as { disc?: unknown }).disc ?? (s as { iterable?: unknown }).iterable)) return refuse(`${suspension} in a ${s.kind} header`, s.loc);
        if (s.kind === "forOf") {
          // The iteration state must survive suspension: give it frame slots.
          const arr = fresh(s.iterable.type, s.loc).localId, idx = fresh({ kind: "f64" } as IrType, s.loc).localId;
          return [{ ...s, body: block(s.body), asyncSlots: { arr, idx } } as IrStmt];
        }
        // A switch across yields keeps its selected entry case in a frame slot.
        return [s.kind === "switch" ? { ...s, cases: s.cases.map(c => ({ ...c, body: block(c.body) })), asyncSlots: { entry: fresh({ kind: "f64" } as IrType, s.loc).localId } } as IrStmt
          : { ...s, body: block(s.body) } as IrStmt];
      default: {
        // fieldSet/recordSet/arraySet and friends: lift their operands generically.
        const node = { ...(s as unknown as Record<string, unknown>) }, pre: IrStmt[] = [];
        const keys = Object.keys(node).filter(k => k !== "loc" && isExpr(node[k]));
        const lastAwait = keys.reduce((last, k, i) => hasAwait(node[k]) ? i : last, -1);
        keys.forEach((k, i) => {
          let [p, v] = lift(node[k] as IrExpr);
          pre.push(...p);
          if (i < lastAwait && !isConstant(v)) { const t = fresh(v.type, v.loc); pre.push({ kind: "varDecl", localId: t.localId, init: v, loc: v.loc }); v = t; }
          node[k] = v;
        });
        return [...pre, node as unknown as IrStmt];
      }
    }
  };
  /** Like lift, but a top-level await may stay in place (the segmenter takes it). */
  const liftTop = (e: IrExpr): [IrStmt[], IrExpr] => {
    if (isAwait(e)) { const [p, v] = lift(operand(e)); return [p, { ...e, value: v } as IrExpr]; }
    return lift(e);
  };

  f.body = block(f.body);
}
