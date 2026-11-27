import {
  BOOL,
  F64,
  isUnitType,
  type IrExpr,
  type IrFunction,
  type IrLocal,
  type IrModule,
  type IrStmt,
  type IrType,
  type IrUnionDef,
} from "./ir.js";
import { copyWithFreshLocals } from "./fresh-locals.js";
import {
  everyStmtList,
  mapExprChildren,
  mapStmtChildren,
  transformStmt,
  type IrTransform,
} from "./traverse.js";

/** Union arm loops.
 *
 * A loop that indexes a union of typed-array classes dispatches every
 * element: `xs[i]` lowers to a tag test per element and a payload
 * extraction per element, so the loop keeps a bounds branch and a tag branch
 * and cannot vectorize. The bound proof and the loop versions want a
 * `varRef` of the arm's own type as the receiver, which a narrowed union arm
 * is not.
 *
 * This pass binds the arm once, before the loop: the loop is copied per arm
 * behind one tag test, each copy reached through a local bound to the
 * narrowed arm, and inside a copy the dispatch on that same value is folded
 * away — its tag tests become constants and the narrowed reads become reads
 * of the bound local. The bound proofs then see `b.length` and `b[i]`, the
 * loop takes one integer counter with no per-element check, and the tag chain
 * runs once per arm per entry instead of once per element.
 *
 * A loop qualifies when:
 * - it narrows a union of at least two payload-carrying arms (no unit arm:
 *   `unionNarrow` has no payload to bind there);
 * - it indexes an element through a narrowed arm of a plain local (`varRef`)
 *   of the union's type, which is the value it is versioned for: a loop that
 *   narrows several values takes the one it narrows most, and a loop that only
 *   narrows (a `typeof` probe, say) is left alone;
 * - that local is never assigned in the function and not declared inside the
 *   loop, so the tag it holds cannot change while the loop runs (a boxed or
 *   TDZ local is excluded: its writes happen elsewhere);
 * - the copies stay small (the arm count times the loop's node count is under
 *   MAX_VERSION_COST, and one function's versions together stay under
 *   MAX_FUNCTION_COST). A larger loop keeps today's per-element dispatch.
 *
 * Fork (WasmGC backend only; the native backend does not run this pass, so its
 * output is unchanged). Deviations from upstream:
 * - This frontend lowers a union element read and `.length` to a call of the
 *   union's `%arraylike.get.N(u, i)` / `%arraylike.length.N(u)` helper rather
 *   than an inline dispatch. Such a call on the source counts as an indexed
 *   narrowed read, and in a typed-array arm's copy it becomes the arm's own
 *   `bytesIntrinsic` get/length on the bound local (other arms keep the call).
 * - An element store narrows a hidden copy of the receiver (`%storeReceiver.N`,
 *   declared from the source and never written): a never-written local
 *   initialized from the source is the source (an alias), on either side.
 * - Function entry: a never-reassigned union parameter the body indexes
 *   (MIN_ENTRY_READS narrowed reads or more) versions the whole body the same
 *   way, under the same budgets. A matrix helper (`m[k] + m[k + 1] + ...` over a
 *   `Float32Array | Float64Array`) holds no loop, and its reads run once per
 *   call rather than once per element.
 * - A region holding a closure or class value, a try statement, or a yield or await is never copied: this backend
 *   keys capture carriers, scope groups and suspension frames by their declarations and sites.
 * - Each copy holds the locals the copied region declares (and nothing outside it reads) under fresh ids
 *   (fresh-locals.ts): the backend types a local from all its writes, and a later bounds version
 *   (typed-array-bounds.ts) can then type an arm's index temporaries as i32.
 * - No node index (the fork has none): every function is scanned. */
const ARRAYLIKE_GET = "%arraylike.get.";
const ARRAYLIKE_LENGTH = "%arraylike.length.";

/** The nodes the copies of one versioned loop may hold, all arms together. */
const MAX_VERSION_COST = 480;

/** The nodes one function's versions may add together: nested loops over
 * different unions multiply, and their copies must not grow without bound. */
const MAX_FUNCTION_COST = 2000;

/** The most arms one loop is versioned for. */
const MAX_ARMS = 4;

