import { BOOL, F64, type IrExpr, type IrFunction, type IrLocal, type IrModule, type IrStmt } from "./ir.js";
import { analyzeIntegerRanges, type IntegerRange } from "./integer-ranges-wasmgc.js";
import { copyWithFreshLocals } from "./fresh-locals.js";
import { everyExpr, everyStmtList, mapStmtChildren } from "./traverse.js";

/** Typed-array bounds versions (WasmGC backend only; the native backend does not run this pass).
 *
 * A typed-array read or write checks its index against the array's length at every access, and a read that misses
 * yields JavaScript's undefined. A matrix kernel (`out[offset + 4] = a[1] * b[4] + ...`) pays sixteen to thirty-two
 * such compares, each with its own undefined arm, for indexes that are all in range or all out of it together.
 *
 * This pass finds, in a statement list, the accesses `p[x + t]` where
 * - `p` is a local or parameter of a typed-array type nothing assigns (a parameter, or a local whose declarations
 *   all initialize it), declared before the region and not again inside it, so the array and its length (a typed
 *   array's length is fixed) are the guard's;
 * - `x`, the base, is such a number local or parameter, or absent (an index of known range alone);
 * - `t` is a sum of integer literals and expressions with a proven integer range (ir/integer-ranges.ts: a bounded
 *   counter times a constant, a mask), with never-assigned temporaries (an element store's
 *   `%storeIndex.N = offset + 1`, `%storeReceiver.N = out`) seen through to the declaration that dominates the use;
 * and puts the rest of the list behind one guard per array and base: `x` is an integer, `x + lo >= 0` and
 * `x + hi < p.length` over the offsets `t` spans. When the guard holds, a copy of the statements runs whose
 * qualifying accesses are known to be in bounds (`provenInBounds`): the backend emits them as a plain load or
 * store at an i32 index, with no compare and no undefined arm. Otherwise the statements run as they are.
 *
 * The guard is placed after the declarations of the arrays and bases it reads, so a list qualifies from its first
 * statement after them. Only statement lists outside loops are versioned (a function body, a branch, a block, an
 * arm copy of ir/union-arm-loops.ts): a guard inside a loop would run per iteration, costing what it saves; the
 * accesses inside a versioned region's loops are proven with it. The guard's bounds on `x` (`x >= -lo`, `x < 2^31 - 1 - hi`) also refine the copy's own
 * integer ranges, so its index sums are int32 there.
 *
 * Bounds: at least MIN_ACCESSES proven accesses, at most MAX_GUARDS guarded (array, base) pairs, the copied region
 * at most MAX_REGION_COST nodes, and MAX_FUNCTION_COST for one function's copies together. A region holding a
 * closure or class value, a try, a yield or an await is never copied (the backend keys capture carriers and frames
 * by site). Once a list is versioned its copies are not versioned again. */
const MIN_ACCESSES = 3;
const MAX_GUARDS = 6;
const MAX_REGION_COST = 1200;
const MAX_FUNCTION_COST = 2400;
const INT32_MAX = 2147483647;
const SIGNED_RANGE: IntegerRange = { min: -2147483648, max: 2147483647 };

/** The accesses (bytesIntrinsic get, bytesSet) of the versioned copies that are in bounds, to the base local their
 * guard proved an int32 (as the copy names it), or null. */
export const provenInBounds = new WeakMap<IrExpr | IrStmt, string | null>();

export function versionTypedArrayBounds(mod: IrModule): IrModule {
  let changed = false;
  const functions = mod.functions.map((fn) => {
    const next = rewriteFunction(fn);
    if (next !== fn) changed = true;
    return next;
  });
  return changed ? { ...mod, functions } : mod;
}

type Access = (IrExpr & { kind: "bytesIntrinsic" }) | (IrStmt & { kind: "bytesSet" });

/** One access's guard requirement: receiver `p`, base `x` (or null), offsets [lo, hi]; its index and the declarations
 * it saw, to decompose it again. */
interface Need { access: Access; p: string; x: string | null; lo: number; hi: number; index: IrExpr; visible: ReadonlyMap<string, IrExpr> }

