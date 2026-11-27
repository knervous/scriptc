/* Points-to analysis over the IR (review §39, type-recovered compilation).
 *
 * Andersen-style inclusion constraints, solved with a worklist over interned values:
 *   - field-sensitive on constant keys; a computed key reads and writes `*`, or in hint mode a key of
 *     its own when it is held in a module global assigned once (`@<global>`);
 *   - flow-sensitive for a function's own locals that no closure captures (React's production build
 *     reuses variables for unrelated values): joins at branches, a switch's cases start from the state
 *     before it, and break/continue/return/throw end a path; captured locals, module globals and
 *     parameters stay one node each;
 *   - context-insensitive by default; `cloneLimit` clones small functions per call site (measured: no
 *     gain on the React graph once the hint-mode filters below apply).
 *
 * Abstract values: an allocation site (`new:<constructor fn>`, `lit:<fn>#n`, `arr:<fn>#n`,
 * `coll:<Map|Set...>#n`, a closure `fn:<fnName>`, `bound:...`), a primitive kind (`null`, `undef`,
 * `num`, `str`, `bool`, `sym`), a page object (`H`, or one named where it entered compiled code:
 * `H:g:document`, `H:new#n`) or `U` (unmodeled: proves nothing).
 *
 * Two modes. Sound: every compiled value that reaches the page flows into ESC, and whatever the page
 * hands back is H or a value in ESC. Hint (the default, for guarded consumers): page reads yield page
 * objects plus what compiled code stored on that page object, and three filters keep the analysis's
 * own merges from spreading:
 *   - shapes: a first pass finds each object's shape (initializer keys, keys stored where it is the
 *     only possible receiver); the second pass drops stores of other keys through merged receivers;
 *   - key filters: constant-key reads, writes and method calls ignore receivers that cannot have the
 *     key (`keyed` in the result);
 *   - narrowing: after `x.k`, the rest of the path sees local x as only the objects that can have k.
 * validate.mjs checks the hints against a recorded site profile (what actually ran).
 *
 * Builtins are modeled (array, collection and primitive methods, Object.*, iterators, descriptors);
 * any other unmodeled operation yields U, and `unknown` names it so the model can grow where precision
 * is lost. A site whose set holds U or H must keep its generic code. */
import type { IrExpr, IrFunction, IrModule, IrStmt } from "./ir.js";
import { builtinFunction, builtinMethod, builtinMethods, type BuiltinFlow, type FlowValue } from "../builtins/table.js";

export type AbsValue = string;
export interface PointsTo {
  /** The receiver set of each property-access call node (dispatcher reads and writes, keyed reads). */
  receivers: Map<IrExpr, ReadonlySet<AbsValue>>;
  /** Parameter sets per function. */
  params(fn: string): ReadonlySet<AbsValue>[];
  /** Unmodeled operations that produced U, with counts. */
  unknown: Map<string, number>;
  /** Property reads, writes and method calls under a constant key: the receiver set without objects
   * that never get that key (in hint mode, outside their shape; own or inherited). Such an object
   * would read undefined there, or (a write) is not one the analysis lets gain the key, so a guarded
   * consumer may ignore it. */
  keyed: Map<IrExpr, ReadonlySet<AbsValue>>;
  /** Each object's shape: the keys its initializer gives it (an object literal's, a constructor's
   * stores to `this`) and keys stored where it is the only possible receiver. */
  shapes: ReadonlyMap<AbsValue, ReadonlySet<string>>;
  /** Abstract objects written under a computed key (never conversion-free). */
  computedWrites: ReadonlySet<AbsValue>;
  /** The values field `k` of abstract object `o` may hold (its initializer's and every store's). */
  fieldValues(o: AbsValue, k: string): ReadonlySet<AbsValue>;
  /** The abstract object each object literal site allocates. */
  allocs: ReadonlyMap<IrExpr, AbsValue>;
  /** Debug (analyzePointsTo(mod, { trace: true })): the shortest chain of labelled nodes that carried `value` into parameter `index` of `fn`. */
  explain?(fn: string, index: number, value: AbsValue): string[];
  /** Debug: the same chain into a property site's receiver. */
  explainReceiver?(site: IrExpr, value: AbsValue): string[];
  /** Debug: the chain into a named node (`F|<object>|<key>`, `G|<global>`, `R|<fn>`, `P|<key>`...). */
  explainNamed?(name: string, value: AbsValue): string[];
  /** Debug: where values a and b first meet on a's way into a property site ([node before, merge node]). */
  mergePoint?(site: IrExpr, a: AbsValue, b: AbsValue): string[];
}

/** `int` is a number that is (most likely) an int32: integer literals, bitwise results, lengths and
 * indices, and `+ - * %` and `++`/`--` of ints. It is a hint: overflow is not tracked, so a consumer
 * keeps a guard (an i32 struct field checks each write). `num` is any other number. */
const PRIMS = new Set(["null", "undef", "num", "int", "str", "bool", "sym"]);
const INT32 = (v: number) => Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31 && !Object.is(v, -0);
/** A page object: `H` (one the page handed back), or one named by where it entered compiled code (`H:g:document`, `H:new#12`). */
export const isPage = (v: AbsValue) => v === "H" || v.startsWith("H:");
const opaque = (v: AbsValue) => PRIMS.has(v) || v === "U" || isPage(v);
/** Objects whose named keys are their shape's (hint mode): literals, constructed objects, arrays, closures, bound functions, collections. */
const shaped = (v: AbsValue) => v.startsWith("lit:") || v.startsWith("new:") || v.startsWith("arr:") || v.startsWith("fn:") || v.startsWith("bound:") || v.startsWith("coll:");
const FUNCTION_KEYS = new Set(["prototype", "name", "length", "call", "apply", "bind", "toString", "constructor", "hasOwnProperty"]);
const COLLECTION_KEYS = new Set(["size", "constructor", ...builtinMethods("collection")]);
const ANY = "*", IDX = "#";
/** Math functions whose result is an integer (an int32 for the int32-range inputs that matter here). */
const INT_MATH = new Set(["floor", "ceil", "round", "trunc", "clz32", "imul", "sign"]);
/** Array methods the builtin table models (key filters and narrowing treat them as present on arrays). */
const ARRAY_METHODS = builtinMethods("array");

export interface PointsToOptions {
  trace?: boolean;
  sound?: boolean;
  /** Clone functions of at most this many IR nodes per call site (0, the default: off). */
  cloneLimit?: number;
  /** Hint mode: each object's shape (see `shapes` in the result); a store of a key outside an
   * object's shape is dropped for that object. Default: computed by a first pass. `false`: off. */
  shapes?: ReadonlyMap<AbsValue, ReadonlySet<string>> | false;
}

/** Hint mode runs twice: the first pass finds each object's shape (its initializer's keys and the keys
 * stored where it is the only possible receiver), the second keeps stores through merged receivers
 * from adding keys to objects whose shape lacks them. React-style code initializes an object's whole
 * shape up front; an object that gains a key only through merged stores is the analysis's merge, not
 * the program's. The sound mode does not filter. */
export function analyzePointsTo(mod: IrModule, opts: PointsToOptions = {}): PointsTo {
  if (opts.sound || opts.shapes !== undefined) return analyzePass(mod, opts);
  const first = analyzePass(mod, { ...opts, shapes: false, trace: false });
  return analyzePass(mod, { ...opts, shapes: first.shapes });
}