/** Fork: the fewest narrowed reads of the parameters that version a whole function body. */
const MIN_ENTRY_READS = 2;

/** Fork: the nodes the copies of one versioned function body may hold, all copies together. */
const MAX_ENTRY_COST = 1600;

type LoopStmt = IrStmt & { kind: "for" | "while" | "doWhile" };

export function versionUnionArmLoops(mod: IrModule): IrModule {
  if ((mod.unions?.length ?? 0) === 0) return mod;
  const unions = new Map((mod.unions ?? []).map((u) => [u.id, u]));
  let changed = false;
  const functions = mod.functions.map((fn) => {
    const next = rewriteFunction(fn, unions);
    if (next !== fn) changed = true;
    return next;
  });
  return changed ? { ...mod, functions } : mod;
}

/** The locals a function writes (not declares) and the narrows it holds. */
interface Facts {
  written: Set<string>;
  narrows: number;
  /** Fork: never-written locals declared once from another local (`%storeReceiver.N = xs`), by alias. */
  aliases: Map<string, string>;
}

function functionFacts(fn: IrFunction): Facts {
  const written = new Set<string>();
  const declared = new Map<string, number>();
  const copies = new Map<string, string>();
  let narrows = 0;
  everyStmtList(fn.body, {
    expr: (e) => {
      if (e.kind === "unionNarrow" || isArrayLikeCall(e)) narrows++;
      else if (e.kind === "assignExpr" || e.kind === "incDec") written.add(e.localId);
      return true;
    },
    stmt: (s) => {
      if (s.kind === "assign" || s.kind === "forOf" || s.kind === "rethrow") written.add(s.localId);
      else if (s.kind === "tryCatch" && s.catchLocalId !== null) written.add(s.catchLocalId);
      else if (s.kind === "varDecl") {
        declared.set(s.localId, (declared.get(s.localId) ?? 0) + 1);
        if (s.init?.kind === "varRef") copies.set(s.localId, s.init.localId);
      }
      return true;
    },
  });
  const locals = new Map(fn.locals.map((l) => [l.id, l]));
  const aliases = new Map<string, string>();
  for (const [id, from] of copies) {
    const local = locals.get(id);
    if (declared.get(id) !== 1 || written.has(id) || local === undefined || local.boxed === true || local.tdz === true) continue;
    aliases.set(id, from);
  }
  return { written, narrows, aliases };
}

/** Fork: a call of a union's array-like read helper (`%arraylike.get.N(u, i)`, `%arraylike.length.N(u)`). */
function isArrayLikeCall(e: IrExpr): e is IrExpr & { kind: "call" } {
  return e.kind === "call" && (e.callee.startsWith(ARRAYLIKE_GET) || e.callee.startsWith(ARRAYLIKE_LENGTH)) && e.args[0]?.type.kind === "union";
}

function isLoop(s: IrStmt): s is LoopStmt {
  return s.kind === "for" || s.kind === "while" || s.kind === "doWhile";
}

/** One narrowing dispatch on the loop's source value. */
interface Source {
  id: string;
  unionId: string;
  /** Narrowed reads of this value in the loop. */
  count: number;
  /** The loop indexes an element through a narrowed arm of this value. */
  indexed: boolean;
}

/** The receiver of an element access, when `e` is one. */
function elementReceiver(e: IrExpr | IrStmt): IrExpr | null {
  switch (e.kind) {
    case "bytesIntrinsic":
      return e.method === "get" ? e.receiver : null;
    case "arrIntrinsic":
      return e.receiver;
    case "bytesSet":
    case "arrayGet":
    case "arraySet":
    case "arrayHas":
    case "arrayState":
      return e.arr;
    default:
      return null;
  }
}

