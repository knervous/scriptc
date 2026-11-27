/* Shared scope environments (closure conversion layout).
 *
 * The frontend boxes every variable a nested function captures, and the
 * backend gave each such variable a cell of its own ({value, init}) and
 * every closure an environment struct of cell references: a scope with k
 * captured variables and c closures cost k + c objects besides the closures.
 * V8 keeps one Context per scope instead, which its closures share.
 *
 * Here, in a synchronous function, the captured variables that one
 * statement list declares (the boxed parameters join the body's top list)
 * share one scope struct, one mutable field each. The list's first such
 * declaration allocates it (the prologue, for the top list), so every
 * execution of the list - each loop iteration - gets a fresh one; later
 * declarations of the list write their field. A closure's environment
 * lists the distinct carriers its captures live in (scope structs, or the
 * cells that remain); with a single carrier, the carrier itself is the
 * environment and no environment struct is allocated.
 *
 * Allocating at the first declaration instead of at list entry is exact for
 * the bindings grouped: a closure can capture a lexical binding before its
 * declaration runs only as a forward capture, which the frontend marks TDZ,
 * and TDZ bindings keep their cells (the cell's init flag is their TDZ
 * state); `var` bindings are declared at the function's top.
 *
 * Kept as cells: TDZ bindings; bindings declared anywhere but one plain
 * varDecl in a statement list (catch, for-in/of and for-header bindings,
 * whose per-iteration copies re-box them; switch-case lists, which share one
 * scope across cases); and every variable that reaches, directly or through
 * enclosing closures, an async function (its frame stores cell references)
 * or a function created from more than one function (its environment layout
 * must not depend on the creator). Profiled call arms recognize a closure's
 * function by its environment type, so the functions a call profile names
 * keep an environment struct of their own.
 *
 * SCRIPTC_WASMGC_NO_SCOPE_GROUPS=1 turns the whole layout off (A/B). */
import type { IrExpr, IrFunction, IrLocal, IrStmt, IrType } from "../../ir/ir.js";
import type { SiteProfileIndex } from "./site-profile.js";

export interface ScopeGroup {
  /** The struct type's key: the member types (groups with the same member types share a type). */
  key: string;
  fn: string;
  /** Members in field order: boxed parameters first (top group), then declarations in list order. */
  members: string[];
  types: IrType[];
  /** The body's top list: allocated by the prologue (with the parameters' values). */
  top: boolean;
  params: Set<string>;
}

export type Carrier = { kind: "box"; type: IrType } | { kind: "group"; group: ScopeGroup };

export interface EnvLayout {
  /** Distinct carriers, in environment field order. */
  carriers: Carrier[];
  /** Per capture (callee captures[] order): its carrier, and its field in that carrier (0 for a cell). */
  slot: number[];
  field: number[];
  /** One carrier, which is the environment itself. */
  direct: boolean;
}

export interface ScopeEnvironments {
  groups: ScopeGroup[];
  /** Per function: its grouped variables, their group and field. */
  members: Map<string, Map<string, { group: ScopeGroup; field: number }>>;
  layouts: Map<string, EnvLayout>;
}

const typeKey = (t: IrType): string => JSON.stringify(t);

/** Every IR node object under `root` (statements and expressions), with the array directly holding it. */
function walk(root: unknown, visit: (node: Record<string, unknown>, container: unknown[] | null) => void): void {
  const go = (v: unknown, container: unknown[] | null): void => {
    if (Array.isArray(v)) { for (const x of v) go(x, v); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o["kind"] === "string") visit(o, container);
    for (const [k, x] of Object.entries(o)) if (k !== "type" && k !== "loc" && x && typeof x === "object") go(x, null);
  };
  go(root, null);
}

