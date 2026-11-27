/* Numeric webs: give each run of a dynamic local that only ever holds
 * numbers its own f64 local.
 *
 * Minified JavaScript reuses variables across unrelated values. React's
 * production build, for instance, counts a loop with the variable that held
 * a fiber a few statements earlier:
 *
 *   current = currentlyRenderingFiber.alternate; ...
 *   for (updateQueue = ..., current = 0; current < size; current++)
 *     updateQueue[current] = REACT_MEMO_CACHE_SENTINEL;
 *
 * The checker types `current` as `any`, so every read is a boxed dyn value:
 * the comparison boxes, `current++` unboxes and boxes again, and the store
 * takes the generic computed-key path. Yet every value that reaches the
 * loop's reads was produced by `0` or by `current++`.
 *
 * This pass computes reaching definitions over the structured IR, joins the
 * definitions that reach a common read into webs (the classic register
 * allocation webs), and moves every web whose definitions all produce
 * numbers into a fresh f64 local. Reads in such a web become `dynFrom(f64)`,
 * so a consumer that is not numeric sees exactly the dyn number it saw
 * before, while numeric consumers (comparisons, `++`, number keys) take
 * their native paths. A definition is numeric when its value is statically
 * an f64, `++`/`--`/ToNumeric of a numeric value, a read of a numeric web,
 * or a conditional choosing between numeric values.
 *
 * Soundness rests on over-approximating reaching definitions, never under:
 * a read joined with too many definitions only keeps a web dynamic. The
 * analysis tracks only unboxed dynamic locals of the function itself (never
 * parameters, captures, catch or for-of bindings), and gives up on a local
 * that any other node names. Exceptional control flow is approximated (a
 * catch or finally sees every definition of the try body), and a local
 * written inside a finally block is not tracked at all, since break and
 * return paths run that block before reaching their targets.
 */
import type { IrExpr, IrFunction, IrStmt, IrType } from "./ir.js";
import { everyExprChild, everyStmtChild, mapExprChildren, mapStmtChildren, transformStmtList } from "./traverse.js";

const F64: IrType = { kind: "f64" };
const DYN: IrType = { kind: "dyn" };
const BOOL: IrType = { kind: "bool" };

type DefNode = IrStmt | IrExpr;
interface Def { local: string; node: DefNode | null; value: IrExpr | null }
/** Reaching definitions per tracked local; null is an unreachable point. */
type State = Map<string, Set<number>> | null;

interface Target { labels: string[]; loop: boolean; breakable: boolean; breaks: State[]; continues: State[] }

const isNumberExpr = (e: IrExpr): boolean => e.type.kind === "f64";