/** The values the statements narrow, by their alias roots. */
function regionSources(region: IrStmt[], aliases: ReadonlyMap<string, string>): Source[] {
  const sources = new Map<string, Source>();
  const source = (id: string, unionId: string): Source => {
    const root = rootOf(id, aliases);
    let entry = sources.get(root);
    if (entry === undefined) sources.set(root, (entry = { id: root, unionId, count: 0, indexed: false }));
    else if (entry.unionId !== unionId) entry.count = -1;
    return entry;
  };
  const access = (e: IrExpr | IrStmt): void => {
    const receiver = elementReceiver(e);
    if (receiver === null || receiver.kind !== "unionNarrow" || receiver.value.kind !== "varRef")
      return;
    source(receiver.value.localId, receiver.unionId).indexed = true;
  };
  everyStmtList(region, {
    expr: (e) => {
      access(e);
      if (e.kind === "unionNarrow" && e.value.kind === "varRef")
        source(e.value.localId, e.unionId).count++;
      // Fork: a helper read is an indexed narrowed read of its receiver.
      else if (isArrayLikeCall(e) && e.args[0]!.kind === "varRef" && e.args[0]!.type.kind === "union") {
        const entry = source(e.args[0]!.localId, e.args[0]!.type.unionId);
        if (entry.count >= 0) entry.count++;
        entry.indexed = true;
      }
      return true;
    },
    stmt: (s) => {
      access(s);
      return true;
    },
  });
  return [...sources.values()];
}

/** The source value whose arms the statements index, or null when they index
 * none: the pass exists for element access per arm, and versioning a loop
 * that only narrows (string/number probes, say) would duplicate code with
 * nothing to gain. */
function regionSource(region: IrStmt[], aliases: ReadonlyMap<string, string>): Source | null {
  let best: Source | null = null;
  for (const entry of regionSources(region, aliases))
    if (entry.count > 0 && entry.indexed && (best === null || entry.count > best.count))
      best = entry;
  return best;
}

function rootOf(id: string, aliases: ReadonlyMap<string, string>): string {
  let root = id;
  for (let hops = 0; hops < 8 && aliases.has(root); hops++) root = aliases.get(root)!;
  return root;
}

/** The locals the loop declares, which may not be bound before it. */
function loopDeclarations(loop: IrStmt[]): Set<string> {
  const declared = new Set<string>();
  everyStmtList(loop, {
    expr: () => true,
    stmt: (s) => {
      if (s.kind === "varDecl") declared.add(s.localId);
      return true;
    },
  });
  return declared;
}

/** Fork: whether the backend takes a copy of the region as it is (see the header). */
function copyable(region: IrStmt[]): boolean {
  return everyStmtList(region, {
    expr: (e) => e.kind !== "closure" && e.kind !== "classRef" && e.kind !== "yieldExpr" && e.kind !== "awaitExpr" && e.kind !== "awaitUnionExpr",
    stmt: (s) => s.kind !== "tryCatch",
  });
}

function nodeCount(region: IrStmt[]): number {
  let count = 0;
  everyStmtList(region, {
    expr: () => {
      count++;
      return true;
    },
    stmt: () => {
      count++;
      return true;
    },
  });
  return count;
}

interface Context {
  unions: ReadonlyMap<string, IrUnionDef>;
  locals: ReadonlyMap<string, IrLocal>;
  written: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  used: Set<string>;
  added: IrLocal[];
  sequence: number;
  /** The nodes this function's versions may still add (MAX_FUNCTION_COST). */
  budget: number;
  /** Fork: the function body the copies come from (fresh-locals.ts). */
  body: readonly IrStmt[];
  /** Rewrites one statement, versioning the loops in it that are not
   * versioned yet (the copies of a versioned loop hold their own nested
   * loops, which a different arm may index). */
  rewrite: (s: IrStmt) => IrStmt;
}

function rewriteFunction(fn: IrFunction, unions: ReadonlyMap<string, IrUnionDef>): IrFunction {
  const facts = functionFacts(fn);
  if (facts.narrows === 0) return fn;
  let changed = false;
  const context: Context = {
    unions,
    locals: new Map(fn.locals.map((l) => [l.id, l])),
    written: facts.written,
    aliases: facts.aliases,
    used: new Set(fn.locals.map((l) => l.id)),
    added: [],
    sequence: 0,
    budget: MAX_FUNCTION_COST,
    body: fn.body,
    rewrite: (s) => rewrite(s),
  };
  const rewrite = (s: IrStmt): IrStmt => {
    if (isLoop(s)) {
      const versioned = versionLoop(s, context);
      if (versioned !== null) {
        changed = true;
        return versioned;
      }
    }
    return mapStmtChildren(s, identityExpr, rewrite);
  };
  // Fork: a whole body over the never-reassigned union parameters it indexes.
  const entry = fn.async || fn.generator ? null : versionEntry(fn, context);
  if (entry !== null) return { ...fn, body: [entry], locals: [...fn.locals, ...context.added] };
  const body = fn.body.map(rewrite);
  if (!changed) return fn;
  return { ...fn, body, locals: [...fn.locals, ...context.added] };
}

