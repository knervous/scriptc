/** Captured bindings that hold one value for their whole observable life read through plain immutable locals (ported
 * from upstream scriptc 0d7ee4d38b, ir/capture-values.ts; WasmGC fork).
 *
 * A captured binding lives in a shared carrier (a cell, or a field of a scope struct: backend/wasmgc/scope-env.ts):
 * the declaring function and every closure environment that captures it address the same mutable field, so every
 * read is a struct.get Binaryen cannot hoist out of a loop, and the emitter's i32/f32 local typing skips it. When
 * nothing ever writes the binding after its declaration fills it, the carrier is only a carrier: every read observes
 * the declaration's value. This pass keeps the carriers (environments capture exactly as before) and moves the reads
 * onto plain locals:
 *
 * - In the declaring function, `varDecl x = init` becomes `varDecl x' = init; varDecl x = x'`, and every read of `x`
 *   reads `x'` (hoisted function and ordered temporal-dead-zone bindings split at their single `assign` the same
 *   way). An unchanged captured number parameter `p` gets `varDecl p' = p` at entry.
 * - In a closure body, an entry `varDecl c' = c` copies the environment's value once and every read of `c` reads
 *   `c'`, for a capture read inside a loop of the body (or a literal, below); other captures keep their reads at the
 *   use, so a call loads only what its path reads. When every creation site captures a declaration of the same closed numeric constant, `c'` starts from that
 *   literal instead, so the emitter's integer analyses see the constant.
 *
 * Soundness (upstream's rules). A binding qualifies when its carrier is filled exactly once before any environment
 * can observe it and nothing rebinds it in any function that shares it:
 * - the declaration is the binding's only `varDecl` and has an initializer that does not itself create an
 *   environment over it; a TDZ binding (an environment exists before its initializing `assign`) qualifies only when
 *   no code can run any such environment, or read the binding, before that assignment (orderedTdz);
 * - no `assign`, `assignExpr`, `incDec`, `forOf`, catch or rethrow binding targets it, here or in any closure body
 *   reached through capture edges;
 * - local classes keep their carriers (method bodies are not followed).
 * A closure capture qualifies when every creation site supplies such a binding, an unchanged parameter, or a
 * qualifying capture of the creating closure. A closure only runs after its creation, so its entry copy reads the
 * final value; each execution of a declaration (per loop iteration) fills its own fresh carrier, so environments
 * from different iterations keep their own values.
 *
 * Not ported: upstream's direct calls of environment-free function bindings (and AmbientReceiverReaders, which only
 * serves them), and marking stable captures immutable. */
import type { IrExpr, IrFunction, IrLocal, IrModule, IrStmt } from "./ir.js";
import { everyExprChild, everyStmtChild, everyStmtList, mapExprChildren, mapStmtChildren } from "./traverse.js";

export function copyStableCaptures(mod: IrModule): IrModule {
  const flow = new CaptureFlow(mod.functions);
  let changed = false;
  const functions = mod.functions.map((fn) => {
    const next = flow.rewrite(fn);
    if (next !== fn) changed = true;
    return next;
  });
  return changed ? { ...mod, functions } : mod;
}

/** The value of a closed numeric expression over literals (`1024`, `-1`, `4 * 256`), in IEEE double arithmetic. */
function constantNumber(e: IrExpr): number | null {
  if (e.type.kind !== "f64") return null;
  if (e.kind === "numLit") return e.value;
  if (e.kind === "unary" && e.op === "-") {
    const operand = constantNumber(e.operand);
    return operand === null ? null : -operand;
  }
  if (e.kind !== "bin") return null;
  const left = constantNumber(e.left);
  const right = left === null ? null : constantNumber(e.right);
  if (left === null || right === null) return null;
  switch (e.op) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return left / right;
    default: return null;
  }
}

/** Literals worth propagating: special values keep their declaration. */
function plainLiteral(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && !Object.is(value, -0) ? value : null;
}

/** Binding types whose declarations the emitter treats specially: left alone. */
const skippedType = (local: IrLocal): boolean => local.type.kind === "classval" || local.type.kind === "moduleNs";