/** Split the numeric webs of `fn` in place; returns how many were split. */
export function splitNumericWebs(fn: IrFunction): number {
  if (fn.async || fn.generator) return 0;
  // Parameters are tracked (their entry value is a definition of its own)
  // unless the function can observe them through an arguments object.
  const usesArguments = (fn.paramModes ?? []).some((mode) => mode !== "required" && mode !== "omittable") || fn.locals.some((l) => l.name === "arguments");
  const excludedParams = new Set(usesArguments ? fn.params.map((p) => p.localId) : []);
  const captures = new Set((fn.captures ?? []).map((c) => c.localId));
  const dynLocals = new Set(fn.locals.filter((l) => l.type.kind === "dyn" && !l.boxed && !excludedParams.has(l.id) && !captures.has(l.id)).map((l) => l.id));
  if (dynLocals.size === 0) return 0;

  // Candidates: dyn locals with at least one definition that could be a
  // number; any other node naming the local takes it out.
  const excluded = new Set<string>();
  const maybeNumeric = new Set<string>();
  const potential = (v: IrExpr | null): boolean => {
    if (!v) return false;
    if (v.kind === "dynFrom") return isNumberExpr(v.value);
    if (v.kind === "libCall") return v.fn === "dyn.increment" || v.fn === "dyn.toNumeric" || v.fn === "dyn.bitwise" || v.fn === "dyn.arithmetic" || v.fn === "dyn.add";
    if (v.kind === "varRef") return dynLocals.has(v.localId);
    if (v.kind === "ternary") return potential(v.then) && potential(v.else_);
    return false;
  };
  const scanNode = (n: unknown, inFinally: boolean): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) scanNode(x, inFinally); return; }
    const o = n as Record<string, unknown> & { kind?: string; localId?: string };
    if (typeof o.localId === "string" && dynLocals.has(o.localId)) {
      if (o.kind === "assign" || o.kind === "assignExpr") { if (inFinally) excluded.add(o.localId); else if (potential(o.value as IrExpr)) maybeNumeric.add(o.localId); }
      else if (o.kind === "varDecl") { if (inFinally && o.init) excluded.add(o.localId); else if (potential(o.init as IrExpr | null)) maybeNumeric.add(o.localId); }
      else if (o.kind !== "varRef") excluded.add(o.localId);
    }
    if (typeof o.catchLocalId === "string") excluded.add(o.catchLocalId);
    if (o.kind === "tryCatch") {
      scanNode(o.tryBody, inFinally); scanNode(o.catchBody, inFinally); scanNode(o.finallyBody, true);
      return;
    }
    for (const k in o) if (k !== "loc" && k !== "type") { const v = o[k]; if (v && typeof v === "object") scanNode(v, inFinally); }
  };
  scanNode(fn.body, false);
  const tracked = new Set([...maybeNumeric].filter((id) => !excluded.has(id)));
  if (tracked.size === 0) return 0;

  // ── reaching definitions ──
  const defs: Def[] = [];
  const defIds = new Map<DefNode, number>();
  const uses = new Map<IrExpr, Set<number>>();
  const entry = new Map<string, number>(), unknown = new Map<string, number>();
  for (const id of tracked) {
    entry.set(id, defs.push({ local: id, node: null, value: null }) - 1);
    unknown.set(id, defs.push({ local: id, node: null, value: null }) - 1);
  }
  const defOf = (node: DefNode, local: string, value: IrExpr | null): number => {
    let id = defIds.get(node);
    if (id === undefined) { id = defs.push({ local, node, value }) - 1; defIds.set(node, id); }
    return id;
  };
  const initial = (): Map<string, Set<number>> => new Map([...tracked].map((id) => [id, new Set([entry.get(id)!])]));
  const unknownState = (): Map<string, Set<number>> => new Map([...tracked].map((id) => [id, new Set([unknown.get(id)!])]));
  const live = (s: State): Map<string, Set<number>> => s ?? unknownState();
  const setDef = (s: State, local: string, def: number): State => {
    const out = new Map(live(s)); out.set(local, new Set([def])); return out;
  };
  const merge = (...states: State[]): State => {
    let out: Map<string, Set<number>> | null = null;
    for (const s of states) {
      if (!s) continue;
      if (!out) { out = new Map([...s].map(([k, v]) => [k, new Set(v)])); continue; }
      for (const [k, v] of s) { const t = out.get(k)!; for (const d of v) t.add(d); }
    }
    return out;
  };
  const same = (a: State, b: State): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    for (const [k, v] of a) { const w = b.get(k)!; if (v.size !== w.size) return false; for (const d of v) if (!w.has(d)) return false; }
    return true;
  };
  const record = (e: IrExpr, s: State): void => {
    const local = (e as { localId: string }).localId;
    let set = uses.get(e);
    if (!set) uses.set(e, set = new Set());
    for (const d of live(s).get(local)!) set.add(d);
  };

  // Does a subtree define a tracked local? (Expressions only; memoized.)
  const definesMemo = new WeakMap<object, boolean>();
  const defines = (n: IrExpr | IrStmt): boolean => {
    const hit = definesMemo.get(n);
    if (hit !== undefined) return hit;
    let found = false;
    const visitExpr = (e: IrExpr): boolean => {
      if ((e.kind === "assignExpr") && tracked.has(e.localId)) { found = true; return false; }
      return everyExprChild(e, visitExpr, visitStmt);
    };
    const visitStmt = (s: IrStmt): boolean => {
      if ((s.kind === "assign" || (s.kind === "varDecl" && s.init)) && tracked.has(s.localId)) { found = true; return false; }
      return everyStmtChild(s, visitExpr, visitStmt);
    };
    if (isStmtKind((n as { kind: string }).kind)) visitStmt(n as IrStmt); else visitExpr(n as IrExpr);
    definesMemo.set(n, found);
    return found;
  };
  /** Every tracked definition in a subtree (registered), for unordered regions. */
  const allDefsIn = (n: IrExpr | IrStmt | IrStmt[] | null): Map<string, number[]> => {
    const out = new Map<string, number[]>();
    const add = (local: string, id: number) => { const l = out.get(local); if (l) l.push(id); else out.set(local, [id]); };
    const visitExpr = (e: IrExpr): boolean => {
      if (e.kind === "assignExpr" && tracked.has(e.localId)) add(e.localId, defOf(e, e.localId, e.value));
      return everyExprChild(e, visitExpr, visitStmt);
    };
    const visitStmt = (s: IrStmt): boolean => {
      if (s.kind === "assign" && tracked.has(s.localId)) add(s.localId, defOf(s, s.localId, s.value));
      if (s.kind === "varDecl" && s.init && tracked.has(s.localId)) add(s.localId, defOf(s, s.localId, s.init));
      return everyStmtChild(s, visitExpr, visitStmt);
    };
    if (n === null) return out;
    if (Array.isArray(n)) n.forEach(visitStmt);
    else if (isStmtKind((n as { kind: string }).kind)) visitStmt(n as IrStmt); else visitExpr(n as IrExpr);
    return out;
  };
  const withDefs = (s: State, ds: Map<string, number[]>): State => {
    if (ds.size === 0) return s;
    const out = merge(live(s))!;
    for (const [local, ids] of ds) for (const id of ids) out.get(local)!.add(id);
    return out;
  };
  /** Record every read in a subtree against one state (no definitions inside). */
  const recordAll = (n: IrExpr | IrStmt, s: State): void => {
    const visitExpr = (e: IrExpr): boolean => {
      if (e.kind === "varRef" && tracked.has(e.localId)) record(e, s);
      return everyExprChild(e, visitExpr, visitStmt);
    };
    const visitStmt = (st: IrStmt): boolean => everyStmtChild(st, visitExpr, visitStmt);
    if (isStmtKind((n as { kind: string }).kind)) visitStmt(n as IrStmt); else visitExpr(n as IrExpr);
  };
  /** A region evaluated in no known order: every read sees every definition. */
  const unordered = (n: IrExpr | IrStmt, s: State): State => {
    const out = withDefs(s, allDefsIn(n));
    recordAll(n, out);
    return out;
  };

  const targets: Target[] = [];
  const walkExpr = (e: IrExpr, s0: State): State => {
    const s = live(s0);
    if (!defines(e)) { recordAll(e, s); return s; }
    switch (e.kind) {
      case "assignExpr": {
        const after = walkExpr(e.value, s);
        return tracked.has(e.localId) ? setDef(after, e.localId, defOf(e, e.localId, e.value)) : after;
      }
      case "seqExpr": return walkExpr(e.result, walkStmts(e.stmts, s));
      case "logical": case "nullish": case "orDefault": {
        const l = walkExpr(e.left, s);
        return merge(l, walkExpr(e.right, l));
      }
      case "ternary": {
        const c = walkExpr(e.cond, s);
        return merge(walkExpr(e.then, c), walkExpr(e.else_, c));
      }
      case "optChain": {
        const r = walkExpr(e.receiver, s);
        return merge(r, walkExpr(e.body, r));
      }
      default: return unordered(e, s);
    }
  };
  const walkStmts = (list: IrStmt[], s: State): State => {
    // Statements after an abrupt completion are dead: they are walked (so
    // their reads and writes are known) from an unknown state that never
    // flows on.
    for (const st of list) { if (s === null) walkStmt(st, unknownState()); else s = walkStmt(st, s); }
    return s;
  };
  const findTarget = (label: string | undefined, forContinue: boolean): Target | null => {
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]!;
      if (label !== undefined ? t.labels.includes(label) && (!forContinue || t.loop) : forContinue ? t.loop : t.breakable) return t;
    }
    return null;
  };
  const loop = (labels: string[] | undefined, head0: State, iterate: (head: State, t: Target) => { exit: State; back: State }): State => {
    let head = merge(head0);
    for (let round = 0; ; round++) {
      const t: Target = { labels: labels ?? [], loop: true, breakable: true, breaks: [], continues: [] };
      targets.push(t);
      let r: { exit: State; back: State };
      try { r = iterate(head, t); } finally { targets.pop(); }
      const next = merge(head, r.back);
      if (same(next, head)) return merge(r.exit, ...t.breaks);
      if (round > 10000) throw new GiveUp();
      head = next;
    }
  };
  const walkStmt = (st: IrStmt, s0: State): State => {
    const s = live(s0);
    switch (st.kind) {
      case "varDecl": {
        // A declaration without an initializer is not a write (`var` hoisting).
        if (!st.init) return s;
        const after = walkExpr(st.init, s);
        return tracked.has(st.localId) ? setDef(after, st.localId, defOf(st, st.localId, st.init)) : after;
      }
      case "assign": {
        const after = walkExpr(st.value, s);
        return tracked.has(st.localId) ? setDef(after, st.localId, defOf(st, st.localId, st.value)) : after;
      }
      case "exprStmt": return walkExpr(st.expr, s);
      case "if": {
        const c = walkExpr(st.cond, s);
        return merge(walkStmts(st.then, c), st.else_ ? walkStmts(st.else_, c) : c);
      }
      case "block": {
        const t: Target = { labels: st.labels ?? [], loop: false, breakable: false, breaks: [], continues: [] };
        targets.push(t);
        let out: State;
        try { out = walkStmts(st.body, s); } finally { targets.pop(); }
        return merge(out, ...t.breaks);
      }
      case "while": return loop(st.labels, s, (head, t) => {
        const c = walkExpr(st.cond, head);
        const b = walkStmts(st.body, c);
        return { exit: c, back: merge(b, ...t.continues) };
      });
      case "doWhile": return loop(st.labels, s, (head, t) => {
        const b = walkStmts(st.body, head);
        const c = walkExpr(st.cond, merge(b, ...t.continues));
        return { exit: c, back: c };
      });
      case "for": {
        const init = st.init ? walkStmt(st.init, s) : s;
        return loop(st.labels, init, (head, t) => {
          const c = st.cond ? walkExpr(st.cond, head) : head;
          const b = walkStmts(st.body, c);
          const cont = merge(b, ...t.continues);
          const u = st.update && cont ? walkStmt(st.update, cont) : cont;
          return { exit: st.cond ? c : null, back: u };
        });
      }
      case "forOf": {
        const it = walkExpr(st.iterable, s);
        return loop(st.labels, it, (head, t) => {
          const b = walkStmts(st.body, head);
          return { exit: head, back: merge(b, ...t.continues) };
        });
      }
      case "switch": {
        let tests = walkExpr(st.disc, s);
        let reach = tests;
        for (const c of st.cases) if (c.test) { tests = walkExpr(c.test, tests); reach = merge(reach, tests); }
        const t: Target = { labels: st.labels ?? [], loop: false, breakable: true, breaks: [], continues: [] };
        targets.push(t);
        let prev: State = null;
        try { for (const c of st.cases) prev = walkStmts(c.body, merge(reach, prev)); } finally { targets.pop(); }
        const hasDefault = st.cases.some((c) => c.test === null);
        return merge(prev, ...t.breaks, hasDefault ? null : reach);
      }
      case "return": if (st.value) walkExpr(st.value, s); return null;
      case "throw": walkExpr(st.value, s); return null;
      case "rethrow": return null;
      case "break": { const t = findTarget(st.label, false); if (t) t.breaks.push(s); else return unknownState(); return null; }
      case "continue": { const t = findTarget(st.label, true); if (t) t.continues.push(s); else return unknownState(); return null; }
      case "tryCatch": {
        const afterTry = walkStmts(st.tryBody, s);
        const tryDefs = allDefsIn(st.tryBody);
        const catchEntry = merge(withDefs(s, tryDefs), afterTry);
        const afterCatch = st.catchBody ? walkStmts(st.catchBody, catchEntry) : null;
        const normal = merge(afterTry, afterCatch);
        if (!st.finallyBody) return normal;
        const catchDefs = allDefsIn(st.catchBody);
        const abrupt = withDefs(withDefs(s, tryDefs), catchDefs);
        const afterFinally = walkStmts(st.finallyBody, merge(normal, abrupt));
        // Normal completion continues only when the try or catch completed normally.
        return normal ? afterFinally : null;
      }
      default:
        return defines(st) ? unordered(st, s) : (recordAll(st, s), s);
    }
  };
  try { walkStmts(fn.body, initial()); } catch (e) { if (e instanceof GiveUp) return 0; throw e; }

  // ── webs ──
  const parent = defs.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  const union = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) parent[x] = y; };
  for (const set of uses.values()) { let first = -1; for (const d of set) { if (first < 0) first = d; else union(first, d); } }
  const webOfUse = (e: IrExpr): number | null => { const set = uses.get(e); if (!set || set.size === 0) return null; return find(set.values().next().value!); };
  const numeric = new Map<number, boolean>();
  for (let i = 0; i < defs.length; i++) numeric.set(find(i), true);
  const numericValue = (v: IrExpr | null): boolean => {
    if (!v) return false;
    switch (v.kind) {
      case "dynFrom": return isNumberExpr(v.value);
      case "libCall":
        if (v.fn === "dyn.increment") return v.args[1]?.kind === "boolLit" && numericValue(v.args[0]!);
        if (v.fn === "dyn.toNumeric") return numericValue(v.args[0]!);
        // Mixing a Number with a BigInt throws, so one Number operand makes
        // the result a Number (`~x` is a bitwise op on its first operand).
        if (v.fn === "dyn.bitwise" || v.fn === "dyn.arithmetic") {
          const op = v.args[2]?.kind === "strLit" ? v.args[2].value : null;
          if (op === null) return false;
          return op === "~" ? numericValue(v.args[0]!) : numericValue(v.args[0]!) || numericValue(v.args[1]!);
        }
        // `+` adds only when both sides are numbers (otherwise it may concatenate).
        if (v.fn === "dyn.add") return numericValue(v.args[0]!) && numericValue(v.args[1]!);
        return false;
      case "varRef": { if (!tracked.has(v.localId)) return false; const w = webOfUse(v); return w !== null && numeric.get(w) === true; }
      case "ternary": return numericValue(v.then) && numericValue(v.else_);
      default: return false;
    }
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < defs.length; i++) {
      const w = find(i);
      if (numeric.get(w) && !numericValue(defs[i]!.value)) { numeric.set(w, false); changed = true; }
    }
  }

  // ── cost: split only webs a number consumer reads ──
  // A read in a numeric web becomes `dynFrom(f64)`, which boxes again where
  // a dyn value is needed. A web is split only when some read feeds a
  // consumer that uses the number directly (comparison, arithmetic, bitwise,
  // ++, a computed key, a checked number, strict equality) or a copy into
  // another split web; a web whose reads all box keeps its dyn local.
  type Consumer = { kind: "numeric" } | { kind: "box" } | { kind: "copy"; def: number };
  const consumers = new Map<IrExpr, Consumer>();
  const NUMERIC_LIBS = new Set(["dyn.compare", "dyn.bitwise", "dyn.arithmetic", "dyn.increment", "dyn.toNumeric"]);
  const KEY_LIBS = new Set(["dyn.keySet", "dyn.keySetComputed", "dyn.reflectGet", "dyn.reflectSet", "dyn.hasKeyComputed", "dyn.hasOwnComputed"]);
  const classify = (child: IrExpr, parent: IrExpr | IrStmt | null, dropped: boolean): Consumer => {
    if (!parent) return { kind: "box" };
    switch (parent.kind) {
      case "libCall":
        if (NUMERIC_LIBS.has(parent.fn)) return { kind: "numeric" };
        if (KEY_LIBS.has(parent.fn) && parent.args[1] === child) return { kind: "numeric" };
        return { kind: "box" };
      case "dynCheck": return parent.type.kind === "f64" ? { kind: "numeric" } : { kind: "box" };
      case "dynScalarEq": return { kind: "numeric" };
      case "dynKeyGet": return parent.key === child ? { kind: "numeric" } : { kind: "box" };
      case "seqExpr": return parent.result === child && dropped ? { kind: "numeric" } : { kind: "box" };
      case "assign": case "varDecl": {
        const def = defIds.get(parent);
        return def !== undefined ? { kind: "copy", def } : { kind: "box" };
      }
      case "assignExpr": {
        const def = defIds.get(parent);
        return def !== undefined ? { kind: "copy", def } : { kind: "box" };
      }
      case "exprStmt": return { kind: "numeric" };
      default: return { kind: "box" };
    }
  };
  {
    const visitExpr = (e: IrExpr, parent: IrExpr | IrStmt | null, dropped: boolean): void => {
      if (e.kind === "varRef" && uses.has(e)) consumers.set(e, classify(e, parent, dropped));
      const seqDropped = e.kind === "seqExpr" && parent?.kind === "exprStmt";
      everyExprChild(e, (c) => { visitExpr(c, e, seqDropped); return true; }, (st) => { visitStmt(st); return true; });
    };
    const visitStmt = (st: IrStmt): void => {
      everyStmtChild(st, (c) => { visitExpr(c, st, false); return true; }, (inner) => { visitStmt(inner); return true; });
    };
    fn.body.forEach(visitStmt);
  }
  const split = new Set<number>();
  for (const [w, isNum] of numeric) if (isNum) split.add(w);
  for (let changed = true; changed;) {
    changed = false;
    for (const w of [...split]) {
      let benefit = false;
      for (const [e, c] of consumers) {
        if (webOfUse(e) !== w) continue;
        if (c.kind === "numeric" || (c.kind === "copy" && split.has(find(c.def)))) { benefit = true; break; }
      }
      if (!benefit) { split.delete(w); changed = true; }
    }
  }

  // ── rewrite ──
  const fresh = new Map<number, string>();
  const localOf = (web: number): string => {
    let id = fresh.get(web);
    if (!id) {
      const base = defs[web]!.local, src = fn.locals.find((l) => l.id === base)!;
      id = `${base}%n${fresh.size}`;
      fresh.set(web, id);
      fn.locals.push({ id, name: src.name, type: F64, mutable: true });
    }
    return id;
  };
  const defLocal = new Map<DefNode, string>(), useLocal = new Map<IrExpr, string>();
  for (const [node, id] of defIds) { const w = find(id); if (split.has(w)) defLocal.set(node, localOf(w)); }
  for (const e of uses.keys()) { const w = webOfUse(e); if (w !== null && split.has(w)) useLocal.set(e, localOf(w)); }
  if (fresh.size === 0) return 0;
  const toF64 = (v: IrExpr): IrExpr => {
    switch (v.kind) {
      case "dynFrom": return v.value;
      // A numeric web left whole holds a number box: the checked cast never fails.
      case "varRef": { const nl = useLocal.get(v); return nl ? { kind: "varRef", localId: nl, type: F64, loc: v.loc } : { kind: "dynCheck", value: v, type: F64, loc: v.loc }; }
      case "ternary": return { ...v, then: toF64(v.then), else_: toF64(v.else_), type: F64 };
      case "libCall":
        if (v.fn === "dyn.toNumeric") return toF64(v.args[0]!);
        if (v.fn === "dyn.increment") return { kind: "bin", op: (v.args[1] as { value: boolean }).value ? "+" : "-", left: toF64(v.args[0]!), right: { kind: "numLit", value: 1, type: F64, loc: v.loc }, type: F64, loc: v.loc };
        // Known to produce a Number: the checked cast never fails.
        if (v.fn === "dyn.bitwise" || v.fn === "dyn.arithmetic" || v.fn === "dyn.add") return { kind: "dynCheck", value: v, type: F64, loc: v.loc };
    }
    throw new Error(`numeric webs: non-numeric definition ${v.kind}`);
  };
  fn.body = transformStmtList(fn.body, {
    stmt: (st) => {
      const nl = defLocal.get(st);
      if (!nl) return st;
      if (st.kind === "assign") return { ...st, localId: nl, value: toF64(st.value) };
      if (st.kind === "varDecl") return { ...st, localId: nl, init: toF64(st.init!) };
      return st;
    },
    expr: (e) => {
      if (e.kind === "varRef") { const nl = useLocal.get(e); return nl ? { kind: "dynFrom", value: { kind: "varRef", localId: nl, type: F64, loc: e.loc }, type: DYN, loc: e.loc } : e; }
      if (e.kind === "assignExpr") { const nl = defLocal.get(e); return nl ? { kind: "dynFrom", value: { ...e, localId: nl, value: toF64(e.value), type: F64 }, type: DYN, loc: e.loc } : e; }
      return e;
    },
  });
  fn.body = fn.body.map(simplifyStmt);
  return fresh.size;
}

