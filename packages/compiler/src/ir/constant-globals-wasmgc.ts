import type { IrExpr, IrFunction, IrGlobal, IrModule, IrStmt } from "./ir.js";
import { everyStmtList, transformStmtList } from "./traverse.js";

// Ported from upstream scriptc (vercel-labs/scriptc b552bc1354 "Read module constants as their literal values" and
// 6ee5463186 "Read module let/var bindings that only their declaration writes as constants"), without upstream's node
// index: the fork walks the bodies with traverse.ts. The fork spells upstream's `initFlag` as `tdzFlag`.

type Literal = (IrExpr & { kind: "numLit" }) | (IrExpr & { kind: "boolLit" });

/** Every node of every function body that names a binding: `visit(id, node)` for each write (a read is a `varRef`;
 * every other node with a `localId` writes it: assignments, declarations, loop bindings, updates; a catch binding
 * writes its `catchLocalId`), and `read(id, fn)` for each `varRef`. Erring toward a write only keeps a global as it is. */
function eachBinding(mod: IrModule, write: (id: string, node: IrExpr | IrStmt) => void, read?: (id: string, fn: IrFunction) => void): void {
  for (const fn of mod.functions) {
    const visit = (node: IrExpr | IrStmt): boolean => {
      const n = node as { kind: string; localId?: unknown; catchLocalId?: unknown };
      if (n.kind === "varRef") read?.((node as IrExpr & { kind: "varRef" }).localId, fn);
      else if (typeof n.localId === "string") write(n.localId, node);
      if (n.kind === "tryCatch" && typeof n.catchLocalId === "string") write(n.catchLocalId, node);
      return true;
    };
    everyStmtList(fn.body, { expr: visit, stmt: visit });
  }
}

/** Module `let`/`var` bindings that only their declaration writes become immutable globals.
 *
 * A source binding whose one write in the whole program is a top-level `assign` of a guarded, synchronous module
 * initializer holds that value for every later read, exactly like a `const`; reads that can run before the store
 * carry a TDZ sentinel or flag, and those globals are left alone. Marking the global immutable hands it to the
 * analyses that already serve `const` (constant folding below, the emitter's pure initializers, proven reads and
 * closure globals) without changing its storage or initialization order. Compiler-internal globals (init guards,
 * caches) have no source binding and are never touched. Library builds keep their globals: a host may reset or
 * observe them between entries. */
export function freezeInitOnlyGlobals(mod: IrModule): IrModule {
  if (mod.lib || !mod.globals?.length) return mod;
  const candidates = new Map<string, IrGlobal>();
  for (const g of mod.globals) if (g.mutable && g.source && g.tdz !== true && g.tdzFlag !== true) candidates.set(g.id, g);
  if (candidates.size === 0) return mod;
  for (const cls of mod.classes ?? []) for (const id of classCaptureIds(cls)) candidates.delete(id);
  for (const fn of mod.functions) for (const id of functionCaptureIds(fn)) candidates.delete(id);

  const writes = new Map<string, number>();
  eachBinding(mod, (id, node) => {
    if ((node as { kind: string }).kind === "closure") return;
    if (candidates.has(id)) writes.set(id, (writes.get(id) ?? 0) + 1);
  });
  for (const fn of mod.functions) {
    const visit = (node: IrExpr | IrStmt): boolean => {
      const n = node as { kind: string; captures?: unknown };
      if ((n.kind === "closure" || n.kind === "classRef") && Array.isArray(n.captures)) for (const id of n.captures) candidates.delete(id);
      return true;
    };
    everyStmtList(fn.body, { expr: visit, stmt: visit });
  }

  const frozen = new Set<string>();
  for (const fn of mod.functions) {
    if (!isGuardedInitializer(fn, mod)) continue;
    const readBefore = new Set<string>();
    const noteReads = (s: IrStmt): void => {
      everyStmtList([s], {
        stmt: () => true,
        expr: (e: IrExpr) => {
          if (e.kind === "varRef" && candidates.has(e.localId)) readBefore.add(e.localId);
          return true;
        },
      });
    };
    // Unlabeled blocks run unconditionally and in order, like the statements around them; a labeled block can
    // `break` past a write, and any other compound statement may skip or repeat one.
    const scan = (list: readonly IrStmt[]): void => {
      for (const s of list) {
        if (s.kind === "block" && !(s as { labels?: string[] }).labels?.length) {
          scan((s as IrStmt & { kind: "block" }).body);
          continue;
        }
        // The statement's own reads count first: `var X = X + 1` reads X before its store (stricter than upstream).
        noteReads(s);
        if (s.kind === "assign" && candidates.has(s.localId) && writes.get(s.localId) === 1 && !readBefore.has(s.localId)) frozen.add(s.localId);
      }
    };
    scan(fn.body);
  }
  if (frozen.size === 0) return mod;
  return { ...mod, globals: mod.globals.map(g => (frozen.has(g.id) ? { ...g, mutable: false } : g)) };
}