interface Declaration {
  count: number;
  /** Every occurrence has an initializer that creates no environment over the binding itself. */
  initialized: boolean;
  /** Every occurrence sits directly in a statement list whose scope is the binding's own block: not a `for` head,
   * a switch case or an expression. */
  splittable: boolean;
  /** The single initializer's value, when that is a closed numeric constant. */
  literal: number | null;
}

interface FunctionFacts {
  locals: Map<string, IrLocal>;
  declarations: Map<string, Declaration>;
  /** Rebinding writes per binding: statement and expression assignments, increments, loop, catch and rethrow
   * bindings. */
  writes: Map<string, number>;
  /** Hoisted function bindings: `varDecl f null`, then only further function-binding statements, then this
   * `assign f = closure`. Nothing can run in between, so no environment can observe the empty carrier. */
  hoisted: Map<string, IrStmt>;
  /** TDZ bindings: the statement list holding both the empty `varDecl` and the initializing `assign`. */
  tdzInits: Map<string, { body: readonly IrStmt[]; declared: number; initialized: number }>;
  classCaptured: Set<string>;
  reads: Map<string, number>;
  /** Closure capture edges: the creator's binding flows into capture `index` of `target`, grouped by binding. */
  edges: Map<string, { target: string; index: number }[]>;
  /** The function's own captures (first index of each id), class captures and parameters. */
  captureIndex: Map<string, number>;
  classCaptures: Set<string>;
  params: Set<string>;
}

/** Capture-flow facts over the whole module. Capture chains follow lexical nesting and cannot cycle; provisional
 * memo entries only bound work on malformed input. */
class CaptureFlow {
  private readonly functions = new Map<string, IrFunction>();
  private readonly facts = new Map<string, FunctionFacts>();
  private readonly unchangedMemo = new Map<string, boolean>();
  private readonly stableMemo = new Map<string, boolean>();
  private readonly sites = new Map<string, { owner: string; captures: string[] }[]>();
  private readonly statementIds = new Map<IrStmt, { reads: Map<string, number>; captures: Set<string> }>();

  constructor(functions: readonly IrFunction[]) {
    for (const fn of functions) this.functions.set(fn.name, fn);
    // Creation sites are collected while scanning each body.
    for (const fn of functions) this.factsOf(fn);
  }

  /** The bindings a statement reads (with counts) and captures, at any depth. */
  private idsIn(s: IrStmt): { reads: Map<string, number>; captures: Set<string> } {
    const known = this.statementIds.get(s);
    if (known !== undefined) return known;
    const result = { reads: new Map<string, number>(), captures: new Set<string>() };
    const expr = (e: IrExpr): boolean => {
      if (e.kind === "varRef") result.reads.set(e.localId, (result.reads.get(e.localId) ?? 0) + 1);
      else if (e.kind === "closure" || e.kind === "classRef") for (const id of e.captures ?? []) result.captures.add(id);
      return everyExprChild(e, expr, stmt);
    };
    const stmt = (node: IrStmt): boolean => everyStmtChild(node, expr, stmt);
    stmt(s);
    this.statementIds.set(s, result);
    return result;
  }

  /** Reads of `id` in the statements of `body` after index `after`. */
  private readsAfter(body: readonly IrStmt[], after: number, id: string): number {
    let count = 0;
    for (let k = after + 1; k < body.length; k++) count += this.idsIn(body[k]!).reads.get(id) ?? 0;
    return count;
  }