function analyzePass(mod: IrModule, opts: PointsToOptions): PointsTo {
  const fns = new Map(mod.functions.map(f => [f.name, f]));
  // ── nodes ──
  // Values are interned (ids into `vals`); a node's set holds ids, and the solver propagates each
  // node's new ids as one batch (`delta`) along its edges and to its subscribers.
  const vals: AbsValue[] = [], vidOf = new Map<AbsValue, number>();
  const vid = (v: AbsValue) => { let i = vidOf.get(v); if (i === undefined) { vidOf.set(v, i = vals.length); vals.push(v); } return i; };
  const sets: Set<number>[] = [], succ: Set<number>[] = [];
  const hasV = (n: number, v: AbsValue) => { const i = vidOf.get(v); return i !== undefined && sets[n]!.has(i); };
  const valuesOf = (n: number): AbsValue[] => { const out: AbsValue[] = []; for (const i of sets[n]!) out.push(vals[i]!); return out; };
  type Sub = (v: AbsValue) => void;
  const subs: Sub[][] = [];
  const labels: string[] = []; let LABEL = "";
  const nodeRaw = (): number => { if (opts.trace) labels.push(LABEL); sets.push(new Set()); succ.push(new Set()); subs.push([]); return sets.length - 1; };
  const node = nodeRaw;
  const named = new Map<string, number>();
  const nn = (k: string) => { let n = named.get(k); if (n === undefined) named.set(k, n = node()); return n; };
  const delta: (number[] | undefined)[] = [], queue: number[] = [];
  const flowI = (n: number, i: number) => { const st = sets[n]!; if (st.has(i)) return; st.add(i); const d = delta[n]; if (d) d.push(i); else { delta[n] = [i]; queue.push(n); } };
  const flow = (n: number, v: AbsValue) => flowI(n, vid(v));
  /** Trace only: the nodes where each value is introduced (not propagated), for explain(). */
  const born = new Map<AbsValue, Set<number>>();
  const add = (n: number, v: AbsValue) => { if (opts.trace && !hasV(n, v)) (born.get(v) ?? born.set(v, new Set()).get(v)!).add(n); flow(n, v); };
  const edge = (a: number, b: number) => { if (a === b || succ[a]!.has(b)) return; succ[a]!.add(b); for (const i of sets[a]!) flowI(b, i); };
  /** Run `f` for every value n holds now or later. */
  const each = (n: number, f0: Sub) => {
    // Trace: nodes a subscription creates while solving are labelled with the expression that subscribed.
    const at = LABEL, f: Sub = opts.trace ? v => { const s = LABEL; LABEL = at; f0(v); LABEL = s; } : f0;
    subs[n]!.push(f); for (const v of valuesOf(n)) f(v);
  };
  /** Trace only: `out` takes values derived from `src`'s (a receiver or callee), for explain(). */
  const derived = new Map<number, number[]>();
  const via = (src: number, out: number) => { if (opts.trace) (derived.get(out) ?? derived.set(out, []).get(out)!).push(src); };
  const field = (o: AbsValue, k: string) => nn(`F|${o}|${k}`);
  let noteKeyLater: (o: AbsValue, k: string) => void = () => {};
  const unknown = new Map<string, number>();
  const blame = (why: string, n: number) => { unknown.set(why, (unknown.get(why) ?? 0) + 1); add(n, "U"); };
  const prim = (n: number, kind: string) => { add(n, kind); return n; };
  /** A numeric operator on two operands' values: `+ - * %` of two ints is an int (overflow and a zero
   * divisor are not tracked: see `int`), bitwise operators are ints, anything else a number. */
  const arith = (op: string, l: number, r: number, out: number) => {
    if (op === "&" || op === "|" || op === "^" || op === "<<" || op === ">>" || op === "~") { add(out, "int"); return; }
    if (op === ">>>") { add(out, "num"); return; } // unsigned: 2^31 and above are not int32
    const closed = op === "+" || op === "-" || op === "*" || op === "%";
    each(l, v => { if (v !== "int" || !closed) add(out, "num"); else if (hasV(r, "int")) add(out, "int"); });
    each(r, v => { if (v !== "int" || !closed) add(out, "num"); else if (hasV(l, "int")) add(out, "int"); });
  };
  const ESC = nn("ESC"), EXPANDO = nn("EXPANDO"), THROWN = nn("THROWN");
  add(ESC, "H");
  // Sound: what the page hands back may be any escaped compiled value. Hint mode: page objects.
  const PAGE = nn("PAGE"); add(PAGE, "H");
  const fromPage = (n: number) => edge(opts.sound ? ESC : PAGE, n);
  const pageField = (o: AbsValue, k: string) => nn(o === "H" || k.startsWith("@") ? `P|${k}` : `P|${o}|${k}`);
  const computedWrites = new Set<AbsValue>();
  const allocs = new Map<IrExpr, AbsValue>();
  const receivers = new Map<IrExpr, number[]>();
  const noteReceiver = (x: IrExpr, r: number, readKey?: string) => { const rs = receivers.get(x); if (rs) rs.push(r); else receivers.set(x, [r]); if (readKey !== undefined && readKey !== ANY && readKey !== IDX) readKeys.set(x, readKey); };
  const readKeys = new Map<IrExpr, string>();
  const litKeys = new Map<AbsValue, Set<string>>();
  /** Keys each abstract object gets by a write or an initializer (reads do not count). */
  const defKeys = new Map<AbsValue, Set<string>>();
  /** Record that o gets key k (a write or an initializer): copies and computed reads then see that field. */
  const defKey = (o: AbsValue, k: string) => { if (k === ANY) return; let ks = defKeys.get(o); if (!ks) defKeys.set(o, ks = new Set()); ks.add(k); noteKeyLater(o, k); };

  // ── scopes: a closure's captured locals alias the defining function's ──
  const parent = new Map<string, { owner: string; caps: Set<string> }>();
  const scan = (x: unknown, owner: string): void => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { for (const y of x) scan(y, owner); return; }
    const o = x as Record<string, unknown>;
    if (o["kind"] === "closure" && typeof o["fnName"] === "string" && fns.has(o["fnName"]) && !parent.has(o["fnName"]))
      parent.set(o["fnName"], { owner, caps: new Set((o["captures"] as string[] | undefined) ?? []) });
    for (const k in o) if (k !== "type" && k !== "loc") scan(o[k], owner);
  };
  for (const f of mod.functions) scan(f.body, f.name);
  // Functions with a rest parameter (their closures' type says so; direct callers pack the array themselves).
  const restFns = new Set<string>();
  const scanRest = (x: unknown): void => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { for (const y of x) scanRest(y); return; }
    const o = x as Record<string, unknown>;
    if (o["kind"] === "closure" && (o["type"] as { rest?: boolean } | undefined)?.rest) restFns.add(o["fnName"] as string);
    for (const k in o) if (k !== "loc") scanRest(o[k]);
  };
  for (const f of mod.functions) scanRest(f.body);
  // Module globals assigned exactly once (constants after init): a computed key held in one is a key of
  // its own in hint mode (`node[internalInstanceKey]`), `@<global>`, separate from other computed keys.
  const globalWrites = new Map<string, number>();
  const scanG = (x: unknown): void => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { for (const y of x) scanG(y); return; }
    const o = x as Record<string, unknown>;
    if ((o["kind"] === "assign" || o["kind"] === "assignExpr" || o["kind"] === "varDecl") && typeof o["localId"] === "string" && o["localId"].startsWith("%g.")) globalWrites.set(o["localId"], (globalWrites.get(o["localId"]) ?? 0) + 1);
    for (const k in o) if (k !== "type" && k !== "loc") scanG(o[k]);
  };
  for (const f of mod.functions) scanG(f.body);
  /** The key a computed access names: a string literal's value, `@<global>` for a constant global (hint mode), else `*`. */
  const keyOf = (e: IrExpr | undefined): string => {
    let k = e; while (k && (k.kind === "dynFrom" || k.kind === "dynCheck")) k = (k as { value: IrExpr }).value;
    if (k?.kind === "strLit") return k.value;
    if (!opts.sound && k?.kind === "varRef" && k.localId.startsWith("%g.") && globalWrites.get(k.localId) === 1) return `@${k.localId}`;
    return ANY;
  };
  const captured = new Set<string>();
  for (const p of parent.values()) for (const id of p.caps) { let f = p.owner; for (let k = 0; k < 64; k++) { captured.add(`${f}|${id}`); const q = parent.get(f); if (q && q.caps.has(id)) f = q.owner; else break; } }
  const home = (fn: string, id: string): string => { let f = fn; for (let i = 0; i < 64; i++) { const p = parent.get(f); if (p && p.caps.has(id)) f = p.owner; else break; } return f; };
  const local = (fn: string, id: string) => id.startsWith("%g.") ? nn(`G|${id}`) : nn(`L|${home(fn, id)}|${id}`);
  const sensitive = (fn: string, id: string) => !id.startsWith("%g.") && !captured.has(`${fn}|${id}`) && !parent.get(fn)?.caps.has(id);
  // `ctx` is "" for a function's shared instance, `@<call site>` for a small function's clone.
  const ret = (fn: string, ctx: string) => nn(`R|${fn}${ctx}`), thisOf = (fn: string, ctx: string) => nn(`T|${fn}${ctx}`);
  const param = (fn: string, i: number, ctx = ""): number | null => {
    const p = fns.get(fn)?.params[i]; if (!p) return null;
    return ctx && sensitive(fn, p.localId) ? nn(`L|${fn}${ctx}|${p.localId}`) : local(fn, p.localId);
  };

  // ── flow-sensitive environments ──
  let ENV = new Map<string, number>(), CTX = "";
  let REGIONS: (() => void)[] = [];
  const readLocal = (fn: string, id: string) => {
    if (!sensitive(fn, id)) return local(fn, id);
    let n = ENV.get(id);
    if (n === undefined) { n = prim(node(), "undef"); ENV.set(id, n); }
    return n;
  };
  const writeLocal = (fn: string, id: string, v: number) => { if (!sensitive(fn, id)) { edge(v, local(fn, id)); return; } const n = node(); if (opts.trace) labels[n] = `${fn}:def:${id}`; edge(v, n); ENV.set(id, n); };
  /** Environments after a break, continue, return or throw: the path ends there, so joins ignore them. */
  const deadEnvs = new WeakSet<Map<string, number>>();
  const endPath = () => { ENV = new Map(ENV); deadEnvs.add(ENV); };
  const joinEnv = (a: Map<string, number>, b: Map<string, number>) => {
    if (deadEnvs.has(a) && deadEnvs.has(b)) { const d = new Map(a); deadEnvs.add(d); return d; }
    if (deadEnvs.has(a)) return new Map(b);
    if (deadEnvs.has(b)) return new Map(a);
    const saved = LABEL; const out = new Map(a);
    const node = () => { if (opts.trace) LABEL = `${saved.split(":")[0]}:join`; return nodeRaw(); };
    for (const [id, n] of b) { const m = out.get(id); if (m === undefined) { const j = prim(node(), "undef"); edge(n, j); out.set(id, j); } else if (m !== n) { const j = node(); edge(m, j); edge(n, j); out.set(id, j); } }
    for (const [id, n] of a) if (!b.has(id)) { const j = prim(node(), "undef"); edge(n, j); out.set(id, j); }
    if (opts.trace) for (const [id, j] of out) if (j !== a.get(id)) labels[j] = `${saved.split(":")[0]}:join:${id}`;
    LABEL = saved;
    return out;
  };
  const assignedIn = (x: unknown): Set<string> => {
    const ids = new Set<string>();
    const w = (y: unknown): void => {
      if (!y || typeof y !== "object") return;
      if (Array.isArray(y)) { for (const z of y) w(z); return; }
      const o = y as Record<string, unknown>;
      if ((o["kind"] === "assign" || o["kind"] === "assignExpr" || o["kind"] === "varDecl" || o["kind"] === "forOf") && typeof o["localId"] === "string") ids.add(o["localId"]);
      if (o["kind"] === "closure") return;
      for (const k in o) if (k !== "type" && k !== "loc") w(o[k]);
    };
    w(x);
    return ids;
  };
  /** A loop, switch or try: each local it assigns gets one merge node every state flows into (at a
   * break, a continue and the end). A loop's body starts from those nodes; a switch's (`exitOnly`)
   * starts from the state before it, and only its exit is the merge. */
  const region = (fn: string, x: unknown, body: () => void, exitOnly = false) => {
    const heads = new Map<string, number>();
    for (const id of assignedIn(x)) if (sensitive(fn, id)) { const h = node(); if (opts.trace) labels[h] = `${fn}:head:${id}`; const cur = ENV.get(id); if (cur !== undefined) edge(cur, h); else add(h, "undef"); heads.set(id, h); if (!exitOnly) ENV.set(id, h); }
    const flush = () => { if (deadEnvs.has(ENV)) return; for (const [id, h] of heads) { const n = ENV.get(id); if (n !== undefined && n !== h) edge(n, h); } };
    REGIONS.push(flush); body(); flush(); REGIONS.pop();
    ENV = new Map(ENV);
    for (const [id, h] of heads) ENV.set(id, h);
  };

  // ── dispatchers: %dyn.class.property.N and friends, by constant key ──
  const dispatch = new Map<string, { key: string; write: boolean }>();
  for (const f of mod.functions) {
    if (!/^%dyn\.(class\.property\.\d+|generator\.get\.\w+)$/.test(f.name)) continue;
    let key: string | null = null, write = false;
    const w = (x: unknown): void => {
      if (key || !x || typeof x !== "object") return;
      if (Array.isArray(x)) { for (const y of x) w(y); return; }
      const o = x as Record<string, unknown> & { kind?: string };
      const e = o as unknown as IrExpr;
      if (e.kind === "dynKeyGet" && e.key.kind === "strLit") key = e.key.value;
      if (e.kind === "libCall" && e.fn === "dyn.keySet" && e.args[1]?.kind === "strLit") { key = e.args[1].value; write = true; }
      for (const k in o) if (k !== "type" && k !== "loc") w(o[k]);
    };
    w(f.body);
    if (!key && f.name.startsWith("%dyn.generator.get.")) key = f.name.slice("%dyn.generator.get.".length);
    if (key) dispatch.set(f.name, { key, write: write || f.params.length === 2 });
  }
  // Computed-key dispatchers (`%dyn.class.computed.N`) read, or (their body sets a computed key) write.
  const computedWriters = new Set(mod.functions.filter(f => f.name.startsWith("%dyn.class.computed.") && JSON.stringify(f.body).includes('"dyn.keySetComputed"')).map(f => f.name));

  // ── object operations ──
  const protos = new Map<AbsValue, number>(); // new:F -> F's prototype node
  const bound = new Map<AbsValue, { fnNode: number; self: number; args: number[] }>();
  /** Read key `k` of r's objects into out. `IDX` is a computed read with a number key (`v[n]`). */
  const load = (r: number, k: string, out: number) => { via(r, out); loadEach(r, k, out); };
  const loadEach = (r: number, key: string, out: number) => each(r, o => {
    const k = key === IDX ? ANY : key;
    // A read from null or undefined throws: it yields nothing (the analysis ignores conditions, so
    // `x !== null ? x.child : null` reads `.child` from a set that holds null).
    if (o === "null" || o === "undef") return;
    if (PRIMS.has(o)) {
      // A string's length and characters; another named read of a primitive is a prototype member
      // (methods are modeled where they are called) or undefined.
      if (o === "str" && k === "length") add(out, "int");
      else if (o === "str" && (k === ANY || /^\d+$/.test(k))) { add(out, "str"); add(out, "undef"); }
      else add(out, opts.sound ? "U" : "undef");
      return;
    }
    if (o === "U") { flow(out, "U"); return; }
    if (isPage(o)) {
      // Sound: whatever the page hands back may be any escaped value. Hint mode (guarded consumers):
      // a page read yields page objects, plus what compiled code stored under that key on the same
      // named page object, or any expando for a computed key. A page object the page handed back
      // (plain H) is not one compiled code can name, so a named read of it yields page objects alone.
      if (opts.sound) fromPage(out); else { add(out, "H"); if (o !== "H" || k.startsWith("@")) edge(pageField(o, k), out); }
      if (k === ANY) edge(EXPANDO, out);
      return;
    }
    // An array's computed slot holds its elements: only computed and index reads see them. In hint
    // mode an object's computed writes (a dictionary) are not seen by named reads either.
    const elementKey = k === ANY || /^\d+$/.test(k);
    edge(field(o, k), out);
    // A computed read may name any key, so it sees every named field too. Hint mode: a number key
    // names no field, and only a literal's, a dictionary's or a function's named fields are read by
    // computed keys (a constructed instance or array read so is the analysis's merge, not the program's).
    if (key === ANY && (opts.sound || o.startsWith("lit:") || o.startsWith("fn:") || computedWrites.has(o))) eachKey(o, kk => edge(field(o, kk), out));
    else if (key === IDX && opts.sound) eachKey(o, kk => { if (/^\d+$/.test(kk)) edge(field(o, kk), out); });
    if (elementKey || (opts.sound && !o.startsWith("arr:"))) edge(field(o, ANY), out);
    if ((o.startsWith("arr:") && k === "length") || (o.startsWith("coll:") && k === "size")) add(out, "int");
    const p = protos.get(o);
    if (p !== undefined) each(p, po => { if (!opaque(po)) edge(field(po, k), out); });
  });
  const storeSites: [number, string][] = [];
  const shapeOf = opts.shapes || null;
  /** Hint mode, second pass: a shaped object takes stores of its shape's keys only (`*` for computed keys). */
  const takes = (o: AbsValue, k: string) => !shapeOf || !shaped(o) || (k === ANY && (o.startsWith("arr:") || o.startsWith("coll:"))) || shapeOf.get(o)?.has(k) === true;
  const store = (r: number, k: string, v: number) => { storeSites.push([r, k]); storeEach(r, k, v); };
  const storeEach = (r: number, k: string, v: number) => each(r, o => {
    if (!takes(o, k)) return;
    // A computed-key expando (`*`, or a constant global's key) stays compiled-side (opaque expandos).
    if (isPage(o)) { if (!k.startsWith("@")) edge(v, k === ANY ? EXPANDO : ESC); if (k !== ANY) edge(v, pageField(o, k)); return; }
    if (PRIMS.has(o) || o === "U") return;
    defKey(o, k);
    edge(v, field(o, k));
    if (k === ANY) computedWrites.add(o);
  });
  /** Call the functions `c` holds; `cs` names the call site (a small target gets its clone for it). */
  const call = (c: number, args: number[], self: number | null, out: number, cs = "") => { via(c, out); callEach(c, args, self, out, cs); };
  const callEach = (c: number, args: number[], self: number | null, out: number, cs: string) => each(c, o => {
    if (o === "U") { flow(out, "U"); return; }
    if (o.startsWith("bi:")) { builtinCall(o.slice(3), args, out); return; }
    // A bound function: its target with the bound this and the bound arguments first.
    if (o.startsWith("bound:")) { const b = bound.get(o); if (b) call(b.fnNode, [...b.args, ...args], b.self, out, cs); return; }
    if (isPage(o)) { for (const a of args) edge(a, ESC); if (self !== null) edge(self, ESC); fromPage(out); return; }
    if (!o.startsWith("fn:")) return;
    callFn(o.slice(3), args, self, out, cs);
  });
  /** `packed`: a direct call, whose caller already packed a rest parameter's arguments into an array. */
  const callFn = (fn: string, args: number[], self: number | null, out: number, cs: string, packed = false) => {
    if (!fns.has(fn)) return;
    const ctx = cs && small(fn) ? instance(fn, cs) : "";
    const last = fns.get(fn)!.params.length - 1;
    if (restFns.has(fn) && !packed && last >= 0) {
      // A rest parameter: the arguments from its position on, packed into an array per function.
      const a = `arr:rest:${fn}`, p = param(fn, last, ctx);
      if (p !== null) add(p, a);
      args.forEach((n, i) => { if (i >= last) edge(n, field(a, ANY)); else { const q = param(fn, i, ctx); if (q !== null) edge(n, q); } });
    } else args.forEach((a, i) => { const p = param(fn, i, ctx); if (p !== null) edge(a, p); });
    if (self !== null) edge(self, thisOf(fn, ctx));
    edge(ret(fn, ctx), out);
  };
  /** A builtin function value (`bi:Object.is`): results by name; its arguments do not escape. */
  const builtinCall = (name: string, args: number[], out: number) => {
    const spec = builtinFunction(name);
    if (!spec) { blame(`builtin:${name}`, out); return; }
    applyFlow("bi", name, name, spec.flow, "undef", node(), args, out);
  };
  /** Object.assign / spread: every constant-key field of `src`'s objects into the same key of `dst`'s. */
  const fieldKeys = new Map<AbsValue, Set<string>>(), keySubs = new Map<AbsValue, ((k: string) => void)[]>();
  const noteKey = (o: AbsValue, k: string) => { let ks = fieldKeys.get(o); if (!ks) fieldKeys.set(o, ks = new Set()); if (ks.has(k)) return; ks.add(k); for (const f of keySubs.get(o) ?? []) f(k); };
  const eachKey = (o: AbsValue, f: (k: string) => void) => { (keySubs.get(o) ?? keySubs.set(o, []).get(o)!).push(f); for (const k of [...(fieldKeys.get(o) ?? [])]) f(k); };
  noteKeyLater = noteKey;
  /** Hint mode: after `x.k` (a read, write or method call) on a flow-sensitive local x, the rest of the
   * path sees x as only the objects that can have k (opaque values kept). The access threw for null and
   * undefined, and for an object without a callable k; for a read or write, objects without k are the
   * analysis's merge in shape-disciplined code (hint consumers are guarded). */
  const narrow = (fn: string, recv: IrExpr, r: number, k: string) => {
    if (opts.sound || k === ANY || k === IDX || recv.kind !== "varRef" || !sensitive(fn, recv.localId)) return;
    const n = node();
    each(r, o => {
      if (o === "null" || o === "undef") return;
      if (opaque(o) || o.startsWith("bi:")) { add(n, o); return; }
      if (o.startsWith("coll:") ? COLLECTION_KEYS.has(k) : (o.startsWith("fn:") || o.startsWith("bound:")) ? FUNCTION_KEYS.has(k) : o.startsWith("arr:") && (k === "length" || /^\d+$/.test(k) || ARRAY_METHODS.has(k))) { add(n, o); return; }
      eachKey(o, kk => { if (kk === k) add(n, o); });
      const p = protos.get(o);
      if (p !== undefined) each(p, po => { if (opaque(po)) add(n, o); else eachKey(po, kk => { if (kk === k) add(n, o); }); });
    });
    ENV.set(recv.localId, n);
  };
  /** A copy's stores are definite for a shape only when its source is one object too (see shapes). */
  const copySites: [number, number, string][] = [];
  const copyFields = (src: number, dst: number) => each(src, so => { if (opaque(so)) return; eachKey(so, k => { copySites.push([src, dst, k]); storeEach(dst, k, field(so, k)); }); });
  /** `new C(...args)`: one abstract object per constructor function. */
  const construct = (c: number, args: number[], out: number, site = "") => { via(c, out); constructEach(c, args, out, site); };
  const constructEach = (c: number, args: number[], out: number, site: string) => each(c, o => {
    if (isPage(o)) { for (const a of args) edge(a, ESC); add(out, site ? `H:new#${site}` : "H"); return; }
    if (PRIMS.has(o)) return; // throws
    if (o.startsWith("bound:")) { const b = bound.get(o); if (b) construct(b.fnNode, [...b.args, ...args], out, site); return; }
    // Objects, arrays and collections are not constructors: `new` throws.
    if (o.startsWith("new:") || o.startsWith("lit:") || o.startsWith("arr:") || o.startsWith("coll:")) return;
    // A builtin constructor (Map, Set, WeakMap, WeakSet...): a collection object.
    if (o.startsWith("bi:")) { add(out, `coll:${o.slice(3)}#${site}`); return; }
    if (o === "U") { flow(out, "U"); return; }
    if (!o.startsWith("fn:")) { add(out, "U"); return; }
    const obj = `new:${o.slice(3)}`;
    if (!protos.has(obj)) protos.set(obj, field(o, "prototype"));
    add(out, obj);
    const self = node(); add(self, obj);
    call(c, args, self, node(), site);
  });
  /** A method call on a compiled array (the builtins), or through the method's value. */
  const invoke = (fn: string, r: number, method: string, args: number[], out: number, site: string) => {
    if (method === "call" || method === "apply" || method === "bind") {
      // f.call(self, ...args), f.apply(self, array), f.bind(self): the function itself is the callee.
      const self = args[0] ?? prim(node(), "undef");
      if (method === "call") call(r, args.slice(1), self, out, site);
      else if (method === "apply") { const el = node(); if (args[1] !== undefined) load(args[1], ANY, el); call(r, Array.from({ length: 6 }, () => el), self, out, site); }
      else { const b = `bound:${fn}${CTX}#${site}`; bound.set(b, { fnNode: r, self, args: args.slice(1) }); add(out, b); }
    }
    const m = node(); load(r, method, m);
    call(m, args, r, out, site);
    // Builtin methods of compiled receivers, from the builtin table's flow summaries (builtins/table.ts).
    each(r, o => {
      const kind = o.startsWith("arr:") ? "array" : o.startsWith("coll:") ? "collection" : o === "str" ? "string" : o === "num" || o === "int" ? "number" : o === "bool" ? "boolean" : null;
      if (kind === null) return;
      const spec = builtinMethod(kind, method);
      // A method the receiver kind does not have is undefined (the call throws): hint mode drops it.
      if (!spec) { if (opts.sound && kind !== "array") blame(`${kind}:${method}`, out); return; }
      applyFlow(fn, site, method, spec.flow, o, kind === "array" || kind === "collection" ? field(o, ANY) : node(), args, out);
    });
  };
  /** One builtin call's value flow (BuiltinFlow) on receiver object `o` whose elements are `el`. */
  const applyFlow = (fn: string, site: string, method: string, f: BuiltinFlow, o: AbsValue, el: number, args: number[], out: number) => {
    const recv = node(); add(recv, o);
    if (f.copiesFields && args[0] !== undefined) for (const src of args.slice(1)) copyFields(src, args[0]);
    if (f.argsInto !== undefined) for (const a of args.slice(f.argsInto)) edge(a, el);
    if (f.valueArg !== undefined && args[f.valueArg] !== undefined) edge(args[f.valueArg]!, el);
    // reduce: the accumulator holds the initial value, elements and the callback's results.
    const accumulates = f.returns.includes("accumulator") || f.callback?.params.includes("accumulator") === true;
    const acc = accumulates ? node() : -1;
    if (accumulates) { edge(el, acc); if (args[1] !== undefined) edge(args[1], acc); }
    let result = -1;
    const cb = f.callback ? args[f.callback.arg] : undefined;
    if (f.callback && cb !== undefined) {
      const idx = prim(node(), "int");
      const params = f.callback.params.map(p => p === "element" ? el : p === "index" ? idx : p === "receiver" ? recv : p === "accumulator" ? acc : node());
      result = accumulates ? acc : node();
      call(cb, params, null, result, site);
    }
    const put = (v: FlowValue, to: number) => {
      switch (v) {
        case "element": edge(el, to); break;
        case "receiver": add(to, o); break;
        case "callbackResult": if (result >= 0) edge(result, to); break;
        case "accumulator": edge(acc, to); break;
        case "arg0": if (args[0] !== undefined) edge(args[0], to); break;
        default: prim(to, v);
      }
    };
    for (const r of f.returns) {
      if (typeof r !== "object") { put(r, out); continue; }
      const a = `arr:${fn}#${site}.${method}`, items = field(a, ANY);
      add(out, a);
      for (const it of r.fresh) {
        if (typeof it === "object") { for (const x of args.slice(it.args)) { edge(x, items); load(x, ANY, items); } }
        else put(it, items);
      }
    }
  };

  // ── constraint generation ──
  // Site ids are stable per IR node, so a function's clones share its allocation sites.
  let site = 0;
  const sids = new WeakMap<object, number>();
  const sid = (x: object) => { let n = sids.get(x); if (n === undefined) sids.set(x, n = site++); return n; };
  const kids = (fn: string, x: Record<string, unknown>) => {
    for (const k in x) if (k !== "type" && k !== "loc") { const v = x[k]; if (!v || typeof v !== "object") continue;
      for (const y of Array.isArray(v) ? v : [v]) if (y && typeof y === "object" && (y as { kind?: unknown }).kind) { if (STMT.has((y as { kind: string }).kind)) st(fn, y as IrStmt); else ev(fn, y as IrExpr); } }
  };
  function ev(fn: string, x: IrExpr | null | undefined): number {
    if (opts.trace && x) { const e = x as IrExpr & Record<string, unknown>; LABEL = `${fn}:${x.kind}:${String(e["callee"] ?? e["fn"] ?? e["method"] ?? e["localId"] ?? "")}@${(x as { loc?: { start?: number } }).loc?.start ?? ""}`; }
    const out = node();
    if (!x) return prim(out, "undef");
    const e = x as IrExpr & Record<string, unknown>;
    switch (x.kind) {
      case "varRef": edge(readLocal(fn, x.localId), out); return out;
      case "numLit": return prim(out, INT32(x.value) ? "int" : "num");
      case "strLit": return prim(out, "str");
      case "boolLit": return prim(out, "bool");
      case "unitLit": return prim(out, (e["unit"] as string) === "null" ? "null" : "undef");
      case "bin": {
        const op = x.op, l = ev(fn, x.left), r = ev(fn, x.right);
        if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "===" || op === "!==") return prim(out, "bool");
        arith(op, l, r, out); return out;
      }
      case "unary": { const v = ev(fn, x.operand); if (x.op === "!") return prim(out, "bool"); if (x.op === "~") return prim(out, "int"); each(v, k => add(out, k === "int" ? "int" : "num")); return out; }
      case "incDec": {
        // Reads the local, writes it ±1, yields the old or new value: an int stays an int.
        const old = readLocal(fn, x.localId), next = node();
        arith(x.op, old, prim(node(), "int"), next); writeLocal(fn, x.localId, next); edge(x.prefix ? next : old, out); return out;
      }
      case "dynScalarEq": case "strEq": case "strCmp": case "toBool": case "dynTest": case "unionIsTag": case "dynHasKey":
        kids(fn, e); return prim(out, "bool");
      case "strConcat": case "toString": case "strIntrinsic": kids(fn, e); return prim(out, "str");
      case "dynFrom": case "dynCheck": case "unionWrap": case "unionNarrow": case "dynDestrCheck": return ev(fn, (e["value"] ?? e["operand"]) as IrExpr);
      case "arrIntrinsic": { const r = ev(fn, e["receiver"] as IrExpr); invoke(fn, r, String(e["method"]).replace(/Spread$/, ""), ((e["args"] as IrExpr[] | undefined) ?? []).map(y => ev(fn, y)), out, `${sid(x)}`); return out; }
      case "jsOp": return ev(fn, (e["args"] as IrExpr[] | undefined)?.[0]);
      case "assignExpr": { const v = ev(fn, x.value); writeLocal(fn, x.localId, v); edge(v, out); return out; }
      case "ternary": { ev(fn, x.cond); const e0 = new Map(ENV); edge(ev(fn, x.then), out); const e1 = ENV; ENV = e0; edge(ev(fn, x.else_), out); ENV = joinEnv(e1, ENV); return out; }
      case "nullish": { edge(ev(fn, x.left), out); const e0 = new Map(ENV); edge(ev(fn, x.right), out); ENV = joinEnv(e0, ENV); return out; }
      case "logical": { edge(ev(fn, x.left), out); const e0 = new Map(ENV); edge(ev(fn, x.right), out); ENV = joinEnv(e0, ENV); return out; }
      case "seqExpr": { st(fn, e["stmts"] as IrStmt[]); return e["result"] ? ev(fn, e["result"] as IrExpr) : prim(out, "undef"); }
      case "closure": add(out, `fn:${x.fnName}`); return out;
      case "selfRef": add(out, `fn:${fn}`); return out;
      case "dynObjLit": case "recordLit": {
        const o = `lit:${fn}#${sid(x)}`; add(out, o); allocs.set(x, o);
        for (const f of (e["fields"] as { key?: IrExpr; name?: string; value?: IrExpr }[] | undefined) ?? []) {
          const v = ev(fn, f.value);
          const key = f.key?.kind === "strLit" ? f.key.value : f.name;
          if (key !== undefined) { defKey(o, key); (litKeys.get(o) ?? litKeys.set(o, new Set()).get(o)!).add(key); edge(v, field(o, key)); } else { ev(fn, f.key); edge(v, field(o, ANY)); computedWrites.add(o); (litKeys.get(o) ?? litKeys.set(o, new Set()).get(o)!).add(ANY); }
        }
        return out;
      }
      case "dynArrLit": case "arrayLit": { const o = `arr:${fn}#${sid(x)}`; add(out, o); for (const el of ((e["elems"] ?? e["elements"] ?? e["items"]) as (IrExpr | { value: IrExpr })[] | undefined) ?? []) { const y = (el as { value?: IrExpr })?.value ?? el as IrExpr; edge(y && (y as { kind?: string }).kind ? ev(fn, y) : prim(node(), "undef"), field(o, ANY)); } return out; }
      case "dynKeyGet": { const r = ev(fn, x.value); const k = keyOf(x.key); if (x.key.kind !== "strLit") ev(fn, x.key); load(r, k, out); noteReceiver(x, r, k); narrow(fn, x.value, r, k); return out; }
      case "libCall": return libCall(fn, x, out);
      case "call": return callExpr(fn, x, out);
      case "dynInvoke": { const r = ev(fn, x.recv); invoke(fn, r, x.method, x.args.map(a => ev(fn, a)), out, `${sid(x)}`); noteReceiver(x, r, x.method); narrow(fn, x.recv, r, x.method); return out; }
      case "dynCall": case "callValue": {
        const c = ev(fn, x.callee), self = e["receiver"] ? ev(fn, e["receiver"] as IrExpr) : null;
        // A spread argument (`f(...xs)`) supplies its elements to every parameter from its position on.
        const spreads = new Set(((e["spreads"] as { arg: number }[] | undefined) ?? []).map(sp => sp.arg));
        const args: number[] = [];
        x.args.forEach((y, i) => { const n = ev(fn, y); if (!spreads.has(i)) { args.push(n); return; } const el = node(); load(n, IDX, el); for (let k = 0; k < 6; k++) args.push(el); });
        call(c, args, self, out, `${sid(x)}`); return out;
      }
      case "jsMarshal": case "jsExit": { const v = ev(fn, (e["value"] ?? (e["args"] as IrExpr[] | undefined)?.[0]) as IrExpr); edge(v, ESC); fromPage(out); return out; }
      case "dynFromJsval": return jsop(fn, e["value"] as IrExpr, out);
      case "caughtToDyn": kids(fn, e); edge(THROWN, out); fromPage(out); return out;
      case "arrayState": kids(fn, e); return prim(out, "int");
      case "arrayHas": case "caughtTest": kids(fn, e); return prim(out, "bool");
      // await: a compiled value as it stands (a non-thenable), or whatever a page promise settles to.
      case "awaitExpr": edge(ev(fn, x.value), out); fromPage(out); return out;
      case "arrayGet": { const r = ev(fn, e["arr"] as IrExpr); ev(fn, e["index"] as IrExpr); load(r, ANY, out); return out; }
      case "regexLit": case "regexIntrinsic": kids(fn, e); add(out, `lit:${fn}#${sid(x)}`); return prim(out, "str");
      default: kids(fn, e); blame(`expr:${x.kind}`, out); return out;
    }
  }
  /** Page operations: a page global (unless compiled code wrote it) and a page constructor's result are page objects alone. */
  const globalsWritten = new Map<string, number>();
  function jsop(fn: string, x: IrExpr | undefined, out: number): number {
    if (!x) { fromPage(out); return out; }
    const e = x as IrExpr & Record<string, unknown>;
    if (x.kind === "jsMarshal") { const v = ev(fn, e["value"] as IrExpr); edge(v, ESC); edge(v, out); return out; }
    if (x.kind !== "jsOp") { edge(ev(fn, x), out); return out; }
    const args = ((e["args"] as IrExpr[] | undefined) ?? []).map(a => { const n = node(); jsop(fn, a, n); return n; });
    const first = (e["args"] as IrExpr[] | undefined)?.[0];
    switch (e["op"]) {
      case "globalGet": { add(out, `H:g:${String(e["name"])}`); const g = globalsWritten.get(e["name"] as string); if (g !== undefined) edge(g, out); return out; }
      case "globalSet": { let g = globalsWritten.get(e["name"] as string); if (g === undefined) globalsWritten.set(e["name"] as string, g = node()); for (const a of args) { edge(a, g); edge(a, ESC); } return out; }
      case "construct": for (const a of args.slice(1)) edge(a, ESC); add(out, `H:new#${sid(x)}`); if (first?.kind !== "jsOp") fromPage(out); return out;
      case "getProp": if (first?.kind === "jsOp" && (first as IrExpr & Record<string, unknown>)["op"] === "globalGet") { add(out, `H:g:${String((first as IrExpr & Record<string, unknown>)["name"])}.${String(e["name"] ?? "?")}`); return out; } fromPage(out); return out;
      default: for (const a of args) edge(a, ESC); fromPage(out); return out;
    }
  }
  function libCall(fn: string, x: IrExpr & { kind: "libCall" }, out: number): number {
    const a = x.args.map(y => ev(fn, y));
    switch (x.fn) {
      case "dyn.this": edge(thisOf(fn, CTX), out); return out;
      case "dyn.keySet": store(a[0]!, x.args[1]?.kind === "strLit" ? x.args[1].value : ANY, a[2]!); return prim(out, "undef");
      case "dyn.newCollection": add(out, `coll:${x.args[0]?.kind === "strLit" ? x.args[0].value : "?"}#${sid(x)}`); return out;
      case "error.new": case "error.newOptions": add(out, `lit:${fn}#${sid(x)}`); return out;
      case "dyn.add": {
        // Two numbers add; anything else (a string, an object's ToPrimitive) may concatenate.
        arith("+", a[0]!, a[1]!, out);
        for (const n of [a[0]!, a[1]!]) each(n, v => { if (v !== "int" && v !== "num" && v !== "bool" && v !== "null" && v !== "undef") add(out, "str"); });
        return out;
      }
      case "dyn.bitwise": return prim(out, "int");
      case "dyn.arithmetic": { const op = x.args[2]?.kind === "strLit" ? x.args[2].value : "/"; arith(op, a[0]!, a[1]!, out); return out; }
      case "dyn.increment": arith("+", a[0]!, prim(node(), "int"), out); return out;
      case "dyn.toNumeric": each(a[0]!, v => add(out, v === "int" ? "int" : "num")); return out;
      case "dyn.compare": return prim(out, "bool");
      case "dyn.typeof": case "dyn.toStringCoerce": return prim(out, "str");
      case "sym.for": return prim(out, "sym");
      case "dyn.propertyKey": add(out, "str"); return prim(out, "sym");
      case "dyn.objKeys": { const o = `arr:${fn}#${sid(x)}`; add(out, o); prim(field(o, ANY), "str"); return out; }
      case "dyn.builtinMethod": case "dyn.builtinFunction": { const ns = x.args[0]?.kind === "strLit" ? x.args[0].value : "?", nm = x.args[1]?.kind === "strLit" ? x.args[1].value : "?"; add(out, `bi:${ns}.${nm}`); return out; }
      case "dyn.assign": edge(a[0]!, out); for (const src of a.slice(1)) copyFields(src, a[0]!); return out;
      case "dyn.keySetComputed": store(a[0]!, keyOf(x.args[1]), a[2]!); return prim(out, "undef");
      case "dyn.arrayIndexSet": store(a[0]!, ANY, a[2]!); return prim(out, "undef");
      case "dyn.typedArrayIndexSet": return prim(out, "undef");
      case "dyn.defineProperty": { const v = node(); load(a[2]!, "value", v); const g = node(); load(a[2]!, "get", g); call(g, [], a[0]!, v, `${sid(x)}`); store(a[0]!, x.args[1]?.kind === "strLit" ? x.args[1].value : ANY, v); edge(a[0]!, out); return out; }
      case "dyn.arrayIndexGet": case "dyn.arrayIteratorAt": load(a[0]!, IDX, out); return out;
      case "dyn.typedArrayIndexGet": return prim(out, "num");
      case "dyn.stringIndexGet": case "dyn.stringConstructor": return prim(out, "str");
      case "dyn.forInKeys": { const o = `arr:${fn}#${sid(x)}`; add(out, o); prim(field(o, ANY), "str"); return out; }
      case "dyn.copyDataProperties": edge(a[0]!, out); copyFields(a[1]!, a[0]!); return out;
      case "dyn.packPushSpread": { const el = node(); load(a[1]!, ANY, el); store(a[0]!, ANY, el); edge(a[0]!, out); return out; }
      case "dyn.setPrototype": edge(a[0]!, out); return out;
      // A constructed object's prototype is its constructor's `prototype` value; anything else's is a page object (Object.prototype and friends).
      case "dyn.getPrototype": each(a[0]!, o => { const p = protos.get(o); if (p !== undefined) edge(p, out); else if (!opaque(o) || isPage(o)) add(out, "H"); }); return out;
      case "regex.new": add(out, `lit:${fn}#${sid(x)}`); return out;
      case "dyn.getOwnPropertyDescriptor": {
        // A page object's descriptor is the page's; a compiled object's is a fresh { value, get, set, ... }.
        const k = x.args[1]?.kind === "strLit" ? x.args[1].value : ANY, d = `lit:${fn}#desc${sid(x)}`;
        each(a[0]!, o => { if (isPage(o)) add(out, "H"); else if (!opaque(o)) { add(out, d); prim(out, "undef"); } });
        load(a[0]!, k, field(d, "value")); defKey(d, "value"); for (const f of ["writable", "enumerable", "configurable"]) { defKey(d, f); prim(field(d, f), "bool"); }
        return out;
      }
      case "dyn.objectPrototype": add(out, "H:g:Object.prototype"); return out;
      case "error.nodeThrow": return out; // throws
      case "dyn.assignAll": { edge(a[0]!, out); const src = node(); load(a[1]!, ANY, src); copyFields(src, a[0]!); return out; }
      case "dyn.arrayCtor": { const o = `arr:${fn}#${sid(x)}`; add(out, o); prim(field(o, ANY), "undef"); return out; }
      case "sym.wellKnown": return prim(out, "sym");
      case "dyn.arrayPatternElement": load(a[0]!, ANY, out); prim(out, "undef"); return out;
      case "dyn.construct": { const el = node(); if (a[1] !== undefined) load(a[1], ANY, el); construct(a[0]!, Array.from({ length: 6 }, () => el), out, `${sid(x)}`); return out; }
      case "dyn.iterator": { const o = `lit:${fn}#iter${sid(x)}`; add(out, o); defKey(o, "value"); defKey(o, "done"); load(a[0]!, ANY, field(o, "value")); prim(field(o, "done"), "bool"); edge(nn(`IT|${o}`), out); return out; }
      case "dyn.iteratorResult": edge(a[0]!, out); return out;
      case "dyn.isPristineArrayIterable": case "num.isNaN": case "dyn.keyDelete": case "dyn.keyDeleteComputed": if (x.fn.startsWith("dyn.keyDelete")) each(a[0]!, o => { if (!opaque(o) && takes(o, ANY)) computedWrites.add(o); }); return prim(out, "bool");
      case "num.toStringRadix": case "str.encodeUriComponent": case "string.fromCharCode": case "error.toString": case "dyn.toString": return prim(out, "str");
      case "date.now": case "perf.now": return prim(out, "num");
      case "dyn.arrLen": return prim(out, "int");
      case "dyn.hasKey": case "dyn.hasKeyComputed": case "dyn.isArrayIndex": case "dyn.isTypedArrayIndex": case "dyn.isStringIndex": case "dyn.isArrayStoreIndex": case "bytes.instanceOf": case "dyn.abstractEq": return prim(out, "bool");
      default:
        if (x.fn.startsWith("math.")) {
          const f = x.fn.slice(5).toLowerCase();
          if (f === "max" || f === "min") { for (const n of a) each(n, v => add(out, v === "int" ? "int" : "num")); if (!a.length) add(out, "num"); return out; }
          return prim(out, INT_MATH.has(f) ? "int" : "num");
        }
        blame(`lib:${x.fn}`, out); return out;
    }
  }
  function callExpr(fn: string, x: IrExpr & { kind: "call" }, out: number): number {
    const a = x.args.map(y => ev(fn, y));
    const d = dispatch.get(x.callee);
    if (d) { if (d.write && a.length === 2) { store(a[0]!, d.key, a[1]!); prim(out, "undef"); noteReceiver(x, a[0]!, d.key); } else { load(a[0]!, d.key, out); noteReceiver(x, a[0]!, d.key); } if (x.args[0]) narrow(fn, x.args[0], a[0]!, d.key); return out; }
    if (x.callee === "%dyn.class.properties") { edge(a[0]!, out); return out; }
    if (/^%class\.construct:\d+$/.test(x.callee)) { construct(a[0]!, a.slice(1), out, `${sid(x)}`); return out; }
    if (computedWriters.has(x.callee)) { const k = keyOf(x.args[1]); store(a[0]!, k, a[a.length - 1]!); noteReceiver(x, a[0]!, k); return prim(out, "undef"); }
    if (x.callee === "%dyn.class.index.get" || x.callee.startsWith("%dyn.class.computed.")) { const k = x.callee === "%dyn.class.index.get" ? IDX : keyOf(x.args[1]); load(a[0]!, k, out); noteReceiver(x, a[0]!, k); return out; }
    if (x.callee === "%dyn.class.index.set") { store(a[0]!, ANY, a[a.length - 1]!); return prim(out, "undef"); }
    if (fns.has(x.callee)) { callFn(x.callee, a, null, out, `${sid(x)}`, true); return out; }
    blame(`call:${x.callee.replace(/\d+/g, "N")}`, out); return out;
  }
  const STMT = new Set(["varDecl", "return", "exprStmt", "throw", "if", "block", "for", "forOf", "while", "doWhile", "switch", "break", "continue", "tryCatch", "labeled", "assign"]);
  function st(fn: string, s: IrStmt | IrStmt[] | null | undefined): void {
    if (!s) return;
    if (Array.isArray(s)) { for (const y of s) st(fn, y); return; }
    const o = s as IrStmt & Record<string, unknown>;
    switch (s.kind) {
      case "varDecl": writeLocal(fn, s.localId, s.init ? ev(fn, s.init) : prim(node(), "undef")); return;
      case "assign": writeLocal(fn, s.localId, ev(fn, s.value)); return;
      case "return": if (s.value) edge(ev(fn, s.value), ret(fn, CTX)); else add(ret(fn, CTX), "undef"); endPath(); return;
      case "exprStmt": ev(fn, s.expr); return;
      case "throw": edge(ev(fn, o["value"] as IrExpr), THROWN); endPath(); return;
      case "block": st(fn, o["body"] as IrStmt[]); return;
      case "if": { ev(fn, o["cond"] as IrExpr); const e0 = new Map(ENV); st(fn, o["then"] as IrStmt[]); const e1 = ENV; ENV = e0; st(fn, o["else_"] as IrStmt[]); ENV = joinEnv(e1, ENV); return; }
      case "for": st(fn, o["init"] as IrStmt); region(fn, s, () => { if (o["cond"]) ev(fn, o["cond"] as IrExpr); st(fn, o["body"] as IrStmt[]); if (o["update"]) { const u = o["update"] as IrStmt | IrExpr; if (STMT.has(u.kind)) st(fn, u as IrStmt); else ev(fn, u as IrExpr); } }); return;
      case "while": case "doWhile": region(fn, s, () => { if (o["cond"]) ev(fn, o["cond"] as IrExpr); st(fn, o["body"] as IrStmt[]); }); return;
      case "forOf": { const it = ev(fn, o["iterable"] as IrExpr); region(fn, s, () => { const el = node(); load(it, ANY, el); writeLocal(fn, o["localId"] as string, el); st(fn, o["body"] as IrStmt[]); }); return; }
      case "switch": {
        // Each case starts from the state before the switch, joined with the previous case's end (fall-through).
        ev(fn, o["disc"] as IrExpr); const e0 = new Map(ENV);
        region(fn, s, () => { let prev: Map<string, number> | null = null; for (const c of (o["cases"] as { test?: IrExpr; body?: IrStmt[]; stmts?: IrStmt[] }[]) ?? []) { ENV = prev ? joinEnv(new Map(e0), prev) : new Map(e0); if (c.test) ev(fn, c.test); st(fn, c.body ?? c.stmts); prev = ENV; } }, true);
        return;
      }
      case "tryCatch": region(fn, s, () => { st(fn, o["tryBody"] as IrStmt[]); if (o["catchLocalId"]) { const u = node(); edge(THROWN, u); fromPage(u); writeLocal(fn, o["catchLocalId"] as string, u); } st(fn, o["catchBody"] as IrStmt[]); st(fn, o["finallyBody"] as IrStmt[]); }); return;
      case "break": case "continue": for (const f of REGIONS) f(); endPath(); return;
      default: kids(fn, o);
    }
  }
  /** Generate a function's constraints for one context (its shared instance, or a clone), from any point of generation or solving. */
  function generate(f: IrFunction, ctx: string): void {
    const saved = { ENV, REGIONS, CTX, LABEL };
    ENV = new Map(); REGIONS = []; CTX = ctx;
    for (const p of f.params) if (sensitive(f.name, p.localId)) ENV.set(p.localId, param(f.name, f.params.indexOf(p), ctx)!);
    st(f.name, f.body);
    if (!f.body.length || f.body[f.body.length - 1]?.kind !== "return") add(ret(f.name, ctx), "undef");
    ({ ENV, REGIONS, CTX, LABEL } = saved);
  }
  /** A small function's clone for call site `cs` (generated on first use): its context string. */
  const instances = new Set<string>();
  function instance(fn: string, cs: string): string {
    const ctx = `@${cs}`;
    if (!instances.has(fn + ctx)) { instances.add(fn + ctx); generate(fns.get(fn)!, ctx); }
    return ctx;
  }
  /** Small enough to clone per call site: at most SMALL IR nodes, not a dispatcher or runtime helper. */
  const SMALL = opts.cloneLimit ?? 0;
  const smallMemo = new Map<string, boolean>();
  function small(fn: string): boolean {
    let r = smallMemo.get(fn);
    if (r === undefined) {
      let n = 0;
      const w = (y: unknown): void => { if (n > SMALL || !y || typeof y !== "object") return; if (Array.isArray(y)) { for (const z of y) w(z); return; } const o = y as Record<string, unknown>; if (o["kind"]) n++; for (const k in o) if (k !== "type" && k !== "loc") w(o[k]); };
      w(fns.get(fn)!.body);
      smallMemo.set(fn, r = SMALL > 0 && n <= SMALL && !fn.startsWith("%dyn."));
    }
    return r;
  }
  for (const f of mod.functions) generate(f, "");
  // Closures that reached the page are called by it; exported functions too.
  call(ESC, Array.from({ length: 8 }, () => opts.sound ? ESC : PAGE), opts.sound ? ESC : PAGE, ESC);
  for (const f of mod.functions) if (!parent.has(f.name) && !f.name.startsWith("%")) f.params.forEach((_, i) => { const p = param(f.name, i); if (p !== null) edge(opts.sound ? ESC : PAGE, p); });

  // ── solve ──
  while (queue.length) {
    const n = queue.pop()!, d = delta[n]!; delta[n] = undefined;
    for (const t of succ[n]!) for (const i of d) flowI(t, i);
    const fs = subs[n]!, m = fs.length; // subscribers added meanwhile already saw these values
    if (m) for (const i of d) { const v = vals[i]!; for (let k = 0; k < m; k++) fs[k]!(v); }
  }
  const nameOf = new Map([...named].map(([k, n]) => [n, k]));
  let pred: Map<number, number[]> | undefined, predOpaque: Map<number, number[]> | undefined;
  const explain = (fn: string, index: number, value: AbsValue): string[] => { const start = param(fn, index); return start === null ? [] : explainNode(start, value); };
  const explainNode = (start: number, value: AbsValue): string[] => chainOf(start, value).map(n => nameOf.get(n) ?? labels[n] ?? `#${n}`);
  const chainOf = (start: number, value: AbsValue): number[] => {
    // Receiver-to-result links carry only what passes through a read or call unchanged: unmodeled and page values.
    if (!pred) { const p = pred = new Map<number, number[]>(); succ.forEach((ss, a) => ss.forEach(b => { (p.get(b) ?? p.set(b, []).get(b)!).push(a); })); predOpaque = new Map([...p].map(([k, v]) => [k, [...v, ...(derived.get(k) ?? [])]])); for (const [k, v] of derived) if (!predOpaque.has(k)) predOpaque.set(k, v); }
    const P = value === "U" || isPage(value) ? predOpaque! : pred;
    const seen = new Map<number, number>([[start, -1]]), q = [start]; let hit = -1;
    const birth = born.get(value);
    while (q.length) { const n = q.shift()!; if (birth?.has(n)) { hit = n; break; } const ps = (P.get(n) ?? []).filter(p => hasV(p, value)); if (n !== start && !ps.length) { hit = n; break; } for (const p of ps) if (!seen.has(p)) { seen.set(p, n); q.push(p); } }
    const chain: number[] = []; for (let n = hit; n !== -1 && n !== undefined; n = seen.get(n)!) chain.push(n);
    return chain;
  };
  /** Can a read of `k` on `o` find a value (own, computed, or inherited)? Opaque values, arrays, collections and functions are kept. */
  const hasKey = (o: AbsValue, k: string): boolean => {
    if (opaque(o) || o.startsWith("bi:")) return true;
    if (o.startsWith("coll:") && (COLLECTION_KEYS.has(k) || opts.sound)) return true;
    if ((o.startsWith("fn:") || o.startsWith("bound:")) && (FUNCTION_KEYS.has(k) || opts.sound)) return true;
    if (o.startsWith("arr:") && (k === "length" || /^\d+$/.test(k) || ARRAY_METHODS.has(k) || opts.sound)) return true;
    // Hint mode: computed writes do not reach named reads (see load), so they do not count here either.
    const has = (x: AbsValue) => defKeys.get(x)?.has(k) || (opts.sound && computedWrites.has(x));
    if (has(o)) return true;
    const p = protos.get(o);
    return p !== undefined && valuesOf(p).some(po => opaque(po) || has(po));
  };
  const union = (ns: number[]) => new Set(ns.flatMap(valuesOf));
  // Shapes: initializer keys plus keys stored where one object is the only possible receiver.
  const shapes = new Map<AbsValue, Set<string>>();
  const shapeKey = (o: AbsValue, k: string) => { let ks = shapes.get(o); if (!ks) shapes.set(o, ks = new Set()); ks.add(k); };
  for (const [o, ks] of litKeys) for (const k of ks) shapeKey(o, k);
  // Definite: the receiver set is that one object (null and undefined aside; a page or unmodeled value
  // beside it makes the store indefinite, e.g. a DOM node's expando through a set the merge widened).
  const single = (n: number) => { const objs = valuesOf(n).filter(o => o !== "null" && o !== "undef"); return objs.length === 1 && !opaque(objs[0]!) ? objs[0]! : null; };
  for (const [r, k] of storeSites) { const o = single(r); if (o) shapeKey(o, k); }
  for (const [src, dst, k] of copySites) { const o = single(dst); if (o && single(src)) shapeKey(o, k); }
  if (shapeOf) for (const [o, ks] of shapeOf) for (const k of ks) shapeKey(o, k);
  return {
    shapes,
    keyed: new Map([...readKeys].map(([x, k]) => [x, new Set([...union(receivers.get(x)!)].filter(o => hasKey(o, k)))])),
    ...(opts.trace ? { explainNamed: (name: string, value: AbsValue) => { const n = named.get(name); return n === undefined ? [] : explainNode(n, value); }, mergePoint: (x: IrExpr, a: AbsValue, b: AbsValue) => {
      // Along a's chain into the site, the first node that also holds b, with the node before it.
      for (const r of receivers.get(x) ?? []) { if (!hasV(r, a) || !hasV(r, b)) continue; const c = chainOf(r, a); const i = c.findIndex(n => hasV(n, b)); if (i >= 0) return c.slice(Math.max(0, i - 1), i + 1).map(n => nameOf.get(n) ?? labels[n] ?? `#${n}`); }
      return [];
    }, explain, explainReceiver: (x: IrExpr, value: AbsValue) => (receivers.get(x) ?? []).flatMap(n => hasV(n, value) ? [explainNode(n, value)] : []).sort((a, b) => a.length - b.length)[0] ?? [] } : {}),
    receivers: new Map([...receivers].map(([k, ns]) => [k, union(ns)])),
    fieldValues: (o, k) => { const n = named.get(`F|${o}|${k}`); return new Set(n === undefined ? [] : valuesOf(n)); },
    allocs,
    params: fn => (fns.get(fn)?.params ?? []).map((_, i) => { const p = param(fn, i); return p === null ? new Set<AbsValue>() : new Set(valuesOf(p)); }),
    unknown,
    computedWrites,
  };
}

/** A receiver set that is exactly objects of one constructor (allowing null/undefined): that constructor's fn name, else null. */
export function singleConstructor(set: ReadonlySet<AbsValue>, hint = false): string | null {
  let ctor: string | null = null;
  for (const v of set) {
    if (v === "null" || v === "undef") continue;
    // Hint mode (guarded consumers): unmodeled, page and primitive values do not count against a constructor.
    if (hint && opaque(v)) continue;
    if (!v.startsWith("new:")) return null;
    if (ctor !== null && ctor !== v) return null;
    ctor = v;
  }
  return ctor === null ? null : ctor.slice(4);
}