/** Module constants such as `const DOT = 0x2e` read as their literal.
 *
 * A module-level binding is a global the module initializer stores once; every other function loads it, which hides
 * the value from switch dispatch, integer ranges and Binaryen's and V8's constant folding. When the global is
 * immutable, has exactly one write in the program and that write stores a number or boolean literal, every read sees
 * that literal: reads that could run before the store carry a TDZ sentinel or flag, and those globals are left alone.
 * The store stays, so namespace views and debuggers still find the value. Library builds keep their globals. */
export function foldConstantGlobals(mod: IrModule): IrModule {
  if (mod.lib || !mod.globals?.length) return mod;
  const candidates = new Set<string>();
  for (const g of mod.globals)
    if (!g.mutable && g.tdz !== true && g.tdzFlag !== true && (g.type.kind === "f64" || g.type.kind === "bool")) candidates.add(g.id);
  if (candidates.size === 0) return mod;

  const writes = new Map<string, number>(), values = new Map<string, Literal>();
  const readsByFunction = new Map<IrFunction, Set<string>>();
  eachBinding(
    mod,
    (id, node) => {
      if (!candidates.has(id)) return;
      writes.set(id, (writes.get(id) ?? 0) + 1);
      const n = node as { kind: string; value?: IrExpr; init?: IrExpr | null };
      const value = n.kind === "assign" ? n.value : n.kind === "varDecl" ? n.init : null;
      if (value && (value.kind === "numLit" || value.kind === "boolLit")) values.set(id, value);
      else values.delete(id);
    },
    (id, fn) => {
      if (!candidates.has(id)) return;
      let set = readsByFunction.get(fn);
      if (!set) readsByFunction.set(fn, (set = new Set()));
      set.add(id);
    },
  );
  const constants = new Map<string, Literal>();
  for (const [id, value] of values) if (writes.get(id) === 1) constants.set(id, value);
  if (constants.size === 0) return mod;

  const transform = {
    expr: (e: IrExpr): IrExpr => {
      if (e.kind !== "varRef") return e;
      const value = constants.get(e.localId);
      return value ? ({ ...value, type: e.type, loc: e.loc } as IrExpr) : e;
    },
    stmt: (s: IrStmt): IrStmt => s,
  };
  let changed = false;
  const functions = mod.functions.map((fn): IrFunction => {
    const read = readsByFunction.get(fn);
    if (!read || ![...read].some(id => constants.has(id))) return fn;
    changed = true;
    return { ...fn, body: transformStmtList(fn.body, transform) };
  });
  return changed ? { ...mod, functions } : mod;
}

/** `if (loaded) return; loaded = true; ...`: a synchronous module initializer that runs its body at most once, whose
 * guard only it writes. */
function isGuardedInitializer(fn: IrFunction, mod: IrModule): boolean {
  if (fn.async || fn.generator || functionCaptureIds(fn).length) return false;
  const check = fn.body[0], set = fn.body[1];
  if (
    check?.kind !== "if" ||
    check.cond.kind !== "varRef" ||
    (check.else_ !== null && check.else_ !== undefined && check.else_.length !== 0) ||
    check.then.length !== 1 ||
    check.then[0]?.kind !== "return" ||
    check.then[0].value !== null ||
    set?.kind !== "assign" ||
    set.localId !== check.cond.localId ||
    set.value.kind !== "boolLit" ||
    !set.value.value
  )
    return false;
  const guard = mod.globals?.find(g => g.id === set.localId);
  return guard?.type.kind === "bool" && guard.tdz !== true;
}

function functionCaptureIds(fn: IrFunction): string[] {
  const f = fn as { captures?: { localId: string }[]; classCaptures?: { localId: string }[] };
  return [...(f.captures ?? []), ...(f.classCaptures ?? [])].map(c => c.localId);
}

function classCaptureIds(cls: unknown): string[] {
  const c = cls as { localCaptures?: { localId: string }[] };
  return (c.localCaptures ?? []).map(x => x.localId);
}