  /** A TDZ binding no read can reach before its initialization: every environment created before the initializing
   * assignment is the direct value of an unshared local of this function whose every read follows that assignment,
   * and so is every read of the binding itself. Its carrier is then filled before any code can observe it. */
  private orderedTdz(fn: IrFunction, id: string): boolean {
    const facts = this.factsOf(fn);
    const init = facts.tdzInits.get(id);
    if (init === undefined || (facts.writes.get(id) ?? 0) !== 1) return false;
    const { body, declared, initialized } = init;
    if ((facts.reads.get(id) ?? 0) !== this.readsAfter(body, initialized, id)) return false;
    for (let k = declared + 1; k < body.length; k++) {
      const s = body[k]!;
      if (!this.idsIn(s).captures.has(id)) continue;
      if (k > initialized) continue;
      if (k === initialized) return false;
      let holder: string;
      let value: IrExpr | null;
      if (s.kind === "assign") { holder = s.localId; value = s.value; }
      else if (s.kind === "varDecl") { holder = s.localId; value = s.init; }
      else return false;
      if (value?.kind !== "closure") return false;
      const local = facts.locals.get(holder);
      if (local === undefined || local.boxed === true || local.tdz === true) return false;
      const declaration = facts.declarations.get(holder);
      const writes = facts.writes.get(holder) ?? 0;
      if (declaration?.count !== 1 || writes !== (s.kind === "assign" ? 1 : 0)) return false;
      if ((facts.reads.get(holder) ?? 0) !== this.readsAfter(body, initialized, holder)) return false;
    }
    // Every environment over the binding is created in this list.
    let nodes = 0;
    everyStmtList(body.slice(declared + 1), { stmt: () => true, expr: (e) => { if (e.kind === "closure" && e.captures.includes(id)) nodes++; return true; } });
    return nodes === (facts.edges.get(id)?.length ?? 0) && !facts.classCaptured.has(id);
  }

  private factsOf(fn: IrFunction): FunctionFacts {
    const known = this.facts.get(fn.name);
    if (known !== undefined) return known;
    const facts: FunctionFacts = {
      locals: new Map(fn.locals.map((local) => [local.id, local])),
      declarations: new Map(), writes: new Map(), hoisted: new Map(), tdzInits: new Map(),
      classCaptured: new Set(), reads: new Map(), edges: new Map(), captureIndex: new Map(),
      classCaptures: new Set((fn.classCaptures ?? []).map((c) => c.localId)),
      params: new Set(fn.params.map((p) => p.localId)),
    };
    (fn.captures ?? []).forEach((c, index) => { if (!facts.captureIndex.has(c.localId)) facts.captureIndex.set(c.localId, index); });
    this.facts.set(fn.name, facts);
    const capturesIn = (e: IrExpr): Set<string> => {
      const ids = new Set<string>();
      const visitExpr = (node: IrExpr): boolean => {
        if (node.kind === "closure" || node.kind === "classRef") for (const id of node.captures ?? []) ids.add(id);
        return everyExprChild(node, visitExpr, visitStmt);
      };
      const visitStmt = (node: IrStmt): boolean => everyStmtChild(node, visitExpr, visitStmt);
      visitExpr(e);
      return ids;
    };
    // Runs of empty declarations and closure assignments: each empty declaration pairs with the first later
    // assignment of its binding in the same run.
    const findHoisted = (body: readonly IrStmt[]): void => {
      const pending = new Set<string>();
      for (const s of body) {
        if (s.kind === "assign" && s.value.kind === "closure") { if (pending.delete(s.localId)) facts.hoisted.set(s.localId, s); }
        else if (s.kind === "varDecl" && s.init === null) pending.add(s.localId);
        else pending.clear();
      }
    };
    const findTdzInits = (body: readonly IrStmt[]): void => {
      const empty = new Map<string, number>();
      body.forEach((s, j) => {
        if (s.kind === "varDecl" && s.init === null && !empty.has(s.localId)) empty.set(s.localId, j);
        if (s.kind !== "assign" || s.initializes !== true) return;
        const declared = empty.get(s.localId);
        if (declared !== undefined && declared < j) facts.tdzInits.set(s.localId, { body, declared, initialized: j });
      });
    };
    const declare = (s: IrStmt & { kind: "varDecl" }, splittable: boolean): void => {
      const entry = facts.declarations.get(s.localId);
      if (entry === undefined)
        facts.declarations.set(s.localId, {
          count: 1,
          initialized: s.init !== null && !capturesIn(s.init).has(s.localId),
          splittable,
          literal: s.init === null ? null : plainLiteral(constantNumber(s.init)),
        });
      else { entry.count++; entry.initialized = false; entry.splittable = false; entry.literal = null; }
    };
    const write = (id: string): void => { facts.writes.set(id, (facts.writes.get(id) ?? 0) + 1); };
    const expr = (e: IrExpr): boolean => {
      switch (e.kind) {
        case "varRef": facts.reads.set(e.localId, (facts.reads.get(e.localId) ?? 0) + 1); break;
        case "assignExpr": case "incDec": write(e.localId); break;
        case "closure": {
          let list = this.sites.get(e.fnName);
          if (list === undefined) this.sites.set(e.fnName, (list = []));
          list.push({ owner: fn.name, captures: e.captures });
          e.captures.forEach((source, index) => {
            let edges = facts.edges.get(source);
            if (edges === undefined) facts.edges.set(source, (edges = []));
            edges.push({ target: e.fnName, index });
          });
          break;
        }
        case "classRef": for (const id of e.captures ?? []) facts.classCaptured.add(id); break;
      }
      return everyExprChild(e, expr, nested);
    };
    // Only statement lists reached through ordinary nesting from the body are split (rewrite() mirrors this): switch
    // cases share one scope across dispatch targets, `for` heads are freshened per iteration, and statement lists
    // inside expressions are not expanded.
    const list = (body: readonly IrStmt[], split: boolean): boolean => {
      if (split) { findHoisted(body); findTdzInits(body); }
      return body.every((s) => stmt(s, split));
    };
    const stmt = (s: IrStmt, split: boolean): boolean => {
      switch (s.kind) {
        case "varDecl": declare(s, split); return s.init === null || expr(s.init);
        case "assign": case "rethrow": write(s.localId); break;
        case "forOf": write(s.localId); return expr(s.iterable) && list(s.body, split);
        case "tryCatch":
          if (s.catchLocalId !== null) write(s.catchLocalId);
          return list(s.tryBody, split) && (s.catchBody === null || list(s.catchBody, split)) && (s.finallyBody === null || list(s.finallyBody, split));
        case "block": return list(s.body, split);
        case "if": return expr(s.cond) && list(s.then, split) && (s.else_ === null || list(s.else_, split));
        case "while": return expr(s.cond) && list(s.body, split);
        case "doWhile": return list(s.body, split) && expr(s.cond);
        case "for":
          return (s.init === null || stmt(s.init, false)) && (s.cond === null || expr(s.cond)) && (s.update === null || stmt(s.update, false)) && list(s.body, split);
      }
      return everyStmtChild(s, expr, nested);
    };
    const nested = (s: IrStmt): boolean => stmt(s, false);
    list(fn.body, true);
    return facts;
  }