function identityExpr(e: IrExpr): IrExpr {
  return e;
}

/** The loop behind one tag test per arm, or null when it does not qualify. */
function versionLoop(loop: LoopStmt, context: Context): IrStmt | null {
  const region = [loop];
  const source = regionSource(region, context.aliases);
  if (source === null) return null;
  const local = context.locals.get(source.id);
  if (local === undefined || local.boxed === true || local.tdz === true) return null;
  if (context.written.has(source.id)) return null;
  if (local.type.kind !== "union" || local.type.unionId !== source.unionId) return null;
  const union = context.unions.get(source.unionId);
  if (union === undefined) return null;
  const arms = union.arms;
  if (arms.length < 2 || arms.length > MAX_ARMS) return null;
  if (!arms.some((arm) => arm.kind === "bytes")) return null;
  for (const arm of arms) if (isUnitType(arm)) return null;
  if (loopDeclarations(region).has(source.id)) return null;
  const copies = nodeCount(region) * arms.length;
  if (copies > MAX_VERSION_COST || copies > context.budget) return null;
  if (!copyable(region)) return null;
  // Nested loops in the copies draw on the same budget as they are versioned.
  context.budget -= copies;

  const loc = region[0]!.loc;
  const bindingType = local.type;
  const sourceRef = (): IrExpr => ({ kind: "varRef", localId: source.id, type: bindingType, loc });
  const declarations: IrStmt[] = [];
  const bodies: IrStmt[][] = [];
  for (let tag = 0; tag < arms.length; tag++) {
    const arm = arms[tag]!;
    const id = freshId(`${local.name}.arm`, context);
    context.added.push({ id, name: local.name, type: arm, mutable: false });
    declarations.push({
      kind: "varDecl",
      localId: id,
      init: {
        kind: "unionNarrow",
        unionId: union.id,
        tag,
        value: sourceRef(),
        type: arm,
        loc,
      },
      loc,
    });
    // Fork: each copy holds the loop's own temporaries in locals of its own (fresh-locals.ts).
    const { copy, added, renames } = copyWithFreshLocals(context.body, region, context.locals, context.used, `$arm${tag}`);
    context.added.push(...added);
    const aliases = renamedAliases(context.aliases, renames);
    // The copy's own dispatch on the bound value is folded away, so its
    // nested loops can only qualify on another value.
    const specialized = specialize(copy, union.id, source.id, tag, id, arm, aliases).map((s) =>
      mapStmtChildren(s, identityExpr, context.rewrite),
    );
    bodies.push(specialized);
  }

  // The last arm needs no test: the preceding tests rule out every other tag
  // and the bound narrow verifies the arm it binds (the backend's narrow casts).
  let chain: IrStmt[] = [declarations[arms.length - 1]!, ...bodies[arms.length - 1]!];
  for (let tag = arms.length - 2; tag >= 0; tag--)
    chain = [
      {
        kind: "if",
        cond: {
          kind: "unionIsTag",
          unionId: union.id,
          tag,
          negated: false,
          value: sourceRef(),
          type: BOOL,
          loc,
        },
        then: [declarations[tag]!, ...bodies[tag]!],
        else_: chain,
        loc,
      },
    ];
  const first: IrStmt | undefined = chain[0];
  return first ?? null;
}

/** Fork: the function body versioned for its never-reassigned parameters of one union of typed arrays, or null.
 * One parameter: a copy per arm behind its tag tests, as a loop is. Several parameters of the same union (a
 * matrix product's `a`, `b` and `out`): a copy per arm in which every one of them is that arm, behind the tests
 * that they all are, then the body as it is for any mixture (arms + 1 copies, not arms ** parameters). */
