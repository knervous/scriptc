/* Unboxed optional numbers: a local whose union is exactly { number, undefined } held as an f64.
 *
 * The f64 slot already has a form for undefined (UNDEF_NAN, the reserved NaN pattern: typeof, ToString, strict
 * equality and every union conversion honor it), and the union conversions are exact both ways: unionNarrow to the
 * number arm maps undefined to UNDEF_NAN, and unionWrap of a number maps UNDEF_NAN back to undefined. So a
 * `number | undefined` local (`const hit = map.get(k)`, `let best = rec.score`, a probed `values[i]`) can live in
 * an f64 with no change a program can observe:
 *
 *   a write   L = e      becomes  L = unionNarrow(number, e)     (no box survives the write)
 *   a read    L          becomes  unionWrap(number, L)           (a box only where the union escapes)
 *
 * and the peepholes then remove the wrap where its consumer only asks a question of it:
 *
 *   unionNarrow(number, unionWrap(number, x))   ->  x
 *   unionIsTag(undefined | number, wrap(x))      ->  num.isUndefined(x) (or its negation)
 *   unionEq(wrap(x), wrap(y)) (not SameValue)    ->  x === y as f64 (two undefineds are equal; NaN is not)
 *   nullish(wrap(L), d) of number type           ->  isUndefined(L) ? d : L
 *   unionNarrow(number, ternary(c, a, b))         ->  ternary(c, narrow a, narrow b)
 *
 * Only plain locals qualify: not parameters (their ABI), not boxed or captured (a closure's view of the slot), not a
 * scope-group member, and named nowhere but by varRef / assign / varDecl. A write whose value is not of the local's
 * own union keeps the local as it was. Before: every write that held a number allocated a box, and every use read
 * it back through a null test and a struct field. */
import type { IrExpr, IrFunction, IrType } from "../../ir/ir.js";

const F64: IrType = { kind: "f64" };
const BOOL: IrType = { kind: "bool" };

/** A read that can answer its f64 form itself (see `produce` below): a Map get, or a typed array's or number[]'s probed read. */
const producible = (e: { kind?: string; callee?: string }): boolean =>
  e.kind === "mapIntrinsic" || e.kind === "optChain" || (e.kind === "arrIntrinsic" && (e as { method?: string }).method === "pop") || (e.kind === "call" && /^%(arr|bytes)\.idxOr\./.test(e.callee ?? ""));

/** Whether `f` has anything for unboxOptionalNumbers: a `number | undefined` local, or a narrowing or a `??` of a
 * producer that can answer an f64 itself. A cheap scan, so a function with none is never cloned. */
export function hasOptionalNumbers(f: IrFunction, optional: (t: IrType) => boolean): boolean {
  if (f.locals.some(l => !l.boxed && optional(l.type))) return true;
  let found = false;
  const scan = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) scan(x); return; }
    const o = n as Record<string, unknown> & { kind?: string; value?: { kind?: string; callee?: string } };
    if (o.kind === "unionNarrow" && o.value && producible(o.value)) { found = true; return; }
    if (o.kind === "call" && typeof o.callee === "string" && o.callee.startsWith("%union.narrow.") && Array.isArray(o.args) && o.args.length === 1 && producible(o.args[0] as { kind?: string })) { found = true; return; }
    if (o.kind === "nullish" && (o as { left?: { kind?: string; callee?: string } }).left && producible((o as { left: { kind?: string; callee?: string } }).left)) { found = true; return; }
    for (const k in o) if (k !== "loc" && k !== "type") scan(o[k]);
  };
  scan(f.body);
  return found;
}

export interface OptionalNumberHooks {
  /** The arms of a union, or undefined when unknown. */
  arms(unionId: string): readonly IrType[] | undefined;
  /** A local the emitter keeps elsewhere (a scope-group member). */
  excluded(id: string): boolean;
}

interface Candidate { unionId: string; numTag: number; undefTag: number }