  /** Nothing rebinds `id` in `fnName` (declarations aside, and `ownWrites` writes of its own body) or in any body
   * that shares its carrier through closure captures. */
  private unchanged(fnName: string, id: string, ownWrites = 0): boolean {
    const key = `${fnName}\0${id}\0${ownWrites}`;
    const known = this.unchangedMemo.get(key);
    if (known !== undefined) return known;
    this.unchangedMemo.set(key, false);
    const fn = this.functions.get(fnName);
    let result = false;
    if (fn !== undefined) {
      const facts = this.factsOf(fn);
      result = (facts.writes.get(id) ?? 0) === ownWrites && !facts.classCaptured.has(id) &&
        (facts.edges.get(id) ?? []).every((edge) => {
          const capture = this.functions.get(edge.target)?.captures?.[edge.index];
          return capture !== undefined && this.unchanged(edge.target, capture.localId);
        });
    }
    this.unchangedMemo.set(key, result);
    return result;
  }

  /** A boxed binding of `fn` itself (not a capture) whose carrier is filled once, before any environment observes
   * it, and never written again. */
  private stableOrigin(fn: IrFunction, id: string): boolean {
    const facts = this.factsOf(fn);
    const local = facts.locals.get(id);
    if (local?.boxed !== true || skippedType(local)) return false;
    if (facts.captureIndex.has(id) || facts.classCaptures.has(id)) return false;
    const declaration = facts.declarations.get(id);
    if (local.tdz === true) return declaration?.count === 1 && this.orderedTdz(fn, id) && this.unchanged(fn.name, id, 1);
    if (facts.params.has(id)) return declaration === undefined && this.unchanged(fn.name, id);
    if (declaration?.count !== 1) return false;
    if (declaration.initialized) return this.unchanged(fn.name, id);
    return facts.hoisted.has(id) && this.unchanged(fn.name, id, 1);
  }

