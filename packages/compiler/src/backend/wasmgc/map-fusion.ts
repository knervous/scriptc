/* Map get-then-set fusion (the idea of upstream bf5c8e7b2c, for the WasmGC map runtime).
 *
 * `const cur = m.get(k); m.set(k, f(cur))` and `m.set(k, (m.get(k) ?? 0) + 1)` hash the key and walk its bucket chain
 * twice; for a string key the hash is FNV-1a over every code unit (V8's cached string hash is out of reach). The read
 * already found the entry index, and an index stays valid until the next mutation of its map (insert may rebuild,
 * delete/clear kill entries). So when
 *
 *   - the write's receiver and key are the read's, structurally (the same local, or the same field path of one, or the
 *     same literal), and
 *   - nothing that runs between them can mutate any collection, assign a local or run user code ("inert": reads,
 *     scalar arithmetic, pure math, other maps' get/has, union tests, allocation of boxes), and
 *   - every path to the write passes through the read (the read is the whole initializer of the statement directly
 *     before the write, or the only Map get in the write's value and evaluated unconditionally there),
 *
 * the write's map and key are the read's at run time and the parked index is current: the write stores the value at
 * that index when the read found the key, and takes the ordinary insert otherwise (a miss appends, as before). An
 * existing key's overwrite keeps its position, so insertion order is unchanged, and the read's find is the SameValueZero
 * match the insert would have made (-0 finds the +0 entry, NaN the NaN entry, in both). WasmGC values are not
 * refcounted, so the store is exactly the insert's own hit path for any value type.
 *
 * String and number keys fuse (structural key identity gives the same f64 bits, so no run-time key test is needed).
 * Async functions and generators are left alone (their bodies are segmented around suspensions).
 * SCRIPTC_WASMGC_NO_MAP_FUSE=1 turns it off (A/B). */
import type { IrExpr, IrFunction, IrStmt } from "../../ir/ir.js";
import { everyExprChild, everyStmtChild } from "../../ir/traverse.js";

type MapOp = IrExpr & { kind: "mapIntrinsic" };

/** One fused pair. The emitter fills `slot` when it emits the read (the local holding the entry index, -1 on a miss),
 * tagged with the function state it belongs to, so a write emitted in another function never uses it. */
export interface MapFusePair { slot: { owner: object; local: number } | null }
export interface MapFusion { reads: Map<IrExpr, MapFusePair>; writes: Map<IrExpr, MapFusePair> }

export interface MapFusionHooks {
  /** A record read that is a plain struct field (no page object behind the record whose getter could run). */
  plainRecordGet(shapeId: string): boolean;
}

const fusableKey = (e: MapOp): boolean => {
  const t = e.receiver.type;
  return t.kind === "map" && (t.key.kind === "string" || t.key.kind === "f64");
};
const isOp = (e: IrExpr | null | undefined, method: "get" | "set"): e is MapOp =>
  !!e && e.kind === "mapIntrinsic" && e.method === method && fusableKey(e);

const scalar = (e: IrExpr) => e.type.kind === "f64" || e.type.kind === "bool";

/** The same value at both sites when nothing between them assigns or mutates: a local, a field path of one, a literal. */
function samePath(a: IrExpr, b: IrExpr, hooks: MapFusionHooks): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "varRef": return a.localId === (b as typeof a).localId;
    case "strLit": return a.value === (b as typeof a).value;
    case "numLit": return Object.is(a.value, (b as typeof a).value);
    case "fieldGet": { const o = b as typeof a; return a.className === o.className && a.field === o.field && samePath(a.obj, o.obj, hooks); }
    case "recordGet": { const o = b as typeof a; return hooks.plainRecordGet(a.shapeId) && a.shapeId === o.shapeId && a.field === o.field && samePath(a.obj, o.obj, hooks); }
    case "unionNarrow": { const o = b as typeof a; return a.unionId === o.unionId && a.tag === o.tag && samePath(a.value, o.value, hooks); }
    case "call": { const o = b as typeof a; return checkedNarrow(a) && a.callee === o.callee && o.args.length === 1 && samePath(a.args[0]!, o.args[0]!, hooks); }
    default: return false;
  }
}

/** The lowerer's checked union extraction `%union.narrow.<n>(u)` (`x!`, a for-of element): the arm's payload, or the
 * catchable TypeError; it runs no user code. (Not `%union.narrow.width.<n>`, which may convert a record.) */
const checkedNarrow = (e: IrExpr): boolean => e.kind === "call" && e.args.length === 1 && /^%union\.narrow\.(?!width\.)/.test(e.callee);

/** The locals a path names. */
function pathLocals(e: IrExpr, out: Set<string>): Set<string> {
  if (e.kind === "varRef") out.add(e.localId);
  else if (e.kind === "fieldGet" || e.kind === "recordGet") pathLocals(e.obj, out);
  else if (e.kind === "call") for (const a of e.args) pathLocals(a, out);
  else if (e.kind === "unionNarrow") pathLocals(e.value, out);
  return out;
}

const INERT = new Set(["numLit", "strLit", "boolLit", "unitLit", "varRef", "bin", "unary", "ternary", "logical", "nullish",
  "orDefault", "toBool", "strEq", "unionIsTag", "unionNarrow", "unionWrap", "fieldGet"]);