function versionEntry(fn: IrFunction, context: Context): IrStmt | null {
  const region = fn.body;
  if (region.length === 0) return null;
  const params = new Set(fn.params.map((p) => p.localId));
  const best = regionSource(region, context.aliases);
  if (best === null) return null;
  const union = context.unions.get(best.unionId);
  if (union === undefined) return null;
  const arms = union.arms;
  if (arms.length < 2 || arms.length > MAX_ARMS) return null;
  if (!arms.some((arm) => arm.kind === "bytes")) return null;
  for (const arm of arms) if (isUnitType(arm)) return null;
  const sources = regionSources(region, context.aliases).filter((source) => {
    const local = context.locals.get(source.id);
    return source.unionId === union.id && source.indexed && source.count > 0 && params.has(source.id) && local !== undefined &&
      local.boxed !== true && local.tdz !== true && !context.written.has(source.id) && local.type.kind === "union" && local.type.unionId === union.id;
  });
  if (sources.length === 0 || sources.reduce((n, source) => n + source.count, 0) < MIN_ENTRY_READS) return null;
  const mixed = sources.length > 1;
  const copies = nodeCount(region) * (arms.length + (mixed ? 1 : 0));
  if (copies > MAX_ENTRY_COST || copies > context.budget) return null;
  if (!copyable(region)) return null;
  context.budget -= copies;

  const loc = region[0]!.loc;
  const ref = (id: string): IrExpr => ({ kind: "varRef", localId: id, type: context.locals.get(id)!.type, loc });
  const isTag = (id: string, tag: number): IrExpr => ({ kind: "unionIsTag", unionId: union.id, tag, negated: false, value: ref(id), type: BOOL, loc });
  const arm = (tag: number): IrStmt[] => {
    const declarations: IrStmt[] = [];
    const fresh = copyWithFreshLocals(context.body, region, context.locals, context.used, `$arm${tag}`);
    context.added.push(...fresh.added);
    const aliases = renamedAliases(context.aliases, fresh.renames);
    let copy = fresh.copy;
    for (const source of sources) {
      const local = context.locals.get(source.id)!, id = freshId(`${local.name}.arm`, context);
      context.added.push({ id, name: local.name, type: arms[tag]!, mutable: false });
      declarations.push({ kind: "varDecl", localId: id, init: { kind: "unionNarrow", unionId: union.id, tag, value: ref(source.id), type: arms[tag]!, loc }, loc });
      copy = specialize(copy, union.id, source.id, tag, id, arms[tag]!, aliases);
    }
    return [...declarations, ...copy.map((s) => mapStmtChildren(s, identityExpr, context.rewrite))];
  };
  // The body as it is (per-read dispatch) when the parameters hold different arms; else the last arm, whose
  // tests the others rule out (each bound narrow verifies the arm it binds).
  let chain: IrStmt[] = mixed ? region.map((s) => context.rewrite(transformStmt(s, clone))) : arm(arms.length - 1);
  for (let tag = (mixed ? arms.length : arms.length - 1) - 1; tag >= 0; tag--) {
    const cond = sources.map((source) => isTag(source.id, tag)).reduce((all, test): IrExpr => ({ kind: "logical", op: "&&", left: all, right: test, type: BOOL, loc }));
    chain = [{ kind: "if", cond, then: arm(tag), else_: chain, loc }];
  }
  return { kind: "block", body: chain, loc };
}

/** Fork: the alias map of a copy whose locals `renames` renamed (fresh-locals.ts): a renamed alias, to its target as
 * the copy names it. */
function renamedAliases(aliases: ReadonlyMap<string, string>, renames: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  if (renames.size === 0) return aliases;
  const out = new Map(aliases);
  for (const [from, to] of renames) {
    const target = aliases.get(from);
    if (target !== undefined) out.set(to, renames.get(target) ?? target);
  }
  return out;
}

/** A fresh local id for a binding of `base`, unique in the function. */
function freshId(base: string, context: Context): string {
  let id = `${base}${context.sequence++}`;
  while (context.used.has(id)) id = `${base}${context.sequence++}`;
  context.used.add(id);
  return id;
}

/** Every node of a copied subtree as a distinct object: the backend keys
 * facts by node identity, and the copies must not share them. */
const clone: IrTransform = { expr: (e) => ({ ...e }), stmt: (s) => ({ ...s }) };