  /** A closure capture holding one value for the environment's life. */
  private stableCapture(fnName: string, id: string): boolean {
    const key = `${fnName}\0${id}`;
    const known = this.stableMemo.get(key);
    if (known !== undefined) return known;
    this.stableMemo.set(key, false);
    const result = this.computeStableCapture(fnName, id);
    this.stableMemo.set(key, result);
    return result;
  }

  private computeStableCapture(fnName: string, id: string): boolean {
    const fn = this.functions.get(fnName);
    const index = fn === undefined ? undefined : this.factsOf(fn).captureIndex.get(id);
    if (fn === undefined || index === undefined) return false;
    const sites = this.sites.get(fnName);
    if (sites === undefined || sites.length === 0) return false;
    for (const site of sites) {
      const owner = this.functions.get(site.owner);
      const source = site.captures[index];
      if (owner === undefined || source === undefined) return false;
      if (!this.stableOrigin(owner, source) && !this.stableCapture(site.owner, source)) return false;
    }
    return this.unchanged(fnName, id);
  }

  /** The numeric constant every execution binds to `id`, if any. */
  private literal(fnName: string, id: string, depth = 0): number | null {
    const fn = this.functions.get(fnName);
    if (fn === undefined || depth > 64) return null;
    const facts = this.factsOf(fn);
    const own = facts.declarations.get(id);
    if (own !== undefined) {
      if (!this.stableOrigin(fn, id)) return null;
      const init = facts.tdzInits.get(id);
      const assign = init?.body[init.initialized];
      return assign?.kind === "assign" ? plainLiteral(constantNumber(assign.value)) : own.literal;
    }
    const index = facts.captureIndex.get(id) ?? -1;
    if (index < 0 || !this.stableCapture(fnName, id)) return null;
    let value: number | null = null;
    for (const site of this.sites.get(fnName) ?? []) {
      const source = site.captures[index];
      const next = source === undefined ? null : this.literal(site.owner, source, depth + 1);
      if (next === null || (value !== null && !Object.is(value, next))) return null;
      value = next;
    }
    return value;
  }