export function scopeEnvironments(emitted: readonly IrFunction[], functions: ReadonlyMap<string, IrFunction>, profile?: SiteProfileIndex): ScopeEnvironments {
  const out: ScopeEnvironments = { groups: [], members: new Map(), layouts: new Map() };
  if (typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_NO_SCOPE_GROUPS"] === "1") return out;
  const emittedNames = new Set(emitted.map(f => f.name));
  // Closure creation sites: the creating function and the creator's ids of the captures.
  const sites = new Map<string, { parent: string; captures: string[] }[]>();
  // Functions a profiled call arm may recognize by environment type.
  const identity = new Set<string>();
  const fnByLoc = profile ? new Map([...functions.values()].filter(f => f.loc?.file).map(f => [`${f.loc.file}\0${f.loc.start}:${f.loc.end}`, f.name])) : null;
  for (const f of emitted) walk(f.body, node => {
    if (node["kind"] === "closure" && (node["captures"] as string[]).length) {
      const list = sites.get(node["fnName"] as string) ?? [];
      list.push({ parent: f.name, captures: node["captures"] as string[] });
      sites.set(node["fnName"] as string, list);
    }
    if (profile && fnByLoc && node["kind"] === "dynCall") for (const site of profile.at((node as unknown as IrExpr).loc, ["call"])) {
      const target = site.call?.targets?.length === 1 ? site.call.targets[0]! : null;
      if (target?.file && target.fn) { const name = fnByLoc.get(`${target.file}\0${target.fn.start}:${target.fn.end}`); if (name) identity.add(name); }
    }
  });
  const captureIndex = (f: IrFunction | undefined, id: string): number => f?.captures?.findIndex(c => c.localId === id) ?? -1;
  const synchronous = (f: IrFunction | undefined): boolean => !!f && !f.async && !f.generator && !f.classCaptures?.length && emittedNames.has(f.name);
  /** A lifted function whose environment can be laid out over its creator's carriers. */
  const laidOut = (g: IrFunction): boolean => {
    const s = sites.get(g.name);
    if (!synchronous(g) || !s?.length || new Set(s.map(x => x.parent)).size !== 1) return false;
    const first = JSON.stringify(s[0]!.captures);
    return s.every(x => JSON.stringify(x.captures) === first) && s[0]!.captures.length === g.captures!.length;
  };
  // Pinned variables keep their cells: everything that reaches a function that is not laid out.
  const pinned = new Set<string>();
  const pin = (fnName: string, id: string, depth = 0): void => {
    if (depth > 64 || pinned.has(`${fnName}\0${id}`)) return;
    pinned.add(`${fnName}\0${id}`);
    const f = functions.get(fnName), i = captureIndex(f, id);
    if (i >= 0) for (const s of sites.get(fnName) ?? []) if (s.captures[i] !== undefined) pin(s.parent, s.captures[i]!, depth + 1);
  };
  for (const [name, list] of sites) {
    const g = functions.get(name);
    if (g && g.captures?.length && laidOut(g)) continue;
    for (const s of list) for (const id of s.captures) pin(s.parent, id);
  }
  // Groups: per synchronous function, the plainly declared captured variables of each list.
  for (const f of emitted) {
    if (!synchronous(f)) continue;
    const locals = new Map<string, IrLocal>(f.locals.map(l => [l.id, l]));
    const decls = new Map<string, number>(), container = new Map<string, unknown[]>(), excluded = new Set<string>();
    const caseLists = new Set<unknown[]>();
    walk(f.body, (node, list) => {
      const id = node["localId"];
      if (node["kind"] === "varDecl" && typeof id === "string") { decls.set(id, (decls.get(id) ?? 0) + 1); if (list) container.set(id, list); }
      // Reads and writes go through the variable's carrier (localGet/localSet); any other binding form keeps a cell.
      else if (typeof id === "string" && !["varRef", "assign", "incDec", "assignExpr"].includes(node["kind"] as string)) excluded.add(id);
      if (typeof node["catchLocalId"] === "string") excluded.add(node["catchLocalId"] as string);
      if (node["kind"] === "for" && node["init"]) walk(node["init"], n => { if (n["kind"] === "varDecl" && typeof n["localId"] === "string") excluded.add(n["localId"] as string); });
      if (node["kind"] === "switch") for (const c of node["cases"] as { body: IrStmt[] }[]) caseLists.add(c.body);
    });
    const eligible = (l: IrLocal | undefined): l is IrLocal => !!l && !!l.boxed && !l.tdz && !pinned.has(`${f.name}\0${l.id}`) && captureIndex(f, l.id) < 0;
    const params = f.params.map(p => locals.get(p.localId)).filter(eligible).filter(l => !decls.has(l.id) && !excluded.has(l.id));
    const byList = new Map<unknown[], string[]>();
    for (const [id, n] of decls) {
      const l = locals.get(id), list = container.get(id);
      if (n !== 1 || !list || excluded.has(id) || caseLists.has(list) || !eligible(l)) continue;
      const ids = byList.get(list) ?? [];
      ids.push(id);
      byList.set(list, ids);
    }
    if (params.length && !byList.has(f.body)) byList.set(f.body, []);
    for (const [list, ids] of byList) {
      const top = list === f.body;
      // Declaration order within the list.
      const order = new Map((list as IrStmt[]).map((s, i) => [s.kind === "varDecl" ? s.localId : "", i]));
      ids.sort((a, b) => order.get(a)! - order.get(b)!);
      const members = [...(top ? params.map(p => p.id) : []), ...ids];
      if (members.length < 2) continue;
      const types = members.map(id => locals.get(id)!.type);
      const group: ScopeGroup = { key: types.map(typeKey).join(","), fn: f.name, members, types, top, params: new Set(top ? params.map(p => p.id) : []) };
      out.groups.push(group);
      const map = out.members.get(f.name) ?? new Map();
      members.forEach((id, field) => map.set(id, { group, field }));
      out.members.set(f.name, map);
    }
  }
  // Environment layouts, creators first.
  const layoutOf = (name: string, depth = 0): EnvLayout | null => {
    if (out.layouts.has(name)) return out.layouts.get(name)!;
    const g = functions.get(name);
    if (!g?.captures?.length || !laidOut(g) || depth > 64) return null;
    const site = sites.get(name)![0]!, parent = functions.get(site.parent)!;
    const parentLayout = parent.captures?.length ? layoutOf(parent.name, depth + 1) : null;
    const carriers: Carrier[] = [], keys: string[] = [], slot: number[] = [], field: number[] = [];
    site.captures.forEach((id, i) => {
      let key: string, carrier: Carrier, at = 0;
      const member = out.members.get(parent.name)?.get(id), j = captureIndex(parent, id);
      if (member) { key = `g\0${out.groups.indexOf(member.group)}`; carrier = { kind: "group", group: member.group }; at = member.field; }
      else if (j >= 0 && parentLayout) { key = `e\0${parentLayout.slot[j]}`; carrier = parentLayout.carriers[parentLayout.slot[j]!]!; at = parentLayout.field[j]!; }
      else { key = `b\0${id}`; carrier = { kind: "box", type: (parent.locals.find(l => l.id === id) ?? parent.captures?.[j])?.type ?? g.captures![i]!.type }; }
      let k = keys.indexOf(key);
      if (k < 0) { k = keys.length; keys.push(key); carriers.push(carrier); }
      slot.push(k); field.push(at);
    });
    const layout: EnvLayout = { carriers, slot, field, direct: carriers.length === 1 && !identity.has(name) };
    out.layouts.set(name, layout);
    return layout;
  };
  for (const f of emitted) if (f.captures?.length) layoutOf(f.name);
  // SCRIPTC_WASMGC_SCOPE_REPORT=1: what the layout grouped (debugging).
  if (typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_SCOPE_REPORT"]) {
    const layouts = [...out.layouts.values()], lifted = emitted.filter(f => f.captures?.length).length;
    console.error(`scope-env: ${out.groups.length} groups (${out.groups.reduce((n, g) => n + g.members.length, 0)} variables) in ${out.members.size} functions; ` +
      `${layouts.length}/${lifted} capturing functions laid out, ${layouts.filter(l => l.direct).length} with the carrier as environment; ${pinned.size} variables pinned to cells`);
    if (process.env["SCRIPTC_WASMGC_SCOPE_REPORT"] === "2") for (const g of out.groups) console.error(`  group ${g.fn}: ${g.members.join(", ")}${g.top ? " (top)" : ""}`);
  }
  return out;
}