/** Runs no user code, mutates no collection and assigns no existing local. */
function inert(e: IrExpr, hooks: MapFusionHooks): boolean {
  switch (e.kind) {
    case "mapIntrinsic": if ((e.method !== "get" && e.method !== "has") || e.receiver.type.kind !== "map" && e.receiver.type.kind !== "set") return false; break;
    case "libCall": if (!(e.fn === "num.isUndefined" || e.fn.startsWith("math.")) || !e.args.every(scalar)) return false; break;
    case "recordGet": if (!hooks.plainRecordGet(e.shapeId)) return false; break;
    case "call": if (!checkedNarrow(e)) return false; break;
    case "bin": case "unary": if (![e.kind === "bin" ? e.left : e.operand, ...(e.kind === "bin" ? [e.right] : [])].every(scalar)) return false; break;
    case "seqExpr":
      // optional-number.ts holds a read in a fresh temporary: declarations of new locals only.
      if (!e.stmts.every(s => s.kind === "varDecl" ? s.init === null || inert(s.init, hooks) : s.kind === "exprStmt" && inert(s.expr, hooks))) return false;
      return inert(e.result, hooks);
    default: if (!INERT.has(e.kind)) return false;
  }
  return everyExprChild(e, child => inert(child, hooks), () => false);
}

/** Whether evaluating `e` always evaluates `target` (not behind a short circuit or a conditional arm). */
function always(e: IrExpr, target: IrExpr): boolean {
  if (e === target) return true;
  switch (e.kind) {
    case "bin": return always(e.left, target) || always(e.right, target);
    case "unary": return always(e.operand, target);
    case "toBool": return always(e.operand, target);
    case "logical": case "nullish": case "orDefault": return always(e.left, target);
    case "ternary": return always(e.cond, target);
    case "unionIsTag": case "unionNarrow": case "unionWrap": return always(e.value, target);
    case "libCall": case "call": return e.args.some(a => always(a, target));
    case "seqExpr": return e.stmts.some(s => s.kind === "varDecl" ? !!s.init && always(s.init, target) : s.kind === "exprStmt" && always(s.expr, target)) || always(e.result, target);
    default: return false;
  }
}

/** The Map gets inside `e`. */
function gets(e: IrExpr, out: MapOp[]): MapOp[] {
  if (e.kind === "mapIntrinsic" && e.method === "get") out.push(e);
  const stmt = (st: IrStmt): boolean => everyStmtChild(st, child => (gets(child, out), true), stmt);
  everyExprChild(e, child => (gets(child, out), true), stmt);
  return out;
}

const sameValueKind = (a: MapOp, b: MapOp): boolean => {
  const r = a.receiver.type, w = b.receiver.type;
  return r.kind === "map" && w.kind === "map" && r.key.kind === w.key.kind && r.value.kind === w.value.kind;
};

export function findMapFusions(f: IrFunction, hooks: MapFusionHooks): MapFusion {
  const out: MapFusion = { reads: new Map(), writes: new Map() };
  if (f.async || f.generator) return out;
  const matches = (read: MapOp, write: MapOp, assigned: string | null): boolean => {
    if (!sameValueKind(read, write) || !samePath(read.receiver, write.receiver, hooks) || !samePath(read.args[0]!, write.args[0]!, hooks)) return false;
    if (assigned !== null && (pathLocals(read.receiver, new Set()).has(assigned) || pathLocals(read.args[0]!, new Set()).has(assigned))) return false;
    return inert(read.receiver, hooks) && inert(read.args[0]!, hooks);
  };
  const pair = (read: MapOp, write: MapOp) => {
    if (out.reads.has(read) || out.writes.has(write)) return;
    const p: MapFusePair = { slot: null };
    out.reads.set(read, p); out.writes.set(write, p);
  };
  const writeOf = (s: IrStmt | undefined): MapOp | null => s?.kind === "exprStmt" && isOp(s.expr, "set") ? s.expr : null;
  const visitList = (list: readonly IrStmt[]) => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      // m.set(k, ...m.get(k)...): the value's only Map get, evaluated unconditionally (after the receiver and key).
      const single = writeOf(s);
      if (single) {
        const found = gets(single.args[1]!, []);
        const read = found.length === 1 ? found[0]! : null;
        if (read && isOp(read, "get") && always(single.args[1]!, read) && matches(read, single, null) && inert(single.args[1]!, hooks)) pair(read, single);
      }
      // const cur = m.get(k); m.set(k, ...): the read is the whole initializer, the write the next statement.
      const value = s.kind === "varDecl" ? s.init : s.kind === "assign" ? s.value : null;
      const assigned = s.kind === "varDecl" || s.kind === "assign" ? s.localId : null;
      const next = writeOf(list[i + 1]);
      if (value && next && isOp(value, "get") && matches(value, next, assigned) && inert(next.args[1]!, hooks) &&
        gets(next.args[1]!, []).every(g => g !== value)) pair(value, next);
    }
  };
  // Every statement list in the body (the walk sees lists nested in expressions too: a seqExpr's statements).
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      if (n.length && n.every(x => x && typeof x === "object" && typeof (x as { kind?: unknown }).kind === "string")) visitList(n as IrStmt[]);
      for (const x of n) walk(x);
      return;
    }
    for (const k in n as Record<string, unknown>) if (k !== "loc" && k !== "type") walk((n as Record<string, unknown>)[k]);
  };
  walk(f.body);
  return out;
}