interface Facts {
  fn: IrFunction;
  ranges: ReadonlyMap<IrExpr, IntegerRange | null>;
  /** The ranges with the never-assigned number parameters entering as int32, and those parameters (see list()). */
  assumedRanges: ReadonlyMap<IrExpr, IntegerRange | null> | null;
  assumable: ReadonlySet<string>;
  /** Set while a list is tried under assumedRanges: the parameters whose int32 test the guard adds. */
  assume: ReadonlySet<string> | null;
  locals: ReadonlyMap<string, IrLocal>;
  /** Locals nothing assigns: a parameter, or a local every declaration of which initializes it. */
  single: ReadonlySet<string>;
  budget: number;
  /** The fast copies' renamed locals. */
  added: IrLocal[];
  used: Set<string>;
}

function hasAccess(fn: IrFunction): boolean {
  return !everyStmtList(fn.body, {
    expr: (e) => !(e.kind === "bytesIntrinsic" && e.method === "get"),
    stmt: (s) => s.kind !== "bytesSet",
  });
}

function rewriteFunction(fn: IrFunction): IrFunction {
  // A parameter an `arguments` object may alias could change with no write of its own.
  if (fn.async || fn.generator || fn.paramModes?.includes("arguments") || !hasAccess(fn)) return fn;
  const captured = new Set([...(fn.captures ?? []), ...(fn.classCaptures ?? [])].map((c) => c.localId));
  const writes = new Map<string, number>(), decls = new Map<string, number>(), uninitialized = new Set<string>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  everyStmtList(fn.body, {
    expr: (e) => {
      if (e.kind === "assignExpr" || e.kind === "incDec") bump(writes, e.localId);
      return true;
    },
    stmt: (s) => {
      if (s.kind === "assign" || s.kind === "forOf" || s.kind === "rethrow") bump(writes, s.localId);
      else if (s.kind === "tryCatch" && s.catchLocalId !== null) bump(writes, s.catchLocalId);
      else if (s.kind === "varDecl") { bump(decls, s.localId); if (s.init === null) uninitialized.add(s.localId); }
      return true;
    },
  });
  const params = new Set(fn.params.map((p) => p.localId));
  const locals = new Map(fn.locals.map((l) => [l.id, l]));
  const single = new Set<string>();
  for (const l of fn.locals) {
    if (l.boxed === true || l.tdz === true || captured.has(l.id) || (writes.get(l.id) ?? 0) > 0) continue;
    const d = decls.get(l.id) ?? 0;
    if (params.has(l.id) ? d === 0 : d >= 1 && !uninitialized.has(l.id)) single.add(l.id);
  }
  // Number parameters nothing assigns: a guard can test that each is an int32 (`p === (p | 0)`) once, and the copy then
  // holds every fact that follows from it (`band * BAND` an integer, so `Math.min(H - 1, Math.max(0, y + k)) * W + x`
  // has a range). Only tried where the plain ranges version nothing, so a region that qualifies today keeps its guard.
  const assumable = new Set(fn.params.filter((p) => p.type.kind === "f64" && single.has(p.localId)).map((p) => p.localId));
  const facts: Facts = { fn, ranges: analyzeIntegerRanges(fn), locals, single, budget: MAX_FUNCTION_COST, added: [], used: new Set(fn.locals.map((l) => l.id)),
    assumedRanges: assumable.size ? analyzeIntegerRanges(fn, new Set(), new Map([...assumable].map((id) => [id, SIGNED_RANGE]))) : null, assumable, assume: null };
  let changed = false;
  const list = (stmts: IrStmt[], visible: ReadonlyMap<string, IrExpr>): IrStmt[] => {
    let versioned = versionList(stmts, visible, facts);
    if (versioned === null && facts.assumedRanges !== null) {
      const plain = facts.ranges;
      facts.ranges = facts.assumedRanges; facts.assume = facts.assumable;
      try { versioned = versionList(stmts, visible, facts); } finally { facts.ranges = plain; facts.assume = null; }
    }
    if (versioned !== null) changed = true;
    // The statements before a versioned region (all of them when there is none) may hold lists of their own.
    const head = versioned === null ? stmts.length : versioned.at;
    const out: IrStmt[] = [];
    const scope = new Map(visible);
    for (const s of stmts.slice(0, head)) {
      out.push(stmt(s, scope));
      declare(s, scope, facts);
    }
    if (versioned !== null) out.push(versioned.guarded);
    return out;
  };
  // Loops are not entered: their lists run per iteration.
  const stmt = (s: IrStmt, visible: ReadonlyMap<string, IrExpr>): IrStmt => {
    switch (s.kind) {
      case "block": return { ...s, body: list(s.body, visible) };
      case "if": return { ...s, then: list(s.then, visible), else_: s.else_ === null ? null : list(s.else_, visible) };
      default: return s;
    }
  };
  const body = list(fn.body, new Map());
  return changed ? { ...fn, body, locals: [...fn.locals, ...facts.added] } : fn;
}