  rewrite(fn: IrFunction): IrFunction {
    const facts = this.factsOf(fn);
    const reads = new Map<string, string>();
    const splits = new Map<string, string>();
    const entry: IrStmt[] = [];
    const locals: IrLocal[] = [];
    let used: Set<string> | null = null;
    let loopReads: Set<string> | null = null;
    const fresh = (local: IrLocal): IrLocal => {
      used ??= new Set([...fn.locals.map((l) => l.id), ...fn.params.map((p) => p.localId)]);
      let k = 0;
      while (used.has(`${local.id}%cv${k}`)) k++;
      const id = `${local.id}%cv${k}`;
      used.add(id);
      const copy: IrLocal = { id, name: local.name, type: local.type, mutable: false };
      if (local.source !== undefined) copy.source = local.source;
      locals.push(copy);
      return copy;
    };
    for (const local of fn.locals) {
      if (local.boxed !== true || skippedType(local) || !facts.reads.has(local.id)) continue;
      if (facts.captureIndex.has(local.id)) {
        if (!this.stableCapture(fn.name, local.id)) continue;
        const literal = local.type.kind === "f64" ? this.literal(fn.name, local.id) : null;
        // The entry copy loads the environment's value on every call, whatever path the call takes. It pays off where a
        // read repeats (inside a loop, where Binaryen cannot hoist the carrier read) or where the value is a literal (no
        // load at all, and the integer analyses see it). Elsewhere each read stays one carrier read at its use, so a call
        // that never takes the path reading the capture never loads it (a per-frame closure's early-out fast path).
        if (literal === null && !(loopReads ??= loopReadIds(fn.body)).has(local.id)) continue;
        const copy = fresh(local);
        const init: IrExpr = literal !== null
          ? { kind: "numLit", value: literal, type: local.type, loc: fn.loc }
          : { kind: "varRef", localId: local.id, type: local.type, loc: fn.loc };
        entry.push({ kind: "varDecl", localId: copy.id, init, loc: fn.loc });
        reads.set(local.id, copy.id);
      } else if (facts.params.has(local.id)) {
        // A copy only exposes numbers to the emitter's integer analyses.
        if (local.type.kind !== "f64" || !this.stableOrigin(fn, local.id)) continue;
        const copy = fresh(local);
        entry.push({ kind: "varDecl", localId: copy.id, init: { kind: "varRef", localId: local.id, type: local.type, loc: fn.loc }, loc: fn.loc });
        reads.set(local.id, copy.id);
      } else {
        if (!this.stableOrigin(fn, local.id)) continue;
        const declaration = facts.declarations.get(local.id)!;
        // Hoisted function and TDZ bindings split at their assignment, which is only recorded in expandable lists.
        if (declaration.initialized ? !declaration.splittable : !facts.hoisted.has(local.id) && !facts.tdzInits.has(local.id)) continue;
        const copy = fresh(local);
        splits.set(local.id, copy.id);
        reads.set(local.id, copy.id);
      }
    }
    if (reads.size === 0) return fn;
    const localsById = new Map(fn.locals.map((l) => [l.id, l]));
    const expr = (e: IrExpr): IrExpr => {
      if (e.kind === "varRef") {
        const to = reads.get(e.localId);
        return to === undefined ? e : { ...e, localId: to };
      }
      return mapExprChildren(e, expr, single);
    };
    const single = (s: IrStmt): IrStmt => mapStmtChildren(s, expr, single);
    const list = (body: readonly IrStmt[]): IrStmt[] => body.flatMap(many);
    const many = (s: IrStmt): IrStmt[] => {
      switch (s.kind) {
        case "varDecl": {
          const to = splits.get(s.localId);
          if (to === undefined || s.init === null) break;
          const local = localsById.get(s.localId)!;
          return [
            { ...s, localId: to, init: expr(s.init) },
            { kind: "varDecl", localId: s.localId, init: { kind: "varRef", localId: to, type: local.type, loc: s.loc }, loc: s.loc },
          ];
        }
        case "assign": {
          const to = splits.get(s.localId);
          const init = facts.tdzInits.get(s.localId);
          const splitHere = facts.hoisted.get(s.localId) === s || init?.body[init.initialized] === s;
          if (to === undefined || !splitHere) break;
          const local = localsById.get(s.localId)!;
          return [
            { kind: "varDecl", localId: to, init: expr(s.value), loc: s.loc },
            { ...s, value: { kind: "varRef", localId: to, type: local.type, loc: s.loc } },
          ];
        }
        case "block": return [{ ...s, body: list(s.body) }];
        case "if": return [{ ...s, cond: expr(s.cond), then: list(s.then), else_: s.else_ === null ? null : list(s.else_) }];
        case "while": return [{ ...s, cond: expr(s.cond), body: list(s.body) }];
        case "doWhile": return [{ ...s, body: list(s.body), cond: expr(s.cond) }];
        case "for":
          return [{ ...s, init: s.init === null ? null : single(s.init), cond: s.cond === null ? null : expr(s.cond), update: s.update === null ? null : single(s.update), body: list(s.body) }];
        case "forOf": return [{ ...s, iterable: expr(s.iterable), body: list(s.body) }];
        case "tryCatch":
          return [{ ...s, tryBody: list(s.tryBody), catchBody: s.catchBody === null ? null : list(s.catchBody), finallyBody: s.finallyBody === null ? null : list(s.finallyBody) }];
      }
      return [single(s)];
    };
    return { ...fn, locals: [...fn.locals, ...locals], body: [...entry, ...list(fn.body)] };
  }
}

/** The locals read inside a loop of `body`: in a loop's condition, update or body, or (conservatively) its init or
 * iterable. Closure bodies are their own functions and are not followed. */
function loopReadIds(body: readonly IrStmt[]): Set<string> {
  const out = new Set<string>();
  const visitExpr = (e: IrExpr, inLoop: boolean): boolean => {
    if (inLoop && e.kind === "varRef") out.add(e.localId);
    return everyExprChild(e, (x) => visitExpr(x, inLoop), (t) => visitStmt(t, inLoop));
  };
  const visitStmt = (s: IrStmt, inLoop: boolean): boolean => {
    const loop = inLoop || s.kind === "while" || s.kind === "doWhile" || s.kind === "for" || s.kind === "forOf";
    return everyStmtChild(s, (x) => visitExpr(x, loop), (t) => visitStmt(t, loop));
  };
  for (const s of body) visitStmt(s, false);
  return out;
}
