/* Constructor structs (experimentalJsConstructorStructs, off by default).
 *
 * Objects that a recognized JS constructor builds are WasmGC structs with one
 * field per property the constructor assigns, instead of {shape, slots}
 * objects whose every property lives in a boxed slot array:
 *
 *   function FiberNode(tag, key) { this.tag = tag; this.key = key; this.flags = 0; ... }
 *
 * Recognized: an ordinary function (it owns a prototype) whose body starts
 * with straight-line statements that assign constant, distinct, non-index
 * property names on `this` (chained `this.a = this.b = v` included; the put
 * order is JS evaluation order), where `this` is never read as a value, no
 * closure is created and every other statement is an expression statement.
 * Such a prefix cannot let `this` escape, so nothing outside the
 * constructor can observe the object between its puts. The struct is
 * complete at the end of the prefix. Any statements after it (the put
 * prefix's remainder) run unchanged on the complete struct; they may read
 * `this`'s properties, write the prefix's properties and `return this`, but
 * a remainder that does anything else with `this` (passes it on, adds,
 * deletes or computes a key) would convert every object, so such a
 * constructor stays ordinary.
 *
 * Representation: `$ctor.F` is a final subtype of dyn:obj {shape, slots,
 * proto, js} with the properties as extra fields: an i32 for a property the
 * constructor initializes with an int32 constant (flag and lane words), or
 * one the site profile's field representations show only ever held Smis
 * (a property set from a parameter: a tag or mode), unless some constant-key
 * write in the program stores another literal kind under that name; anyref
 * otherwise. Its
 * object carries a shape of its own: S_F^k (k = 0..n) lists the first k
 * properties and is flagged SHAPE_DICT = 2 ("struct"), so
 * no inline cache ever stores it and every generic path that reaches such an
 * object reads the fields (dyn-object.ts). Anything the fields cannot
 * represent (a new key, a delete, an attribute change, a value an i32 field
 * cannot hold) first converts the object in place to an ordinary object
 * (dyn-object demote: the generic shape for its keys, a slot array filled
 * from the fields), after which only the generic paths apply. JS semantics
 * are those of the generic object in every case: key order, `in`,
 * enumeration, prototypes, facades.
 *
 * Fast paths (emitter): a per-constructor global `$ctor.F.clean` stays 1
 * until any object of F converts. While it is 1 every reachable struct of F
 * is complete (S_F^n), so a property site tests that global and `ref.test
 * $F`, then reads or writes the field: as profile-site arms for receivers
 * whose profiled layout is F's property list, and in every constant-key dyn
 * read and write (so in every class-property dispatcher). The dispatchers,
 * which every site falls back to, test the object's own shape once the flag
 * is 0, so a conversion costs the other objects of F their inline paths
 * only. An i32 field also feeds bitwise operators, `o.k op= y` compound
 * updates, writes of int values (f64 expressions, int-shadowed locals,
 * another i32 field), `===` against numbers and switch labels unboxed (see
 * int-shadow.ts for int-valued locals).
 *
 * Allocation: `new F(...)` (the dyn construct helpers) allocates the struct
 * at S_F^0 when F's prototype chain has no accessor for any of F's
 * properties (else a setter would take the put) and F's conversions are
 * not a learned share of its allocations (dyn-object CTOR_DEMOTION_SHARE). The constructor body then writes the
 * fields directly and sets S_F^n at its end; a body entered with any other
 * `this` (F.call(obj), a call without new, a subclass via the prototype
 * chain) runs the unchanged generic puts.
 *
 * Literal layouts (experimentalJsLiteralStructs, with a site profile): the object
 * literals with one list of distinct constant keys share a struct of their own,
 * entered here as a constructor without a function (`literal` lists its sites),
 * when the profile saw plain objects of that layout (a counted profile: at
 * least `minHits` guard hits; the emitter asks 1000). The literal allocates the struct complete (S_L^n, the default
 * prototype) with its values: a literal defines its properties, so no setter
 * on the prototype chain can take them and no accessor check applies. A
 * value an i32 field cannot hold builds the ordinary object instead. From
 * there everything is a constructor struct's: the fields, the clean flag,
 * conversion on anything the fields cannot represent; a layout stops
 * allocating structs once more than DICT_LIMIT of its objects converted.
 *
 * Diagnostics: SCRIPTC_WASMGC_CTOR_REPORT=1 lists the recognized
 * constructors (=2 also the candidates that stay ordinary);
 * SCRIPTC_WASMGC_CTOR_ANY=1 keeps every field anyref (A/B);
 * SCRIPTC_WASMGC_CTOR_NOREPS=1 ignores the profile's field representations.
 * In dev builds (and release builds with SCRIPTC_WASMGC_CTOR_COUNT=1) each
 * fast-path hit calls an empty function that tests/wasmgc-browser/fnprobe.mjs
 * (the gate's @hits) can count. */