/** A never-assigned local's declaration seen by the statements after it (its value there is its initializer's); a
 * statement redeclaring one inside it hides the earlier declaration from the statements after it. */
function declare(s: IrStmt, scope: Map<string, IrExpr>, facts: Facts): void {
  if (s.kind === "varDecl") {
    if (s.init !== null && facts.single.has(s.localId)) scope.set(s.localId, s.init);
    else scope.delete(s.localId);
    return;
  }
  if (scope.size === 0) return;
  everyStmtList([s], { expr: () => true, stmt: (c) => { if (c.kind === "varDecl") scope.delete(c.localId); return true; } });
}

/** The local a receiver expression names, through single-definition copies (`%storeReceiver.N = out`). */
function receiverOf(e: IrExpr, visible: ReadonlyMap<string, IrExpr>, facts: Facts): string | null {
  for (let hops = 0; hops < 4; hops++) {
    if (e.kind !== "varRef" || !facts.single.has(e.localId)) return null;
    const init = visible.get(e.localId);
    if (init === undefined || init.kind !== "varRef") return e.type.kind === "bytes" ? e.localId : null;
    e = init;
  }
  return null;
}

/** An index as base + [lo, hi], or null. */
function decompose(e: IrExpr, visible: ReadonlyMap<string, IrExpr>, facts: Facts): { x: string | null; lo: number; hi: number } | null {
  let x: string | null = null, lo = 0, hi = 0, depth = 0;
  const term = (t: IrExpr, sign: 1 | -1): boolean => {
    if (++depth > 64) return false;
    if (t.type.kind !== "f64") return false;
    if (t.kind === "numLit") {
      if (!Number.isSafeInteger(t.value)) return false;
      lo += sign * t.value; hi += sign * t.value; return true;
    }
    if (t.kind === "bin" && (t.op === "+" || t.op === "-")) return term(t.left, sign) && term(t.right, t.op === "+" ? sign : sign === 1 ? -1 : 1);
    const range = facts.ranges.get(t);
    if (range) {
      if (sign === 1) { lo += range.min; hi += range.max; } else { lo -= range.max; hi -= range.min; }
      return true;
    }
    if (t.kind === "varRef" && facts.single.has(t.localId)) {
      const init = visible.get(t.localId);
      if (init !== undefined) {
        const saved = { x, lo, hi };
        if (term(init, sign)) return true;
        ({ x, lo, hi } = saved);
      }
      // A parameter, or a local whose initializer is no such sum: the base.
      if (sign !== 1 || x !== null || facts.locals.get(t.localId)?.type.kind !== "f64") return false;
      x = t.localId; return true;
    }
    return false;
  };
  if (!term(e, 1) || !Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) return null;
  return { x, lo, hi };
}

/** The accesses under `s` with their requirements, seeing single-definition declarations in order. */
function collect(s: IrStmt, visible: ReadonlyMap<string, IrExpr>, facts: Facts, out: Need[]): void {
  const exprs = (e: IrExpr): void => {
    everyExpr(e, {
      expr: (x) => {
        if (x.kind === "bytesIntrinsic" && x.method === "get" && x.args.length === 1) need(x, x.receiver, x.args[0]!);
        return true;
      },
      stmt: () => true,
    });
  };
  const need = (access: Access, recv: IrExpr, index: IrExpr): void => {
    const p = receiverOf(recv, visible, facts);
    if (p === null) return;
    const d = decompose(index, visible, facts);
    if (d !== null) out.push({ access, p, ...d, index, visible: new Map(visible) });
  };
  const list = (stmts: IrStmt[], from: ReadonlyMap<string, IrExpr> = visible): void => {
    const scope = new Map(from);
    for (const child of stmts) { collect(child, scope, facts, out); declare(child, scope, facts); }
  };
  // A loop's later iterations see what its body declares: those declarations hide outer ones throughout it.
  const loopScope = (loop: IrStmt): Map<string, IrExpr> => {
    const scope = new Map(visible);
    everyStmtList([loop], { expr: () => true, stmt: (c) => { if (c.kind === "varDecl") scope.delete(c.localId); return true; } });
    return scope;
  };
  switch (s.kind) {
    case "block": list(s.body); return;
    case "if": exprs(s.cond); list(s.then); if (s.else_ !== null) list(s.else_); return;
    case "while": case "doWhile": {
      const inner = loopScope(s);
      collect({ kind: "exprStmt", expr: s.cond, loc: s.loc }, inner, facts, out);
      list(s.body, inner);
      return;
    }
    case "for": {
      if (s.init !== null) collect(s.init, visible, facts, out);
      const inner = loopScope(s);
      if (s.cond !== null) collect({ kind: "exprStmt", expr: s.cond, loc: s.loc }, inner, facts, out);
      list(s.body, inner);
      if (s.update !== null) collect(s.update, inner, facts, out);
      return;
    }
    case "bytesSet":
      exprs(s.arr); exprs(s.index); exprs(s.value);
      need(s, s.arr, s.index);
      return;
    default: {
      // Other statements (a switch, a labeled statement): their nested statements see none of the declarations made
      // anywhere inside them, as in a loop.
      const inner = loopScope(s);
      mapStmtChildren(s, (e) => (exprs(e), e), (child) => (collect(child, inner, facts, out), child));
    }
  }
}