/** Rewrites `f` in place; answers the ids it retyped to f64. */
export function unboxOptionalNumbers(f: IrFunction, hooks: OptionalNumberHooks): Set<string> {
  const params = new Set(f.params.map(p => p.localId));
  const cands = new Map<string, Candidate>();
  for (const l of f.locals) {
    if (l.boxed || (l as { tdz?: unknown }).tdz || params.has(l.id) || l.type.kind !== "union" || hooks.excluded(l.id)) continue;
    const arms = hooks.arms(l.type.unionId);
    if (!arms || arms.length !== 2) continue;
    const numTag = arms.findIndex(a => a.kind === "f64"), undefTag = arms.findIndex(a => a.kind === "undefinedT");
    if (numTag < 0 || undefTag < 0) continue;
    cands.set(l.id, { unionId: l.type.unionId, numTag, undefTag });
  }
  for (const c of f.captures ?? []) cands.delete(c.localId);
  // Disqualify: a mention of the id anywhere but varRef/assign/varDecl's localId, or a write of another type.
  const visit = (n: unknown, key: string | null, parent: Record<string, unknown> | null): void => {
    if (typeof n === "string") {
      if (cands.has(n) && !(key === "localId" && parent && (parent.kind === "varRef" || parent.kind === "assign" || parent.kind === "varDecl"))) cands.delete(n);
      return;
    }
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x, key === "captures" ? "captures" : null, parent); return; }
    const o = n as Record<string, unknown>;
    if ((o.kind === "assign" || o.kind === "varDecl") && typeof o.localId === "string" && cands.has(o.localId)) {
      const v = (o.kind === "assign" ? o.value : o.init) as IrExpr | null | undefined;
      const c = cands.get(o.localId)!;
      if (v && !(v.type.kind === "union" && v.type.unionId === c.unionId)) cands.delete(o.localId);
      if (o.kind === "assign" && (o as { op?: unknown }).op !== undefined) cands.delete(o.localId);
    }
    for (const k in o) if (k !== "loc" && k !== "type") visit(o[k], k, o);
  };
  if (cands.size) visit(f.body, null, null);

  const wrapOf = (e: IrExpr): { x: IrExpr; c: Candidate } | null => {
    if (e.kind !== "unionWrap") return null;
    for (const c of cands.values()) if (c.unionId === e.unionId && c.numTag === e.tag && e.value.type.kind === "f64") return { x: e.value, c };
    return null;
  };
  const isPure = (e: IrExpr) => e.kind === "varRef" || e.kind === "numLit";
  const narrow = (e: IrExpr, c: Candidate, loc: IrExpr["loc"]): IrExpr => {
    const w = wrapOf(e);
    if (w && w.c.unionId === c.unionId) return w.x;
    if (e.kind === "ternary") return { ...e, then: narrow(e.then, c, loc), else_: narrow(e.else_, c, loc), type: F64 };
    // A read that first holds its operand (`opts[i]!.v` over a union of record shapes: the element in a temporary,
    // then a ternary on its shape) narrows its result.
    if (e.kind === "seqExpr" && !e.generatorDelegate) return { ...e, result: narrow(e.result, c, loc), type: F64 };
    return produce(e, c, loc) ?? { kind: "unionNarrow", unionId: c.unionId, tag: c.numTag, value: e, type: F64, loc };
  };
  /** JS's undefined as the f64 form (UNDEF_NAN): the narrowing of the union's undefined, which the emitter folds. */
  const undefNumber = (c: Candidate, loc: IrExpr["loc"]): IrExpr => ({
    kind: "unionNarrow", unionId: c.unionId, tag: c.numTag, type: F64, loc,
    value: { kind: "unionWrap", unionId: c.unionId, tag: c.undefTag, value: { kind: "unitLit", unit: "undefined", type: { kind: "undefinedT" }, loc }, type: { kind: "union", unionId: c.unionId }, loc },
  } as IrExpr);
  // Producers that can answer the f64 form directly, so no box is made only to be narrowed: a typed array's safe read
  // (its plain read already answers UNDEF_NAN past the end), a number[] element (present: the slot; a hole or past
  // the end: UNDEF_NAN), and a Map<_, number> get (the emitter's f64-typed get answers UNDEF_NAN for a miss).
  let temps = 0;
  const pure = (e: IrExpr) => e.kind === "varRef" || e.kind === "numLit";
  const produce = (e: IrExpr, c: Candidate, loc: IrExpr["loc"]): IrExpr | null => {
    if (e.kind === "mapIntrinsic" && e.method === "get" && e.receiver.type.kind === "map" && e.receiver.type.value.kind === "f64") return { ...e, type: F64 };
    // `nums.pop()`: the popped number, UNDEF_NAN for an empty array or a hole or present undefined at the end.
    if (e.kind === "arrIntrinsic" && e.method === "pop" && e.receiver.type.kind === "array" && e.receiver.type.elem.kind === "f64") return { ...e, type: F64 };
    // `rec?.n` (an optional chain whose body is a number): the chain in its f64 form, UNDEF_NAN when the receiver is
    // null or undefined (the emitter's empty f64 chain), else the body's number (a number arm's wrap opened in place;
    // UNDEF_NAN from a page record's missing field is undefined either way).
    if (e.kind === "optChain" && e.type.kind === "union" && e.type.unionId === c.unionId) {
      const b = e.body;
      const body = b.kind === "unionWrap" && b.unionId === c.unionId && b.tag === c.numTag && b.value.type.kind === "f64" ? b.value
        : produce(b, c, loc) ?? { kind: "unionNarrow", unionId: c.unionId, tag: c.numTag, value: b, type: F64, loc } as IrExpr;
      return { ...e, body, type: F64 };
    }
    if (e.kind !== "call" || e.args.length !== 2) return null;
    const [recv, index] = e.args;
    if (index?.type.kind !== "f64") return null;
    if (e.callee.startsWith("%bytes.idxOr.") && recv?.type.kind === "bytes") return { kind: "bytesIntrinsic", method: "get", receiver: recv, args: [index], type: F64, loc } as IrExpr;
    if (!e.callee.startsWith("%arr.idxOr.") || recv?.type.kind !== "array" || recv.type.elem.kind !== "f64") return null;
    const stmts: unknown[] = [];
    const hold = (x: IrExpr): IrExpr => {
      if (pure(x)) return x;
      const id = `%optn.${temps++}`;
      f.locals.push({ id, name: id, type: x.type, mutable: false });
      stmts.push({ kind: "varDecl", localId: id, init: x, loc });
      return { kind: "varRef", localId: id, type: x.type, loc } as IrExpr;
    };
    const arr = hold(recv), at = hold(index);
    const read: IrExpr = {
      kind: "ternary", type: F64, loc,
      cond: { kind: "bin", op: "===", left: { kind: "arrayState", arr, index: at, type: F64, loc }, right: { kind: "numLit", value: 1, type: F64, loc }, type: BOOL, loc } as IrExpr,
      then: { kind: "arrayGet", arr, index: at, type: F64, loc } as IrExpr,
      else_: undefNumber(c, loc),
    } as IrExpr;
    return stmts.length ? { kind: "seqExpr", stmts, result: read, type: F64, loc } as IrExpr : read;
  };
  // Bottom-up rewrite.
  const rw = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map(rw);
    const o = n as Record<string, unknown>;
    for (const k in o) if (k !== "loc" && k !== "type") { const v = o[k]; if (v && typeof v === "object") o[k] = rw(v); }
    // Writes (statements): the value narrowed into the f64 slot.
    if ((o.kind === "assign" || o.kind === "varDecl") && typeof o.localId === "string" && cands.has(o.localId)) {
      const c = cands.get(o.localId)!, loc = o.loc as IrExpr["loc"];
      const v = (o.kind === "assign" ? o.value : o.init) as IrExpr | null | undefined;
      const nv = v ? narrow(v, c, loc) : undefNumber(c, loc);
      return o.kind === "assign" ? { ...o, value: nv } : { ...o, init: nv };
    }
    const e = o as unknown as IrExpr;
    switch (e.kind) {
      case "varRef": {
        const c = cands.get(e.localId);
        if (!c) return e;
        return { kind: "unionWrap", unionId: c.unionId, tag: c.numTag, value: { kind: "varRef", localId: e.localId, type: F64, loc: e.loc }, type: e.type, loc: e.loc } as IrExpr;
      }
      case "unionNarrow": {
        const w = wrapOf(e.value);
        if (w && w.c.unionId === e.unionId && e.tag === w.c.numTag) return w.x;
        if (e.type.kind === "f64") {
          const arms = hooks.arms(e.unionId);
          if (arms?.length === 2 && arms[e.tag]?.kind === "f64") {
            const undefTag = arms.findIndex(a => a.kind === "undefinedT");
            if (undefTag >= 0) { const p = produce(e.value, { unionId: e.unionId, numTag: e.tag, undefTag }, e.loc); if (p) return p; }
          }
        }
        if ((e.value.kind === "ternary" || e.value.kind === "seqExpr") && e.type.kind === "f64") {
          const c = [...cands.values()].find(c => c.unionId === e.unionId && c.numTag === e.tag);
          if (c) return narrow(e.value, c, e.loc);
        }
        return e;
      }
      case "call": {
        // `x!` on a number | undefined producer (`nums.pop()!`): the checked narrowing helper only throws for
        // undefined, so the read answers its f64 form into a temporary and only an undefined calls the helper (with
        // undefined, to throw its error); a number is never boxed to be opened again.
        if (!e.callee.startsWith("%union.narrow.") || e.callee.startsWith("%union.narrow.width.") || e.args.length !== 1 || e.type.kind !== "f64") return e;
        const arg = e.args[0]!;
        if (arg.type.kind !== "union") return e;
        const arms = hooks.arms(arg.type.unionId);
        if (arms?.length !== 2) return e;
        const numTag = arms.findIndex(a => a.kind === "f64"), undefTag = arms.findIndex(a => a.kind === "undefinedT");
        if (numTag < 0 || undefTag < 0) return e;
        const c = { unionId: arg.type.unionId, numTag, undefTag };
        const read = produce(arg, c, e.loc);
        if (!read) return e;
        const id = `%optn.${temps++}`;
        f.locals.push({ id, name: id, type: F64, mutable: false });
        const held: IrExpr = { kind: "varRef", localId: id, type: F64, loc: e.loc } as IrExpr;
        const undef: IrExpr = { kind: "unionWrap", unionId: c.unionId, tag: undefTag, value: { kind: "unitLit", unit: "undefined", type: { kind: "undefinedT" }, loc: e.loc }, type: arg.type, loc: e.loc } as IrExpr;
        return {
          kind: "seqExpr", type: F64, loc: e.loc,
          stmts: [{ kind: "varDecl", localId: id, init: read, loc: e.loc }],
          result: { kind: "ternary", cond: { kind: "libCall", fn: "num.isUndefined", args: [held], type: BOOL, loc: e.loc }, then: { ...e, args: [undef] }, else_: held, type: F64, loc: e.loc },
        } as IrExpr;
      }
      case "unionIsTag": {
        const w = wrapOf(e.value);
        if (!w || w.c.unionId !== e.unionId) return e;
        const undef = e.tag === w.c.undefTag;
        const test: IrExpr = { kind: "libCall", fn: "num.isUndefined", args: [w.x], type: BOOL, loc: e.loc };
        return (undef !== e.negated ? test : { kind: "unary", op: "!", operand: test, type: BOOL, loc: e.loc }) as IrExpr;
      }
      case "unionEq": {
        if (e.sameValue) return e;
        const a = wrapOf(e.left), b = wrapOf(e.right);
        if (!a || !b || a.c.unionId !== e.unionId || b.c.unionId !== e.unionId) return e;
        return { kind: "bin", op: e.negated ? "!==" : "===", left: a.x, right: b.x, type: BOOL, loc: e.loc } as IrExpr;
      }
      case "nullish": {
        if (e.type.kind !== "f64" || e.right.type.kind !== "f64") return e;
        const w = wrapOf(e.left);
        if (w) {
          if (!isPure(w.x)) return e;
          return { kind: "ternary", cond: { kind: "libCall", fn: "num.isUndefined", args: [w.x], type: BOOL, loc: e.loc }, then: e.right, else_: w.x, type: F64, loc: e.loc } as IrExpr;
        }
        // `bytes[i] ?? d`, `nums[i] ?? d`, `map.get(k) ?? d`: the read answers its f64 form into a temporary (UNDEF_NAN when
        // absent) and the default runs only in its branch, so no box is made only to be tested and opened.
        if (e.left.type.kind !== "union") return e;
        const arms = hooks.arms(e.left.type.unionId);
        if (arms?.length !== 2) return e;
        const numTag = arms.findIndex(a => a.kind === "f64"), undefTag = arms.findIndex(a => a.kind === "undefinedT");
        if (numTag < 0 || undefTag < 0) return e;
        const read = produce(e.left, { unionId: e.left.type.unionId, numTag, undefTag }, e.loc);
        if (!read) return e;
        const id = `%optn.${temps++}`;
        f.locals.push({ id, name: id, type: F64, mutable: false });
        const held: IrExpr = { kind: "varRef", localId: id, type: F64, loc: e.loc } as IrExpr;
        return {
          kind: "seqExpr", type: F64, loc: e.loc,
          stmts: [{ kind: "varDecl", localId: id, init: read, loc: e.loc }],
          result: { kind: "ternary", cond: { kind: "libCall", fn: "num.isUndefined", args: [held], type: BOOL, loc: e.loc }, then: e.right, else_: held, type: F64, loc: e.loc },
        } as IrExpr;
      }
      default: return e;
    }
  };
  f.body = rw(f.body) as typeof f.body;
  // The slot starts as undefined, as the union's null did (a `var` read before its first write).
  f.body = [...[...cands].map(([id, c]) => ({ kind: "assign", localId: id, value: undefNumber(c, f.loc), loc: f.loc }) as unknown as (typeof f.body)[number]), ...f.body];
  for (const l of f.locals) if (cands.has(l.id)) l.type = F64;
  return new Set(cands.keys());
}