import type { IrExpr, IrFunction, IrModule, IrStmt } from "../../ir/ir.js";

export type CtorFieldKind = "any" | "i32" | "f64";

export interface CtorPut {
  ctor: CtorStruct;
  /** The field this put writes (its position in the constructor's put order). */
  field: number;
  /** The RHS can run user code (a call, a getter, ToPrimitive): an accessor may
   * be defined meanwhile, so the put rechecks the accessor epoch first. */
  effectful: boolean;
  /** The RHS's value when it is a number constant (`this.flags = 0`, chains included). */
  constant?: number;
}

export interface CtorStruct {
  /** The IR function (constructor). */
  fn: string;
  /** Type-name key (unique, symbol-safe). */
  key: string;
  /** `profiled`: typed from the site profile's field representations (else from the constructor's constant). */
  fields: { name: string; kind: CtorFieldKind; profiled?: boolean }[];
  /** Every this-put call node in the body, by identity. */
  puts: Map<IrExpr, CtorPut>;
  /** A literal layout's struct: the object literals that allocate it (no constructor function). */
  literal?: IrExpr[];
  /** The body statements before this index are the puts; the struct is
   * complete (S_C^n) from there on, and the statements after it (a put
   * prefix's remainder, or a trailing bare return) run unchanged. */
  prefix: number;
}

/** Keys a dispatcher call writes: `%dyn.class.property.N(recv, value)` whose
 * body is `dyn.keySet(normalize(recv), "<key>", value); return` (the shape
 * profile-guided writes also match). Null for anything else. */
export function keySetDispatcherKey(callee: IrFunction | undefined, readsThis: ReadonlySet<string>): string | null {
  if (!callee || !callee.name.startsWith("%dyn.class.property.") || readsThis.has(callee.name) || callee.params.length !== 2) return null;
  const body = callee.body, tail = body[body.length - 1], prev = body[body.length - 2];
  if (tail?.kind !== "return" || tail.value) return null;
  if (prev?.kind !== "exprStmt" || prev.expr.kind !== "libCall" || prev.expr.fn !== "dyn.keySet") return null;
  const key = prev.expr.args[1];
  return key?.kind === "strLit" ? key.value : null;
}

/** Kinds that can neither run user code nor throw. */
const INERT_KINDS = new Set(["numLit", "strLit", "boolLit", "unitLit", "varRef", "dynFrom"]);
const CANONICAL_INDEX = /^(0|[1-9][0-9]*)$/;
const MAX_FIELDS = 64;

/** An int32 that is not -0 (an i32 field's value space). */
export const isInt32 = (v: number): boolean => Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31 && !Object.is(v, -0);

/** `typedFields`: number-only properties get i32 fields (else every field is anyref).
 * `fieldReps` (a site profile): V8's representations of each field of an
 * object layout; a field every profiled object of the constructor's full
 * layout held as a Smi is an i32 field too (a tag or mode set from a
 * parameter). The guard is the same as for a constant-typed
 * field: a value the field cannot hold converts the object first. */