/** Where the statement list `stmts` last declares `id` as one of its own statements, -1 when it does not (a
 * parameter, an outer local), or null when a nested statement of it does. */
function declaredAt(stmts: IrStmt[], id: string): number | null {
  let at = -1;
  for (let k = 0; k < stmts.length; k++) {
    const s = stmts[k]!;
    if (s.kind === "varDecl") { if (s.localId === id) at = k; continue; }
    let nested = false;
    everyStmtList([s], { expr: () => true, stmt: (c) => !(nested = c.kind === "varDecl" && c.localId === id) });
    if (nested) return null;
  }
  return at;
}

/** The list's statements from `at` on behind their guard, or null when the list does not qualify. */
function versionList(stmts: IrStmt[], visible: ReadonlyMap<string, IrExpr>, facts: Facts): { at: number; guarded: IrStmt } | null {
  if (stmts.length === 0) return null;
  // The accesses of each top-level statement, and where each may first be guarded.
  const located: { need: Need; at: number; start: number }[] = [];
  const scope = new Map(visible);
  for (let k = 0; k < stmts.length; k++) {
    const found: Need[] = [];
    collect(stmts[k]!, scope, facts, found);
    declare(stmts[k]!, scope, facts);
    for (const need of found) {
      const ps = declaredAt(stmts, need.p), xs = need.x === null ? -1 : declaredAt(stmts, need.x);
      if (ps === null || xs === null) continue;
      if (need.x === null && need.lo < 0) continue;
      const start = Math.max(ps, xs) + 1;
      if (start <= k) located.push({ need, at: k, start });
    }
  }
  if (located.length < MIN_ACCESSES) return null;
  // The guard position covering the most accesses (the earliest among equals).
  let best = -1, bestCount = 0;
  for (const start of new Set(located.map((l) => l.start))) {
    const count = located.filter((l) => l.start <= start && l.at >= start).length;
    if (count > bestCount || (count === bestCount && start < best)) { best = start; bestCount = count; }
  }
  if (bestCount < MIN_ACCESSES) return null;
  // An array or base declared again inside the region could change between the guard and the access.
  const redeclared = new Set<string>();
  everyStmtList(stmts.slice(best), { expr: () => true, stmt: (c) => { if (c.kind === "varDecl") redeclared.add(c.localId); return true; } });
  let chosen = located.filter((l) => l.start <= best && l.at >= best && !redeclared.has(l.need.p) && (l.need.x === null || !redeclared.has(l.need.x))).map((l) => l.need);
  // One guard per (array, base): the offsets its accesses span. The pairs with the most accesses, at most MAX_GUARDS.
  const groups = new Map<string, { p: string; x: string | null; lo: number; hi: number; needs: Need[] }>();
  for (const need of chosen) {
    const key = `${need.p}\u0000${need.x ?? ""}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { p: need.p, x: need.x, lo: need.lo, hi: need.hi, needs: [need] });
    else { g.lo = Math.min(g.lo, need.lo); g.hi = Math.max(g.hi, need.hi); g.needs.push(need); }
  }
  const kept = [...groups.values()].filter((g) => g.hi - g.lo < INT32_MAX).sort((a, b) => b.needs.length - a.needs.length).slice(0, MAX_GUARDS);
  chosen = kept.flatMap((g) => g.needs);
  if (chosen.length < MIN_ACCESSES) return null;
  const region = stmts.slice(best);
  if (!copyable(region)) return null;
  const cost = nodeCount(region);
  if (cost > MAX_REGION_COST || cost > facts.budget) return null;
  facts.budget -= cost;

  const loc = region[0]!.loc;
  const ref = (id: string): IrExpr => ({ kind: "varRef", localId: id, type: facts.locals.get(id)!.type, loc });
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  const bin = (op: "<" | ">=" | "===" | "+" | "|", left: IrExpr, right: IrExpr): IrExpr =>
    ({ kind: "bin", op, left, right, type: op === "+" || op === "|" ? F64 : BOOL, loc });
  const length = (p: string): IrExpr => ({ kind: "bytesIntrinsic", method: "length", receiver: ref(p), args: [], type: F64, loc });
  const tests: IrExpr[] = [];
  for (const g of kept) {
    if (g.x === null) { tests.push(bin("<", num(g.hi), length(g.p))); continue; }
    const x = () => ref(g.x!);
    // x >= -lo and x < 2^31 - 1 - hi first (they bound x for the copy's ranges), then x an integer, then the length.
    tests.push(bin(">=", x(), num(-g.lo)), bin("<", x(), num(INT32_MAX - g.hi)), bin("===", bin("|", x(), num(0)), x()), bin("<", bin("+", x(), num(g.hi)), length(g.p)));
  }
  // Under the parameter assumption: each assumed parameter the region reads is an int32 (-0 passes, and reads as 0 in
  // the index math the assumption proved, as it does without it).
  // A parameter the proofs do not need (every chosen access decomposes within its group's offsets without assuming it)
  // is not tested: a fractional argument there must not keep the region off its fast copy.
  if (facts.assume !== null) {
    const read = new Set<string>();
    everyStmtList(region, { expr: (e) => { if (e.kind === "varRef" && facts.assume!.has(e.localId)) read.add(e.localId); return true; }, stmt: () => true });
    const assumed = new Set(read);
    for (const id of read) {
      const others = new Set([...assumed].filter((a) => a !== id));
      const ranges = analyzeIntegerRanges(facts.fn, new Set(), new Map([...others].map((a) => [a, SIGNED_RANGE])));
      const saved = facts.ranges;
      facts.ranges = ranges;
      try {
        const holds = kept.every((g) => g.needs.every((n) => { const d = decompose(n.index, n.visible, facts); return d !== null && d.x === n.x && d.lo >= g.lo && d.hi <= g.hi; }));
        if (holds) assumed.delete(id);
      } finally { facts.ranges = saved; }
    }
    for (const id of [...assumed].reverse()) tests.unshift(bin("===", bin("|", ref(id), num(0)), ref(id)));
  }
  const cond = tests.reduce((all, test): IrExpr => ({ kind: "logical", op: "&&", left: all, right: test, type: BOOL, loc }));
  // The fast copy's own locals (declared in the region, read nowhere else) take fresh ids, so the backend types them
  // from the copy's writes alone (an index temporary is an i32 there, where the guard bounds its base).
  const { copy: fast, added, renames } = copyWithFreshLocals(facts.fn.body, region, facts.locals, facts.used, "$inb");
  facts.added.push(...added);
  // The copy has the region's shape: its nodes pair with the original's in walk order.
  const original = nodesOf(region), copied = nodesOf(fast);
  const proven = new Map<object, string | null>(chosen.map((n) => [n.access, n.x]));
  original.forEach((node, k) => {
    const base = proven.get(node);
    if (base !== undefined) provenInBounds.set(copied[k] as Access, base === null ? null : renames.get(base) ?? base);
  });
  return { at: best, guarded: { kind: "if", cond, then: fast, else_: region, loc } };
}

function nodesOf(stmts: IrStmt[]): (IrExpr | IrStmt)[] {
  const out: (IrExpr | IrStmt)[] = [];
  everyStmtList(stmts, { expr: (e) => (out.push(e), true), stmt: (s) => (out.push(s), true) });
  return out;
}

/** Whether the backend takes a copy of the region as it is (see the header). */
function copyable(region: IrStmt[]): boolean {
  return everyStmtList(region, {
    expr: (e) => e.kind !== "closure" && e.kind !== "classRef" && e.kind !== "yieldExpr" && e.kind !== "awaitExpr" && e.kind !== "awaitUnionExpr",
    stmt: (s) => s.kind !== "tryCatch",
  });
}

function nodeCount(region: IrStmt[]): number {
  let count = 0;
  everyStmtList(region, { expr: () => (count++, true), stmt: () => (count++, true) });
  return count;
}