class GiveUp extends Error {}

const STMT_KINDS = new Set(["varDecl", "assign", "exprStmt", "if", "while", "doWhile", "switch", "for", "arraySet", "arraySetLength", "arraySetUndefined",
  "arrayDelete", "bytesSet", "forOf", "return", "fieldSet", "recordSet", "recordKeySet", "recordKeyDelete", "break", "continue", "block", "throw",
  "runtimeFence", "rethrow", "tryCatch"]);
function isStmtKind(kind: string): boolean { return STMT_KINDS.has(kind); }

/** Fold the dyn round trips a split leaves: a number read back as a number. */
function simplifyExpr(e: IrExpr): IrExpr {
  const x = mapExprChildren(e, simplifyExpr, simplifyStmt);
  const num = (v: IrExpr | undefined): IrExpr | null => v && v.kind === "dynFrom" && v.value.type.kind === "f64" ? v.value : null;
  if (x.kind === "dynCheck" && x.type.kind === "f64") { const n = num(x.value); if (n) return n; }
  if (x.kind === "libCall") {
    if (x.fn === "dyn.toNumeric") { const n = num(x.args[0]); if (n) return x.args[0]!; }
    if (x.fn === "dyn.increment" && x.args[1]?.kind === "boolLit") {
      const n = num(x.args[0]);
      if (n) return { kind: "dynFrom", value: { kind: "bin", op: x.args[1].value ? "+" : "-", left: n, right: { kind: "numLit", value: 1, type: F64, loc: x.loc }, type: F64, loc: x.loc }, type: DYN, loc: x.loc };
    }
    if (x.fn === "dyn.compare" && x.args[2]?.kind === "strLit") {
      const a = num(x.args[0]), b = num(x.args[1]), op = x.args[2].value;
      if (a && b && (op === "<" || op === "<=" || op === ">" || op === ">=")) return { kind: "bin", op, left: a, right: b, type: BOOL, loc: x.loc };
    }
  }
  return x;
}
function simplifyStmt(s: IrStmt): IrStmt {
  const x = mapStmtChildren(s, simplifyExpr, simplifyStmt);
  // A statement-position sequence drops its result: drop the number unboxed.
  if (x.kind === "exprStmt" && x.expr.kind === "seqExpr" && x.expr.result.kind === "dynFrom" && x.expr.result.value.type.kind === "f64" &&
      (x.expr.result.value.kind === "varRef" || x.expr.result.value.kind === "numLit"))
    return { ...x, expr: { ...x.expr, result: x.expr.result.value, type: F64 } };
  return x;
}