export function findConstructorStructs(mod: IrModule, readsThis: ReadonlySet<string>, reachable: ReadonlySet<string>, typedFields = true,
  fieldReps?: (fields: readonly string[]) => ReadonlyMap<string, ReadonlySet<string>>,
  literals?: { hits: (fields: readonly string[]) => number; minHits: number },
  /** Points-to facts: whether every value of a field (of these literal sites, or of a constructor's objects) is an int32. */
  ints?: { literal: (sites: readonly IrExpr[], key: string) => boolean; ctor: (fn: string, key: string) => boolean }): CtorStruct[] {
  const functions = new Map(mod.functions.map(f => [f.name, f]));
  const out: CtorStruct[] = [];
  const nonInt = typedFields ? nonInt32Keys(mod, reachable, functions, readsThis) : new Set<string>();
  for (const f of mod.functions) {
    if (!reachable.has(f.name) || !f.ownsPrototype || f.async || f.generator || !readsThis.has(f.name)) continue;
    const c = recognize(f, functions, readsThis, typedFields, nonInt);
    // SCRIPTC_WASMGC_CTOR_REPORT=2: the constructor candidates that stay ordinary.
    if (!c && typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_CTOR_REPORT"] === "2") console.error(`ctor-ordinary: ${f.name} (${f.body.length} statements)`);
    if (!c) continue;
    c.key = `${out.length}`;
    if (typedFields && fieldReps) {
      const reps = fieldReps(c.fields.map(x => x.name));
      for (const field of c.fields) {
        const r = reps.get(field.name);
        if (field.kind === "any" && r?.size === 1 && r.has("s") && !nonInt.has(field.name)) { field.kind = "i32"; field.profiled = true; }
      }
    }
    // The analysis's int32-only fields (per object, not per property name: nonInt does not apply).
    if (typedFields && ints) for (const field of c.fields) if (field.kind === "any" && ints.ctor(f.name, field.name)) { field.kind = "i32"; field.profiled = true; }
    out.push(c);
  }
  if (literals) for (const c of literalLayouts(mod, reachable, typedFields, nonInt, fieldReps, literals, ints)) { c.key = `${out.length}`; out.push(c); }
  return out;
}

/** Literal layouts (see the header): object literals grouped by their key list. */
function literalLayouts(mod: IrModule, reachable: ReadonlySet<string>, typedFields: boolean, nonInt: ReadonlySet<string>,
  fieldReps: ((fields: readonly string[]) => ReadonlyMap<string, ReadonlySet<string>>) | undefined, literals: { hits: (fields: readonly string[]) => number; minHits: number },
  ints?: { literal: (sites: readonly IrExpr[], key: string) => boolean }): CtorStruct[] {
  const groups = new Map<string, { keys: string[]; sites: (IrExpr & { kind: "dynObjLit" })[] }>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { for (const x of node) visit(x); return; }
    if (!node || typeof node !== "object") return;
    const e = node as IrExpr;
    if (e.kind === "dynObjLit" && e.fields?.length) {
      const keys = e.fields.map(f => f.key.kind === "strLit" ? f.key.value : null);
      if (keys.every((k): k is string => k !== null && k !== "__proto__" && !CANONICAL_INDEX.test(k)) && new Set(keys).size === keys.length && keys.length <= MAX_FIELDS) {
        const id = keys.join("\0"), g = groups.get(id);
        if (g) g.sites.push(e); else groups.set(id, { keys, sites: [e] });
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") visit(v);
  };
  for (const f of mod.functions) if (reachable.has(f.name)) visit(f.body);
  const out: CtorStruct[] = [];
  const intConst = (e: IrExpr): boolean | null => e.kind === "dynFrom" ? intConst(e.value) : e.kind === "numLit" ? isInt32(e.value)
    : e.kind === "strLit" || e.kind === "boolLit" || e.kind === "unitLit" || e.kind === "dynObjLit" || e.kind === "dynArrLit" || e.kind === "closure" ? false : null;
  for (const { keys, sites } of groups.values()) {
    if (literals.hits(keys) < literals.minHits) continue;
    const reps = fieldReps?.(keys);
    const fields = keys.map((name, j) => {
      // i32: every site's value is an int32 constant, or V8 only ever saw Smis in the field; never when
      // some site stores another literal kind, or some constant-key write in the program does.
      const kinds = sites.map(e => intConst(e.fields![j]!.value));
      const r = reps?.get(name);
      const int = typedFields && !kinds.includes(false) && (!nonInt.has(name) && (kinds.every(k => k === true) || r?.size === 1 && r.has("s")) || ints?.literal(sites, name) === true);
      return int ? { name, kind: "i32" as const, ...(kinds.every(k => k === true) ? {} : { profiled: true }) } : { name, kind: "any" as const };
    });
    out.push({ fn: `%literal(${keys.join(",")})`, key: "", fields, puts: new Map(), prefix: 0, literal: sites });
  }
  return out;
}

/** Property names some constant-key write in the program stores a literal
 * no i32 field holds under (a fraction, a string, a boolean, null or
 * undefined, an object, array or function): an int32-initialized property
 * of that name would demote its object at that write, so its field is
 * anyref from the start. Unknown values (reads, calls) do not count: they
 * are usually the same kind (React's `a.lanes = b.lanes`). */
function nonInt32Keys(mod: IrModule, reachable: ReadonlySet<string>, functions: Map<string, IrFunction>, readsThis: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const literal = (e: IrExpr): boolean => {
    if (e.kind === "dynFrom") return literal(e.value);
    if (e.kind === "numLit") return !isInt32(e.value);
    return e.kind === "strLit" || e.kind === "boolLit" || e.kind === "unitLit" || e.kind === "dynObjLit" || e.kind === "dynArrLit" || e.kind === "closure";
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { for (const x of node) visit(x); return; }
    if (!node || typeof node !== "object") return;
    const e = node as IrExpr;
    if (e.kind === "libCall" && e.fn === "dyn.keySet" && e.args[1]?.kind === "strLit" && e.args[2] && literal(e.args[2])) out.add(e.args[1].value);
    // A class-property write dispatcher (`%dyn.class.property.N(recv, value)`) names its key in its body.
    if (e.kind === "call" && e.args.length === 2 && literal(e.args[1]!)) {
      const key = keySetDispatcherKey(functions.get(e.callee), readsThis);
      if (key !== null) out.add(key);
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") visit(v);
  };
  for (const f of mod.functions) if (reachable.has(f.name)) visit(f.body);
  return out;
}

function recognize(f: IrFunction, functions: Map<string, IrFunction>, readsThis: ReadonlySet<string>, typedFields: boolean, nonInt: ReadonlySet<string>): CtorStruct | null {
  const ctor: CtorStruct = { fn: f.name, key: "", fields: [], puts: new Map(), prefix: f.body.length };
  const thisLocals = new Set<string>();
  /** Hidden locals of the put chains that hold a number constant. */
  const constLocals = new Map<string, number>();
  const constOf = (e: IrExpr): number | undefined =>
    e.kind === "numLit" ? e.value : e.kind === "dynFrom" ? constOf(e.value) : e.kind === "varRef" ? constLocals.get(e.localId)
      : e.kind === "seqExpr" ? constOf(e.result) : undefined;
  const names = new Set<string>();
  let ok = true;
  const fail = () => { ok = false; };
  const isThis = (e: IrExpr | undefined): boolean =>
    e?.kind === "libCall" && e.fn === "dyn.this" && e.args.length === 0 || e?.kind === "varRef" && thisLocals.has(e.localId);
  /** Whether evaluating `e` may run user code or throw. */
  let effectful = false;
  /** Visit an expression in evaluation order; generic subtrees may not put or name `this`. */
  const value = (e: IrExpr, generic: boolean): void => {
    if (!ok) return;
    if (e.kind === "libCall" && e.fn === "dyn.this") return fail();
    if (e.kind === "varRef") { if (thisLocals.has(e.localId)) fail(); return; }
    if (e.kind === "closure") return fail();
    if (e.kind === "call" && isThis(e.args[0])) {
      const key = keySetDispatcherKey(functions.get(e.callee), readsThis);
      if (key === null || generic || e.args.length !== 2) return fail();
      const before = effectful;
      effectful = false;
      value(e.args[1]!, false);
      const rhsEffects = effectful;
      effectful = before || rhsEffects;
      if (!ok) return;
      if (names.has(key) || key === "__proto__" || CANONICAL_INDEX.test(key) || names.size >= MAX_FIELDS) return fail();
      names.add(key);
      const constant = constOf(e.args[1]!);
      ctor.puts.set(e, { ctor, field: ctor.fields.length, effectful: rhsEffects, ...(constant === undefined ? {} : { constant }) });
      // A property the constructor initializes with an int32 constant (counters,
      // flags, lanes) is an i32 field, unless the program stores another literal kind under its name.
      ctor.fields.push({ name: key, kind: typedFields && constant !== undefined && isInt32(constant) && !nonInt.has(key) ? "i32" : "any" });
      return;
    }
    // A conversion to dyn adds no evaluation of its own (`this.a = this.b = 0`: the inner chain is f64).
    if (e.kind === "dynFrom") return value(e.value, generic);
    if (e.kind === "seqExpr" && !generic) {
      for (const s of e.stmts) stmt(s, true);
      value(e.result, false);
      return;
    }
    if (!INERT_KINDS.has(e.kind)) effectful = true;
    // Any other node: no put, no `this`, no closure anywhere below it.
    children(e, x => value(x, true));
  };
  const stmt = (s: IrStmt, nested: boolean): void => {
    if (!ok) return;
    if (s.kind === "varDecl") {
      if (nested && s.init && isThis(s.init)) { thisLocals.add(s.localId); return; }
      if (!nested || !s.init) return fail();
      value(s.init, false);
      const c = constOf(s.init);
      if (c !== undefined) constLocals.set(s.localId, c);
      return;
    }
    if (s.kind === "exprStmt") return value(s.expr, false);
    fail();
  };
  const body = f.body;
  for (let i = 0; i < body.length; i++) {
    const s = body[i]!;
    if (s.kind === "return" && !s.value && i === body.length - 1) { ctor.prefix = i; break; }
    // A statement that is not a put ends the put prefix; it leaves nothing behind.
    const fields = ctor.fields.length, puts = new Set(ctor.puts.keys()), names0 = new Set(names), effectful0 = effectful;
    if (s.kind === "exprStmt") stmt(s, false); else fail();
    if (!ok) {
      ctor.fields.length = fields;
      for (const k of [...ctor.puts.keys()]) if (!puts.has(k)) ctor.puts.delete(k);
      names.clear(); for (const n of names0) names.add(n);
      effectful = effectful0;
      ctor.prefix = i;
      break;
    }
  }
  if (!ctor.fields.length) return null;
  // The remainder runs on the complete struct. It may read `this`'s
  // properties, write the struct's own ones and return it; anything else it
  // does with `this` (pass it on, add, delete or compute a key) could convert
  // every object, so such a constructor stays ordinary.
  if (ctor.prefix < body.length && !(ctor.prefix === body.length - 1 && body[ctor.prefix]!.kind === "return" && !(body[ctor.prefix] as IrStmt & { kind: "return" }).value)) {
    let clean = true;
    const visit = (e: IrExpr, parent: IrExpr | null): void => {
      if (!clean) return;
      if (e.kind === "libCall" && e.fn === "dyn.this") {
        const p = parent;
        const read = p?.kind === "call" && p.args.length === 1 && p.args[0] === e && (p.callee.startsWith("%dyn.class.property.") || p.callee.startsWith("%dyn.generator.get."));
        const put = p?.kind === "call" && p.args.length === 2 && p.args[0] === e && names.has(keySetDispatcherKey(functions.get(p.callee), readsThis) ?? "\0");
        if (!read && !put) clean = false;
        return;
      }
      if (e.kind === "closure") { clean = false; return; }
      children(e, x => visit(x, e));
    };
    for (const s of body.slice(ctor.prefix)) {
      // `return this` hands back the complete struct.
      const v = s.kind === "return" && s.value?.kind === "jsMarshal" ? s.value.value : s.kind === "return" ? s.value : null;
      if (v?.kind === "libCall" && v.fn === "dyn.this") continue;
      children(s, x => visit(x, null));
    }
    if (!clean) return null;
  }
  return ctor;
}

/** Every IR expression directly below `node` (statements included through their expressions). */
function children(node: object, visit: (e: IrExpr) => void): void {
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x === "object") walk(x, visit); }
    else if (v && typeof v === "object") walk(v, visit);
  }
}
function walk(x: object, visit: (e: IrExpr) => void): void {
  const kind = (x as { kind?: unknown }).kind;
  if (typeof kind !== "string") return children(x, visit);
  // An expression carries its type; a type (no `type` of its own) is plain data.
  if ("type" in x) return visit(x as IrExpr);
  if (TYPE_KINDS.has(kind)) return;
  children(x, visit);
}
const TYPE_KINDS = new Set(["regex", "date", "jsval", "bytes", "f64", "bool", "string", "void", "array", "record", "object", "union", "func", "undefinedT", "nullT", "dyn", "caught", "map", "set", "promise", "symbol"]);