/** The copy of one arm: its dispatch on the bound value folded away. */
function specialize(
  stmts: IrStmt[],
  unionId: string,
  sourceId: string,
  tag: number,
  bindingId: string,
  arm: IrType,
  aliases: ReadonlyMap<string, string>,
): IrStmt[] {
  const isSource = (e: IrExpr): boolean => e.kind === "varRef" && rootOf(e.localId, aliases) === sourceId;
  const binding = (loc: IrExpr["loc"]): IrExpr => ({ kind: "varRef", localId: bindingId, type: arm, loc });
  const expr = (e: IrExpr): IrExpr => {
    const next = mapExprChildren(e, expr, stmt);
    if (next.kind === "unionNarrow") {
      if (next.unionId === unionId && next.tag === tag && isSource(next.value))
        return { kind: "varRef", localId: bindingId, type: next.type, loc: next.loc };
      return next;
    }
    if (next.kind === "unionIsTag" && next.unionId === unionId && isSource(next.value)) {
      const equal = next.tag === tag;
      return { kind: "boolLit", value: next.negated ? !equal : equal, type: BOOL, loc: next.loc };
    }
    // Fork: the helper read on a typed-array arm is that arm's own read.
    if (arm.kind === "bytes" && isArrayLikeCall(next) && next.args[0]!.type.kind === "union" && next.args[0]!.type.unionId === unionId && isSource(next.args[0]!)) {
      if (next.callee.startsWith(ARRAYLIKE_GET) && next.args.length === 2)
        return { kind: "bytesIntrinsic", method: "get", receiver: binding(next.loc), args: [next.args[1]!], type: F64, loc: next.loc };
      if (next.callee.startsWith(ARRAYLIKE_LENGTH) && next.args.length === 1)
        return { kind: "bytesIntrinsic", method: "length", receiver: binding(next.loc), args: [], type: F64, loc: next.loc };
    }
    return next;
  };
  const stmt = (s: IrStmt): IrStmt => mapStmtChildren(s, expr, stmt);
  const specialized = stmts.map((s) => stmt(s));
  return specialized.map((s) => foldConstants(s));
}

/** Fold the constant tag tests a specialization left behind: a ternary (or a
 * short-circuit, a `!`, a `toBool`) over a boolean literal takes the branch
 * the literal selects, so the arm's own length and element reads reach the
 * bound proofs as themselves rather than through a dispatch shape. */
function foldConstants(s: IrStmt): IrStmt {
  const expr = (e: IrExpr): IrExpr => fold(mapExprChildren(e, expr, stmt));
  const stmt = (s: IrStmt): IrStmt => {
    const next = mapStmtChildren(s, expr, stmt);
    if (next.kind !== "if") return next;
    const cond = boolConstant(next.cond);
    // The branch the arm rules out holds the other arms' dispatch, including
    // their narrowed reads and trap edges: it cannot run, so it leaves the
    // function rather than staying as an unreachable copy.
    if (cond === null) return next;
    return { kind: "block", body: cond ? next.then : (next.else_ ?? []), loc: next.loc };
  };
  return stmt(s);
}

function fold(e: IrExpr): IrExpr {
  switch (e.kind) {
    case "ternary": {
      const cond = boolConstant(e.cond);
      return cond === null ? e : cond ? e.then : e.else_;
    }
    case "logical": {
      const left = boolConstant(e.left);
      if (left === null || e.type.kind !== "bool") return e;
      if (e.op === "&&") return left ? e.right : e.left;
      return left ? e.left : e.right;
    }
    case "unary": {
      const operand = boolConstant(e.operand);
      if (operand === null || e.op !== "!") return e;
      return { kind: "boolLit", value: !operand, type: BOOL, loc: e.loc };
    }
    case "toBool": {
      const operand = boolConstant(e.operand);
      return operand === null ? e : e.operand;
    }
    default:
      return e;
  }
}

function boolConstant(e: IrExpr): boolean | null {
  if (e.kind === "boolLit") return e.value;
  if (e.kind === "unary" && e.op === "!") {
    const operand = boolConstant(e.operand);
    return operand === null ? null : !operand;
  }
  return null;
}
