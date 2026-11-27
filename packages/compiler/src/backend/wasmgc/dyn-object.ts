/* Shaped dynamic objects: the native object model for untyped JavaScript
 * (docs/WASMGC_NATIVE_OBJECT_MODEL.md).
 *
 * An object is {shape, slots, proto}. A shape is the ordered list of the
 * object's property atoms plus a transition table, so objects built the same
 * way share one shape and a property site can cache (shape, slot): an inline
 * cache hit is one ref.eq and one array.get. A delete (or more than
 * DICT_LIMIT properties) moves the object to an unshared dictionary shape
 * that is mutated in place and never cached.
 *
 * Property names are atoms (i32). Names known at compile time get their ids
 * here; the atom table is seeded with them in id order on first use, and
 * computed keys are interned at runtime through a js-string hash table.
 *
 * Conventions: undefined is the null anyref; a null proto field means the
 * default Object.prototype. Data properties only: non-default attributes
 * (read-only, non-enumerable, non-configurable) move the object to a
 * dictionary shape, whose SHAPE_FLAGS byte per slot holds them; caches never
 * use dictionary shapes, so their fast paths stay attribute-free. Accessor
 * properties are refused by the caller. */
import binaryen from "binaryen";
import type { GcTypes } from "./types.js";
import { IC_SHAPE, IC_SLOT, IC_TEPOCH, IC_TFROM, IC_TPROTO, IC_TSLOT, IC_TTO, OBJ_PROTO, OBJ_SHAPE, OBJ_SLOTS, SHAPE_COUNT, SHAPE_DICT, SHAPE_FLAGS, SHAPE_KEYS, SHAPE_PARENT, SHAPE_SLACK, SHAPE_INDEX, SHAPE_TCOUNT, SHAPE_TKEYS, SHAPE_TSHAPES } from "./types.js";

export interface DynObjectContext {
  m: binaryen.Module;
  types: GcTypes;
  defineHelper(name: string, define: () => void): string;
  stringConst(value: string): number;
  stringEq(a: number, b: number): number;
  strLen(v: number): number;
  strCode(v: number, i: number): number;
  /** js-string concat, substring and fromCharCode (key escaping: see KEY_MARK). */
  strConcat(a: number, b: number): number;
  strSlice(v: number, from: number, to: number): number;
  strFromCode(code: number): number;
  /** A fresh dyn array (`cap` is an i32 expression), and its push helper's name. */
  newDynArr(cap: number): number;
  dynArrPush(): string;
  boxStr(v: number): number;
  /** The default Object.prototype's value for an atom (i32 expression): native builtins or undefined. */
  objectProto(atom: number): number;
  /** Whether the default Object.prototype has the atom (`in` through the default prototype). */
  objectProtoHas(atom: number): number;
  /** A throw expression for a write to a read-only property (strict mode). */
  readOnlyError(atom: number): number;
  /** Call an accessor's getter (A) with this = receiver (A); returns its result (A). */
  callGetter(fn: number, receiver: number): number;
  /** Call an accessor's setter with this = receiver and one argument (no result). */
  callSetter(fn: number, receiver: number, value: number): number;
  /** Constructor structs (ctor-structs.ts), in id order: none leaves every path as it was. */
  ctorStructs?: readonly CtorStructLayout[];
  /** A number's dyn box (an f64 expression in), for typed constructor fields. */
  boxNum?(v: number): number;
  /** Is a dyn value a number (either form), and its f64 (experimentalDynI31: an i31 or a box). */
  isNum?(v: number): number;
  numOf?(v: number): number;
  /** experimentalDynI31: the non-null i31ref type (small integers are i31s), else absent. */
  i31?: number;
  /** experimentalDynInlineSlots: the first `inlineSlots` property slots of
   * every native object live in dyn:obj's own fields (after {shape, slots,
   * proto, js}); slot j >= inlineSlots is overflow element j - inlineSlots.
   * Absent or 0: every slot is in the slots array (the default). */
  inlineSlots?: number;
  /** Shared runtime (WasmGcLink.sharedRuntime): the atom table, shape tree
   * and accessor state are the owner's, which exports them (`$rt.<name>`);
   * a client imports them, and its compile-time atoms continue the owner's
   * (`seed`: the owner's atoms in id order, from its link manifest). */
  shared?: { owner: boolean; ownerNs: string; seed?: readonly string[] };
}

/** A constructor struct's type and fields (dyn-object reads and writes them generically). */
export interface CtorStructLayout { key: string; ref: number; heap: number; fields: readonly { name: string; kind: "any" | "i32" | "f64" }[] }
/** SHAPE_DICT value of a constructor-struct shape (never cached, never mutated in place). */
export const SHAPE_STRUCT = 2;
/** SHAPE_DICT bit of a dictionary shape (1 | SHAPE_NOEXT): its object is not
 * extensible (Object.preventExtensions, seal, freeze). Only a dictionary (an
 * unshared shape no cache holds) carries it, so every cached and profiled
 * add path misses on such an object and reaches $obj.append, which refuses
 * a new key; sealed and frozen keys are ATTR_FIXED (and ATTR_READONLY)
 * in SHAPE_FLAGS, which the generic write and delete paths already honor. */
export const SHAPE_NOEXT = 4;
/** Constructor-struct fields start after dyn:obj's {shape, slots, proto, js}
 * (under experimentalDynInlineSlots see ctorFieldLayout). */
export const CTOR_FIELD0 = 4;
/** dyn:obj's first inline slot field (experimentalDynInlineSlots). */
export const OBJ_INLINE0 = 4;
/** A constructor stops allocating structs once more than DICT_LIMIT of its
 * objects converted to ordinary ones and they are more than 1 in
 * CTOR_DEMOTION_SHARE of its struct allocations (learned per constructor:
 * a constructor whose objects take expandos or other value kinds). */
const CTOR_DEMOTION_SHARE = 4;
/** Where each constructor-struct field lives (experimentalDynInlineSlots: `inl` > 0).
 * A struct object never keeps properties in dyn:obj's inline slot fields
 * (its properties are its fields), so its first `inl` anyref fields occupy
 * them instead of trailing unused ones: `index[j]` is field j's struct field
 * index, and `extra` lists the kinds of the fields after dyn:obj's (inline
 * fields included), in order. Without inline slots every field is extra. */
export function ctorFieldLayout(kinds: readonly ("any" | "i32" | "f64")[], inl: number): { index: number[]; extra: ("any" | "i32" | "f64")[] } {
  const index: number[] = [], extra: ("any" | "i32" | "f64")[] = [];
  let shared = 0;
  for (const k of kinds) {
    if (k === "any" && shared < inl) index.push(OBJ_INLINE0 + shared++);
    else { index.push(CTOR_FIELD0 + inl + extra.length); extra.push(k); }
  }
  return { index, extra };
}

/** Property attribute bits (0 = writable, enumerable, configurable). */
export const ATTR_READONLY = 1, ATTR_HIDDEN = 2, ATTR_FIXED = 4;
/** An engine-internal slot (a built-in iterator's state): in no key listing. */
export const ATTR_INTERNAL = 8;

/** Objects beyond this many properties move to an unshared dictionary shape. */
const DICT_LIMIT = 64;
/** A dictionary shape with at least this many keys is searched through a
 * hash index (atom -> slot + 1, open addressing, at most half full) instead
 * of a linear scan of its keys. */
const DICT_INDEX_MIN = 8;
/* Property keys as strings (the "key form" atoms are named in, and the key form host.ts's K reads): a string key
 * is itself unless it begins with KEY_MARK (U+DFFF, a lone low surrogate), when it carries one more KEY_MARK in
 * front; a symbol key is its reserved name, KEY_MARK then the symbol's id and description (host.ts symbolKey),
 * whose second unit is a digit. So no string key can spell a symbol's name, and a name maps back exactly. */
export const KEY_MARK = 0xDFFF;
/** Entries in the runtime intern cache (a power of two). */
const INTERN_CACHE = 512;

export function dynObjects(ctx: DynObjectContext) {
  const { m, types } = ctx;
  const A = binaryen.anyref, I = binaryen.i32, ST = binaryen.externref, N = binaryen.none;
  const heap = (t: number) => binaryen.getHeapType(t);
  const nn = (t: number) => binaryen.getTypeFromHeapType(heap(t), false);
  const SH = () => types.dynBox("dyn:shape").ref, SHS = () => types.dynBox("dyn:shapes").ref;
  const OB = () => types.dynBox("dyn:obj").ref, IC = () => types.dynBox("dyn:ic").ref, ACC = () => types.dynBox("dyn:acc").ref;
  const I32S = () => types.i32Array(), I8S = () => types.i8Array(), ANY = () => types.anyArray(), STRS = () => types.strArray();
  const L = (i: number, t: number) => m.local.get(i, t);
  const S = (i: number, v: number) => m.local.set(i, v);
  const c = (v: number) => m.i32.const(v);
  const inc = (i: number) => S(i, m.i32.add(L(i, I), c(1)));
  const helper = (name: string, params: number[], result: number, vars: number[], body: () => number): string =>
    ctx.defineHelper(name, () => { m.addFunction(name, binaryen.createType(params), result, vars, body()); });
  /** `for (i = from; i < limit; i++) body` with labels unique per use. */
  let loops = 0;
  const forRange = (i: number, from: number, limit: () => number, body: number[]) => {
    const n = loops++, brk = `for.end.${n}`, top = `for.top.${n}`;
    return m.block(null, [S(i, from), m.block(brk, [m.loop(top, m.block(null, [
      m.br(brk, m.i32.ge_s(L(i, I), limit())), ...body, inc(i), m.br(top)]))])]);
  };
  const shapeGet = (field: number, s: number, t: number) => m.struct.get(field, s, t, false);

  /* ── atoms ───────────────────────────────────────────────────────── */
  const atomIds = new Map<string, number>(), atomNames: string[] = [];
  // A shared-runtime client: the owner's atoms keep their ids; new ones follow.
  for (const name of ctx.shared?.seed ?? []) { atomIds.set(name, atomNames.length); atomNames.push(name); }
  const ownerAtoms = atomNames.length;
  /** The compile-time atom id of a constant property name. */
  const atom = (name: string): number => {
    let id = atomIds.get(name);
    if (id === undefined) { id = atomNames.length; atomIds.set(name, id); atomNames.push(name); }
    return id;
  };
  let globalsDeclared = false, noSlotsDeclared = false;
  const declareGlobals = () => {
    if (globalsDeclared) return;
    globalsDeclared = true;
    // Runtime state: module-private, or (shared runtime) the owner's.
    const sh = ctx.shared;
    const rt = (name: string, type: number, init: number) => {
      if (!sh) m.addGlobal(name, type, true, init);
      else if (sh.owner) { m.addGlobal(name, type, true, init); m.addGlobalExport(name, `$rt.${name}`); }
      else m.addGlobalImport(name, sh.ownerNs, `${sh.ownerNs}.$rt.${name}`, type, true);
    };
    rt("$atoms.strs", STRS(), m.ref.null(STRS()));
    rt("$atoms.idx", I32S(), m.ref.null(I32S()));
    rt("$atoms.hash", I32S(), m.ref.null(I32S()));
    // Per atom: 1 when its name is a symbol key's reserved name, 2 when it is an escaped string key (KEY_MARK
    // twice in front: its string is the name less one), else 0 (decided once, at interning).
    rt("$atoms.sym", I8S(), m.ref.null(I8S()));
    rt("$atoms.count", I, c(0));
    rt("$atoms.boxes", types.strBoxArray(), m.ref.null(types.strBoxArray()));
    rt("$atoms.cacheS", STRS(), m.ref.null(STRS()));
    rt("$atoms.cacheA", I32S(), m.ref.null(I32S()));
    rt("$shape.root", SH(), m.ref.null(SH()));
    // The empty shape's transitions by atom ($shape.add): every object built
    // from `{}` adds its first key there, so that table is the one with
    // hundreds of entries. Shared with the shape tree under a shared runtime.
    rt("$shape.rootKids", SHS(), m.ref.null(SHS()));
    // Set once any accessor property exists: only then do new-key writes
    // look for an inherited setter.
    rt("$acc.any", I, c(0));
    // Bumped by every accessor definition and prototype change of an existing
    // object: a cached add transition checked against one prototype chain
    // stays valid while the epoch is unchanged.
    rt("$acc.epoch", I, c(0));
  };
  const strs = () => m.global.get("$atoms.strs", STRS()), idxs = () => m.global.get("$atoms.idx", I32S()), table = () => m.global.get("$atoms.hash", I32S());
  const count = () => m.global.get("$atoms.count", I);

  /** FNV-1a over the UTF-16 code units. */
  const hashOf = () => helper("$atoms.hashOf", [ST], I, [I, I, I], () => m.block(null, [
    S(1, c(0x811c9dc5 | 0)), S(3, ctx.strLen(L(0, ST))),
    forRange(2, c(0), () => L(3, I), [S(1, m.i32.mul(m.i32.xor(L(1, I), ctx.strCode(L(0, ST), L(2, I))), c(16777619)))]),
    L(1, I),
  ], I));
  /** A canonical array index (0..2^32-2) as an unsigned i32, or -1 (0xFFFFFFFF, never an index). */
  const indexOf = () => helper("$atoms.indexOf", [ST], I, [I, I, I, binaryen.i64], () => {
    const s = () => L(0, ST), n = () => L(1, I), k = () => L(2, I), ch = () => L(3, I), v = () => L(4, binaryen.i64);
    return m.block(null, [
      S(1, ctx.strLen(s())),
      m.if(m.i32.or(m.i32.eqz(n()), m.i32.gt_s(n(), c(10))), m.return(c(-1))),
      m.if(m.i32.and(m.i32.gt_s(n(), c(1)), m.i32.eq(ctx.strCode(s(), c(0)), c(48))), m.return(c(-1))),
      S(4, m.i64.const(0n as unknown as number)),
      forRange(2, c(0), n, [
        S(3, m.i32.sub(ctx.strCode(s(), k()), c(48))),
        m.if(m.i32.gt_u(ch(), c(9)), m.return(c(-1))),
        S(4, m.i64.add(m.i64.mul(v(), m.i64.const(10n as unknown as number)), m.i64.extend_u(ch()))),
      ]),
      m.if(m.i64.gt_u(v(), m.i64.const(4294967294n as unknown as number)), m.return(c(-1))),
      m.i32.wrap(v()),
    ], I);
  });
  /** Insert into the open-addressing table (no growth check). */
  const place = () => helper("$atoms.place", [ST, I], N, [I, I], () => {
    const mask = () => L(3, I);
    const n = loops++;
    return m.block(null, [
      S(3, m.i32.sub(m.array.len(table()), c(1))),
      S(2, m.i32.and(m.call(hashOf(), [L(0, ST)], I), mask())),
      m.block(`place.done.${n}`, [m.loop(`place.probe.${n}`, m.block(null, [
        m.br(`place.done.${n}`, m.i32.eqz(m.array.get(table(), L(2, I), I, false))),
        S(2, m.i32.and(m.i32.add(L(2, I), c(1)), mask())), m.br(`place.probe.${n}`)]))]),
      m.array.set(table(), L(2, I), m.i32.add(L(1, I), c(1))),
    ]);
  });
  const ensure = () => helper("$atoms.ensure", [], N, [], () => {
    declareGlobals();
    return m.if(m.ref.is_null(strs()), m.block(null, [
      m.global.set("$atoms.strs", m.array.new_default(heap(STRS()), c(256))),
      m.global.set("$atoms.idx", m.array.new_default(heap(I32S()), c(256))),
      m.global.set("$atoms.hash", m.array.new_default(heap(I32S()), c(1024))),
      m.global.set("$atoms.sym", m.array.new_default(heap(I8S()), c(256))),
      m.global.set("$atoms.count", c(0)),
      m.global.set("$atoms.cacheS", m.array.new_default(heap(STRS()), c(INTERN_CACHE))),
      m.global.set("$atoms.cacheA", m.array.new_default(heap(I32S()), c(INTERN_CACHE))),
      m.call("$atoms.seed", [], N),
    ]));
  });
  /** The atom of a runtime string key: a direct-mapped cache of recent keys
   * (indexed by length and three code units, confirmed by string equality)
   * in front of the hash table. Keys recur (for-in loops read and write the
   * same key; DOM expando keys repeat per node), and the cache spares the
   * hash over every code unit and the probe. It holds canonical atom names,
   * so a key that came from an atom (for-in, Object.keys) compares by
   * identity. */
  // $atoms.intern takes a string key as the program spelled it (escaped here when it begins with KEY_MARK);
  // $atoms.internKey takes a key already in key form (a symbol's reserved name, a key the host encoded).
  const internOf = (escape: boolean) => helper(escape ? "$atoms.intern" : "$atoms.internKey", [ST], I, [I, I, ST], () => {
    const s = () => L(0, ST), n = () => L(1, I), h = () => L(2, I), cs = () => L(3, ST);
    const cacheS = () => m.global.get("$atoms.cacheS", STRS()), cacheA = () => m.global.get("$atoms.cacheA", I32S());
    return m.block(null, [
      m.call(ensure(), [], N),
      S(1, ctx.strLen(s())),
      ...(escape ? [m.if(m.if(n(), m.i32.eq(ctx.strCode(s(), c(0)), c(KEY_MARK)), c(0)),
        m.block(null, [S(0, ctx.strConcat(ctx.strFromCode(c(KEY_MARK)), s())), S(1, m.i32.add(n(), c(1)))]))] : []),
      S(2, m.if(n(), m.i32.add(m.i32.add(m.i32.mul(ctx.strCode(s(), c(0)), c(0x2f)), m.i32.mul(ctx.strCode(s(), m.i32.shr_u(n(), c(1))), c(0x95))),
        m.i32.add(m.i32.mul(ctx.strCode(s(), m.i32.sub(n(), c(1))), c(0x1b7)), m.i32.mul(n(), c(0x3d1)))), c(0))),
      S(2, m.i32.and(m.i32.xor(h(), m.i32.shr_u(h(), c(8))), c(INTERN_CACHE - 1))),
      S(3, m.array.get(cacheS(), h(), ST, false)),
      m.if(m.i32.eqz(m.ref.is_null(cs())), m.if(ctx.stringEq(cs(), s()), m.return(m.array.get(cacheA(), h(), I, false)))),
      S(1, m.call(internSlow(), [s()], I)),
      m.array.set(cacheS(), h(), m.array.get(strs(), n(), ST, false)),
      m.array.set(cacheA(), h(), n()),
      n(),
    ], I);
  });
  const intern = () => internOf(true), internKey = () => internOf(false);
  const internSlow = () => helper("$atoms.intern.slow", [ST], I, [I, I, I, STRS(), I32S(), I32S(), I8S()], () => {
    const s = () => L(0, ST), h = () => L(1, I), e = () => L(2, I), mask = () => L(3, I);
    const n = loops++;
    return m.block(null, [
      m.call(ensure(), [], N),
      S(3, m.i32.sub(m.array.len(table()), c(1))),
      S(1, m.i32.and(m.call(hashOf(), [s()], I), mask())),
      m.loop(`intern.probe.${n}`, m.block(null, [
        S(2, m.array.get(table(), h(), I, false)),
        m.if(m.i32.eqz(e()), m.block(null, [
          // A new atom: append, index it, and grow the table at half load.
          m.if(m.i32.ge_s(count(), m.array.len(strs())), m.block(null, [
            S(4, m.array.new_default(heap(STRS()), m.i32.shl(count(), c(1)))),
            m.array.copy(L(4, STRS()), c(0), strs(), c(0), count()), m.global.set("$atoms.strs", L(4, STRS())),
            S(5, m.array.new_default(heap(I32S()), m.i32.shl(count(), c(1)))),
            m.array.copy(L(5, I32S()), c(0), idxs(), c(0), count()), m.global.set("$atoms.idx", L(5, I32S())),
            S(7, m.array.new_default(heap(I8S()), m.i32.shl(count(), c(1)))),
            m.array.copy(L(7, I8S()), c(0), m.global.get("$atoms.sym", I8S()), c(0), count()), m.global.set("$atoms.sym", L(7, I8S())),
          ])),
          m.array.set(strs(), count(), s()),
          m.array.set(idxs(), count(), m.call(indexOf(), [s()], I)),
          m.array.set(m.global.get("$atoms.sym", I8S()), count(), keyKind(s)),
          m.array.set(table(), h(), m.i32.add(count(), c(1))),
          m.global.set("$atoms.count", m.i32.add(count(), c(1))),
          m.if(m.i32.gt_s(m.i32.shl(count(), c(1)), m.array.len(table())), m.block(null, [
            m.global.set("$atoms.hash", m.array.new_default(heap(I32S()), m.i32.shl(m.array.len(table()), c(1)))),
            forRange(2, c(0), count, [m.call(place(), [m.array.get(strs(), e(), ST, false), e()], N)]),
          ])),
          m.return(m.i32.sub(count(), c(1))),
        ])),
        m.if(ctx.stringEq(m.array.get(strs(), m.i32.sub(e(), c(1)), ST, false), s()), m.return(m.i32.sub(e(), c(1)))),
        S(1, m.i32.and(m.i32.add(h(), c(1)), mask())),
        m.br(`intern.probe.${n}`),
      ])),
      m.unreachable(),
    ], I);
  });
  /** An atom's name as a dyn string box, shared per atom (boxes are immutable). */
  const atomBox = () => helper("$atoms.box", [I], nn(types.dynBox("dyn:str").ref), [types.strBoxArray(), types.dynBox("dyn:str").ref], () => {
    const a = () => L(0, I), arr = () => L(1, types.strBoxArray()), b = () => L(2, types.dynBox("dyn:str").ref);
    const boxes = () => m.global.get("$atoms.boxes", types.strBoxArray());
    declareGlobals();
    return m.block(null, [
      m.if(m.if(m.ref.is_null(boxes()), c(1), m.i32.ge_u(a(), m.array.len(boxes()))), m.block(null, [
        S(1, m.array.new_default(heap(types.strBoxArray()), m.i32.add(m.i32.shl(a(), c(1)), c(64)))),
        m.if(m.i32.eqz(m.ref.is_null(boxes())), m.array.copy(arr(), c(0), boxes(), c(0), m.array.len(boxes()))),
        m.global.set("$atoms.boxes", arr())])),
      S(2, m.array.get(boxes(), a(), types.dynBox("dyn:str").ref, false)),
      m.if(m.ref.is_null(b()), m.block(null, [
        S(2, m.struct.new([m.call(atomString(), [a()], ST), m.i32.add(a(), c(1))], types.dynBox("dyn:str").heap)),
        m.array.set(boxes(), a(), b())])),
      m.ref.as_non_null(b()),
    ], nn(types.dynBox("dyn:str").ref));
  });
  /** A key-form name's kind (KEY_MARK): 1 a symbol key's reserved name, 2 an escaped string key, 0 any other string key. */
  const keyKind = (name: () => number): number => m.if(m.i32.gt_u(ctx.strLen(name()), c(1)),
    m.if(m.i32.eq(ctx.strCode(name(), c(0)), c(KEY_MARK)), m.if(m.i32.eq(ctx.strCode(name(), c(1)), c(KEY_MARK)), c(2), c(1)), c(0)), c(0));
  /** A key-form name is a symbol key's reserved name (string-key enumerations skip it). */
  const isSymbolName = (name: () => number): number => m.i32.eq(keyKind(name), c(1));
  const isSymbolAtom = () => helper("$atoms.isSymbol", [I], I, [], () => m.block(null, [m.call(ensure(), [], N), m.i32.eq(m.array.get(m.global.get("$atoms.sym", I8S()), L(0, I), I, false), c(1))], I));
  /** An atom's name in key form (what host imports taking a key read) and its array-index value (-1 for names). */
  const atomName = () => helper("$atoms.name", [I], ST, [], () => m.block(null, [m.call(ensure(), [], N), m.array.get(strs(), L(0, I), ST, false)], ST));
  /** An atom's key as the program sees it: an escaped string key's own string (one KEY_MARK less), else its name. */
  const atomString = () => helper("$atoms.string", [I], ST, [ST], () => m.block(null, [
    m.call(ensure(), [], N),
    S(1, m.array.get(strs(), L(0, I), ST, false)),
    m.if(m.i32.eq(m.array.get(m.global.get("$atoms.sym", I8S()), L(0, I), I, false), c(2)), ctx.strSlice(L(1, ST), c(1), ctx.strLen(L(1, ST))), L(1, ST)),
  ], ST));
  const atomIndex = () => helper("$atoms.index", [I], I, [], () => m.block(null, [m.call(ensure(), [], N), m.array.get(idxs(), L(0, I), I, false)], I));

  /* ── shapes ──────────────────────────────────────────────────────── */
  /** A shape of `n()` keys. Its slack starts at n: the largest key count any
   * object reached through it (raised as descendants appear), which sizes
   * slot arrays when they grow. */
  const newShape = (keys: number, n: () => number, parent: number, dict: number) =>
    m.struct.new([keys, n(), parent, m.ref.null(I32S()), m.ref.null(SHS()), c(0), dict, m.ref.null(I8S()), n(), m.ref.null(I32S())], heap(SH()));
  const root = () => helper("$shape.root", [], SH(), [], () => {
    declareGlobals();
    return m.block(null, [
      m.if(m.ref.is_null(m.global.get("$shape.root", SH())),
        m.global.set("$shape.root", newShape(m.array.new_default(heap(I32S()), c(0)), () => c(0), m.ref.null(SH()), c(0)))),
      m.global.get("$shape.root", SH()),
    ], SH());
  });
  /** The slot of `atom` in a shape, or -1. A large dictionary (an object
   * used as a hash map) answers through its index. */
  const find = () => helper("$shape.find", [SH(), I], I, [I32S(), I], () => m.block(null, [
    // One test on the hot path: dictionaries search out of line (kept small so engines inline it).
    m.if(m.i32.and(shapeGet(SHAPE_DICT, L(0, SH()), I), c(1)), m.return(m.call(findIndexed(), [L(0, SH()), L(1, I)], I))),
    ...scan(),
  ], I));
  const scan = () => [
    S(2, shapeGet(SHAPE_KEYS, L(0, SH()), I32S())),
    forRange(3, c(0), () => shapeGet(SHAPE_COUNT, L(0, SH()), I), [
      m.if(m.i32.eq(m.array.get(L(2, I32S()), L(3, I), I, false), L(1, I)), m.return(L(3, I)))]),
    c(-1),
  ];
  /** An atom's home bucket in a dictionary index of `mask + 1` entries. */
  const bucket = (atom: () => number, mask: () => number) => {
    const h = () => m.i32.mul(atom(), c(0x9e3779b1 | 0));
    return m.i32.and(m.i32.xor(h(), m.i32.shr_u(h(), c(15))), mask());
  };
  /** Insert slot k's atom (absent from the index) into a dictionary's index. */
  const indexPut = () => helper("$shape.index.put", [I32S(), I, I], N, [I, I], () => {
    const idx = () => L(0, I32S()), mask = () => L(3, I), h = () => L(4, I), n = loops++;
    return m.block(null, [
      S(3, m.i32.sub(m.array.len(idx()), c(1))),
      S(4, bucket(() => L(1, I), mask)),
      m.block(`iput.done.${n}`, [m.loop(`iput.probe.${n}`, m.block(null, [
        m.br(`iput.done.${n}`, m.i32.eqz(m.array.get(idx(), h(), I, false))),
        S(4, m.i32.and(m.i32.add(h(), c(1)), mask())), m.br(`iput.probe.${n}`)]))]),
      m.array.set(idx(), h(), m.i32.add(L(2, I), c(1))),
    ]);
  });
  /** Remove slot k from a dictionary's index (backward-shift deletion: a
   * later entry of the probe run moves into the hole unless its home bucket
   * lies cyclically in (hole, its bucket]), then renumber the slots after k,
   * which the caller moves down one. */
  const indexRemove = () => helper("$shape.index.remove", [I32S(), I32S(), I, I], N, [I, I, I, I, I], () => {
    const idx = () => L(0, I32S()), keys = () => L(1, I32S()), k = () => L(2, I), count = () => L(3, I);
    const mask = () => L(4, I), i = () => L(5, I), j = () => L(6, I), e = () => L(7, I), h = () => L(8, I), n = loops++;
    const next = (x: () => number) => m.i32.and(m.i32.add(x(), c(1)), mask());
    // h outside (i, j] cyclically: the entry at j can fill the hole at i.
    const movable = m.if(m.i32.le_u(i(), j()),
      m.i32.or(m.i32.le_u(h(), i()), m.i32.gt_u(h(), j())),
      m.i32.and(m.i32.le_u(h(), i()), m.i32.gt_u(h(), j())));
    /** Point i at slot `slot`'s entry (present), probing from its key's home bucket. */
    const seek = (slot: () => number) => {
      const l = loops++;
      return m.block(null, [
        S(5, bucket(() => m.array.get(keys(), slot(), I, false), mask)),
        m.block(`irm.found.${l}`, [m.loop(`irm.seek.${l}`, m.block(null, [
          m.br(`irm.found.${l}`, m.i32.eq(m.array.get(idx(), i(), I, false), m.i32.add(slot(), c(1)))),
          S(5, next(i)), m.br(`irm.seek.${l}`)]))])]);
    };
    return m.block(null, [
      S(4, m.i32.sub(m.array.len(idx()), c(1))),
      seek(k),
      S(6, i()),
      m.block(`irm.done.${n}`, [m.loop(`irm.shift.${n}`, m.block(null, [
        S(6, next(j)),
        S(7, m.array.get(idx(), j(), I, false)),
        m.br(`irm.done.${n}`, m.i32.eqz(e())),
        S(8, bucket(() => m.array.get(keys(), m.i32.sub(e(), c(1)), I, false), mask)),
        m.if(movable, m.block(null, [m.array.set(idx(), i(), e()), S(5, j())])),
        m.br(`irm.shift.${n}`)]))]),
      m.array.set(idx(), i(), c(0)),
      // Each later slot j becomes j - 1 (its entry holds j + 1, then j).
      forRange(6, m.i32.add(k(), c(1)), count, [seek(j), m.array.set(idx(), i(), j())]),
    ]);
  });
  /** A dictionary's index, built from its keys when absent (or dropped). */
  const shapeIndex = () => helper("$shape.index", [SH()], nn(I32S()), [I, I, I32S(), I32S(), I], () => {
    const s = () => L(0, SH()), n = () => L(1, I), cap = () => L(2, I), idx = () => L(3, I32S()), keys = () => L(4, I32S());
    return m.block(null, [
      S(3, shapeGet(SHAPE_INDEX, s(), I32S())),
      m.if(m.i32.eqz(m.ref.is_null(idx())), m.return(m.ref.as_non_null(idx()))),
      S(1, shapeGet(SHAPE_COUNT, s(), I)),
      // Room for the keys at most half full: the next power of two >= 2n + 16.
      S(2, m.i32.shl(c(1), m.i32.sub(c(32), m.i32.clz(m.i32.add(m.i32.shl(n(), c(1)), c(15)))))),
      S(3, m.array.new_default(heap(I32S()), cap())),
      S(4, shapeGet(SHAPE_KEYS, s(), I32S())),
      forRange(5, c(0), n, [m.call(indexPut(), [idx(), m.array.get(keys(), L(5, I), I, false), L(5, I)], N)]),
      m.struct.set(SHAPE_INDEX, s(), idx()),
      m.ref.as_non_null(idx()),
    ], nn(I32S()));
  });
  /** A dictionary's search: a scan below DICT_INDEX_MIN keys, else its index
   * (`.cold`: wasm-opt keeps it out of $shape.find). */
  const findIndexed = () => helper("$shape.find.dict.cold", [SH(), I], I, [I32S(), I, I, I, I32S()], () => {
    const s = () => L(0, SH()), idx = () => L(2, I32S()), mask = () => L(3, I), h = () => L(4, I), e = () => L(5, I), keys = () => L(6, I32S()), n = loops++;
    return m.block(null, [
      m.if(m.i32.lt_s(shapeGet(SHAPE_COUNT, s(), I), c(DICT_INDEX_MIN)), m.return(m.block(null, scan(), I))),
      S(2, m.call(shapeIndex(), [s()], nn(I32S()))),
      S(6, shapeGet(SHAPE_KEYS, s(), I32S())),
      S(3, m.i32.sub(m.array.len(idx()), c(1))),
      S(4, bucket(() => L(1, I), mask)),
      m.loop(`ifind.${n}`, m.block(null, [
        S(5, m.array.get(idx(), h(), I, false)),
        m.if(m.i32.eqz(e()), m.return(c(-1))),
        m.if(m.i32.eq(m.array.get(keys(), m.i32.sub(e(), c(1)), I, false), L(1, I)), m.return(m.i32.sub(e(), c(1)))),
        S(4, m.i32.and(m.i32.add(h(), c(1)), mask())), m.br(`ifind.${n}`)])),
      m.unreachable(),
    ], I);
  });
  /** The attribute bits of slot k (0 unless a dictionary shape recorded some). */
  const flagsAt = () => helper("$shape.flagsAt", [SH(), I], I, [I8S()], () => m.block(null, [
    S(2, shapeGet(SHAPE_FLAGS, L(0, SH()), I8S())),
    m.if(m.ref.is_null(L(2, I8S())), m.return(c(0))),
    m.if(m.i32.ge_u(L(1, I), m.array.len(L(2, I8S()))), m.return(c(0))),
    m.array.get(L(2, I8S()), L(1, I), I, false),
  ], I));
  /** An unshared dictionary copy of a shape (room for growth). */
  const toDict = () => helper("$shape.toDict", [SH()], SH(), [I32S(), I], () => m.block(null, [
    S(2, shapeGet(SHAPE_COUNT, L(0, SH()), I)),
    S(1, m.array.new_default(heap(I32S()), m.i32.add(L(2, I), c(4)))),
    m.array.copy(L(1, I32S()), c(0), shapeGet(SHAPE_KEYS, L(0, SH()), I32S()), c(0), L(2, I)),
    newShape(L(1, I32S()), () => L(2, I), m.ref.null(SH()), c(1)),
  ], SH()));
  /** Record `child` as the empty shape's transition for atom `a` (the array grows by doubling). */
  const rootKidSet = () => helper("$shape.rootKids.set", [I, SH()], N, [SHS(), SHS()], () => {
    declareGlobals();
    const a = () => L(0, I), kids = () => L(2, SHS()), grown = () => L(3, SHS());
    return m.block(null, [
      S(2, m.global.get("$shape.rootKids", SHS())),
      m.if(m.if(m.ref.is_null(kids()), c(1), m.i32.ge_u(a(), m.array.len(kids()))), m.block(null, [
        S(3, m.array.new_default(heap(SHS()), m.select(m.i32.gt_u(m.i32.add(a(), c(64)), m.i32.shl(m.if(m.ref.is_null(kids()), c(0), m.array.len(kids())), c(1))),
          m.i32.add(a(), c(64)), m.i32.shl(m.if(m.ref.is_null(kids()), c(0), m.array.len(kids())), c(1))))),
        m.if(m.i32.eqz(m.ref.is_null(kids())), m.array.copy(grown(), c(0), kids(), c(0), m.array.len(kids()))),
        m.global.set("$shape.rootKids", grown()), S(2, grown())])),
      m.array.set(kids(), a(), L(1, SH())),
    ]);
  });
  /** The shape after adding `atom`: in place for a dictionary, else the (shared) transition. */
  const add = () => helper("$shape.add", [SH(), I], SH(), [SH(), I32S(), I, I, SHS(), I8S(), SH()], () => {
    declareGlobals();
    const s = () => L(0, SH()), a = () => L(1, I), child = () => L(2, SH()), keys = () => L(3, I32S()), n = () => L(4, I), k = () => L(5, I);
    const tkeys = () => shapeGet(SHAPE_TKEYS, s(), I32S()), tshapes = () => shapeGet(SHAPE_TSHAPES, s(), SHS()), tcount = () => shapeGet(SHAPE_TCOUNT, s(), I);
    const isRoot = () => m.ref.eq(s(), m.global.get("$shape.root", SH()));
    const sl = loops++;
    return m.block(null, [
      // From the empty shape: the transition indexed by atom, when recorded.
      m.if(isRoot(), m.block(null, [
        S(6, m.global.get("$shape.rootKids", SHS())),
        m.if(m.i32.eqz(m.ref.is_null(L(6, SHS()))), m.if(m.i32.lt_u(a(), m.array.len(L(6, SHS()))), m.block(null, [
          S(2, m.array.get(L(6, SHS()), a(), SH(), false)),
          m.if(m.i32.eqz(m.ref.is_null(child())), m.return(child()))])))])),
      S(4, shapeGet(SHAPE_COUNT, s(), I)),
      m.if(shapeGet(SHAPE_DICT, s(), I), m.block(null, [
        S(3, shapeGet(SHAPE_KEYS, s(), I32S())),
        m.if(m.i32.ge_s(n(), m.array.len(keys())), m.block(null, [
          S(3, m.array.new_default(heap(I32S()), m.i32.add(m.i32.shl(n(), c(1)), c(4)))),
          m.array.copy(keys(), c(0), shapeGet(SHAPE_KEYS, s(), I32S()), c(0), n()),
          m.struct.set(SHAPE_KEYS, s(), keys())])),
        m.array.set(keys(), n(), a()),
        // A recorded attribute array stays aligned: the new slot is plain.
        m.if(m.i32.eqz(m.ref.is_null(shapeGet(SHAPE_FLAGS, s(), I8S()))), m.block(null, [
          m.if(m.i32.ge_s(n(), m.array.len(shapeGet(SHAPE_FLAGS, s(), I8S()))), m.block(null, [
            S(7, m.array.new_default(heap(I8S()), m.array.len(keys()))),
            m.array.copy(L(7, I8S()), c(0), shapeGet(SHAPE_FLAGS, s(), I8S()), c(0), n()),
            m.struct.set(SHAPE_FLAGS, s(), L(7, I8S()))])),
          m.array.set(shapeGet(SHAPE_FLAGS, s(), I8S()), n(), c(0))])),
        // The index takes the new key while it stays at most half full; else it is rebuilt on the next search.
        m.if(m.i32.eqz(m.ref.is_null(shapeGet(SHAPE_INDEX, s(), I32S()))),
          m.if(m.i32.gt_u(m.i32.shl(m.i32.add(n(), c(1)), c(1)), m.array.len(shapeGet(SHAPE_INDEX, s(), I32S()))),
            m.struct.set(SHAPE_INDEX, s(), m.ref.null(I32S())),
            m.call(indexPut(), [shapeGet(SHAPE_INDEX, s(), I32S()), a(), n()], N))),
        m.struct.set(SHAPE_COUNT, s(), m.i32.add(n(), c(1))),
        m.return(s()),
      ])),
      m.if(m.i32.eqz(m.ref.is_null(tkeys())),
        forRange(5, c(0), tcount, [m.if(m.i32.eq(m.array.get(tkeys(), k(), I, false), a()), m.return(m.array.get(tshapes(), k(), SH(), false)))])),
      S(3, m.array.new_default(heap(I32S()), m.i32.add(n(), c(1)))),
      m.array.copy(keys(), c(0), shapeGet(SHAPE_KEYS, s(), I32S()), c(0), n()),
      m.array.set(keys(), n(), a()),
      // Past the limit: an unshared dictionary shape, never a transition.
      m.if(m.i32.ge_s(n(), c(DICT_LIMIT)), m.return(m.call(toDict(), [newShape(keys(), () => m.i32.add(n(), c(1)), m.ref.null(SH()), c(0))], SH()))),
      S(2, newShape(keys(), () => m.i32.add(n(), c(1)), s(), c(0))),
      // Raise the slack of every ancestor to the new key count (once per new shape).
      S(8, s()),
      m.block(`slack.end.${sl}`, [m.loop(`slack.top.${sl}`, m.block(null, [
        m.br(`slack.end.${sl}`, m.ref.is_null(L(8, SH()))),
        m.br(`slack.end.${sl}`, m.i32.ge_s(shapeGet(SHAPE_SLACK, L(8, SH()), I), m.i32.add(n(), c(1)))),
        m.struct.set(SHAPE_SLACK, L(8, SH()), m.i32.add(n(), c(1))),
        S(8, shapeGet(SHAPE_PARENT, L(8, SH()), SH())),
        m.br(`slack.top.${sl}`)]))]),
      m.if(m.ref.is_null(tkeys()), m.block(null, [
        m.struct.set(SHAPE_TKEYS, s(), m.array.new_default(heap(I32S()), c(4))),
        m.struct.set(SHAPE_TSHAPES, s(), m.array.new_default(heap(SHS()), c(4)))]),
      m.if(m.i32.ge_s(tcount(), m.array.len(tkeys())), m.block(null, [
        S(3, m.array.new_default(heap(I32S()), m.i32.shl(tcount(), c(1)))),
        m.array.copy(keys(), c(0), tkeys(), c(0), tcount()), m.struct.set(SHAPE_TKEYS, s(), keys()),
        S(6, m.array.new_default(heap(SHS()), m.i32.shl(tcount(), c(1)))),
        m.array.copy(L(6, SHS()), c(0), tshapes(), c(0), tcount()), m.struct.set(SHAPE_TSHAPES, s(), L(6, SHS()))]))),
      m.array.set(tkeys(), tcount(), a()),
      m.array.set(tshapes(), tcount(), child()),
      m.struct.set(SHAPE_TCOUNT, s(), m.i32.add(tcount(), c(1))),
      m.if(isRoot(), m.call(rootKidSet(), [a(), child()], N)),
      child(),
    ], SH());
  });

  /* ── objects ─────────────────────────────────────────────────────── */
  const OBN = () => nn(OB());
  const shapeOf = (o: number) => m.struct.get(OBJ_SHAPE, o, SH(), false);
  const slotsOf = (o: number) => m.struct.get(OBJ_SLOTS, o, ANY(), false);
  const protoOf = (o: number) => m.struct.get(OBJ_PROTO, o, A, false);
  /* experimentalDynInlineSlots: slot j < INL is dyn:obj field OBJ_INLINE0 + j
   * (one allocation per object while it has at most INL properties); slot
   * j >= INL is element j - INL of the overflow array (the slots field). A
   * slot index known at compile time picks its home statically; a run-time
   * index (inline caches, whole-object walks) goes through $obj.slot.get/set,
   * a br_table over the inline fields. */
  const INL = ctx.inlineSlots ?? 0;
  const constI32 = (e: number): number | null => binaryen.getExpressionId(e) === binaryen.ConstId && binaryen.getExpressionType(e) === I ? (binaryen.getExpressionInfo(e) as binaryen.ConstInfo).value as number : null;
  /** Slot j of object o (j an i32 expression; o and j each evaluated once). */
  const slotGet = (o: number, j: number): number => {
    if (!INL) return m.array.get(slotsOf(o), j, A, false);
    const k = constI32(j);
    if (k !== null) return k < INL ? m.struct.get(OBJ_INLINE0 + k, o, A, false) : m.array.get(slotsOf(o), c(k - INL), A, false);
    return m.call(slotGetFn(), [o, j], A);
  };
  const slotSet = (o: number, j: number, v: number): number => {
    if (!INL) return m.array.set(slotsOf(o), j, v);
    const k = constI32(j);
    if (k !== null) return k < INL ? m.struct.set(OBJ_INLINE0 + k, o, v) : m.array.set(slotsOf(o), c(k - INL), v);
    return m.call(slotSetFn(), [o, j, v], N);
  };
  /** How many slots o holds without growing (its inline fields plus its overflow array). */
  const capOf = (o: number) => INL ? m.i32.add(c(INL), m.array.len(slotsOf(o))) : m.array.len(slotsOf(o));
  let inlineTables = 0;
  const inlineTable = (j: number, cases: number[], dflt: number, type: number): number => {
    const n = inlineTables++, labels = cases.map((_, i) => `is.${n}.${i}`), def = `is.${n}.def`;
    let cur = m.block(labels[0]!, [m.switch(labels, def, j)]);
    for (let i = 0; i < cases.length; i++) cur = m.block(i + 1 < cases.length ? labels[i + 1]! : def, [cur, cases[i]!]);
    return m.block(null, [cur, dflt], type);
  };
  const slotGetFn = () => helper("$obj.slot.get", [OB(), I], A, [], () => inlineTable(L(1, I),
    Array.from({ length: INL }, (_, i) => m.return(m.struct.get(OBJ_INLINE0 + i, L(0, OB()), A, false))),
    m.array.get(slotsOf(L(0, OB())), m.i32.sub(L(1, I), c(INL)), A, false), A));
  const slotSetFn = () => helper("$obj.slot.set", [OB(), I, A], N, [], () => inlineTable(L(1, I),
    Array.from({ length: INL }, (_, i) => m.block(null, [m.struct.set(OBJ_INLINE0 + i, L(0, OB()), L(2, A)), m.return()])),
    m.array.set(slotsOf(L(0, OB())), m.i32.sub(L(1, I), c(INL)), L(2, A)), N));
  /** An overflow array for `cap` slots in total (the shared empty one when the inline fields hold them). */
  const slotsFor = (cap: number) => cap <= INL ? noSlots() : m.array.new_default(heap(ANY()), c(cap - INL));
  const newObj = (shape: number, slots: number, inline: number[] = []) => m.struct.new([shape, slots, m.ref.null(A), m.ref.null(binaryen.externref),
    ...Array.from({ length: INL }, (_, i) => inline[i] ?? m.ref.null(A))], types.dynBox("dyn:obj").heap);
  /** An empty object with room for `cap` properties. With cap 0 the object
   * shares one empty slot array (never written: every store checks the
   * length) and its first add allocates by the shape's slack. */
  const create = (cap = 4) => newObj(m.call(root(), [], SH()), cap === 0 ? noSlots() : slotsFor(cap));
  const noSlots = () => {
    if (!noSlotsDeclared) { noSlotsDeclared = true; m.addGlobal("$obj.noSlots", nn(ANY()), false, m.array.new_fixed(heap(ANY()), [])); }
    return m.global.get("$obj.noSlots", nn(ANY()));
  };
  /** Generic get with an optional inline cache: own data, then the prototype chain. */
  const getAt = () => helper("$obj.getAt", [OB(), I, IC()], A, [SH(), I, A, OB()], () => {
    const o = () => L(0, OB()), a = () => L(1, I), ic = () => L(2, IC()), s = () => L(3, SH()), k = () => L(4, I), cur = () => L(5, A), co = () => L(6, OB());
    const n = loops++;
    return m.block(null, [
      S(3, shapeOf(o())), S(4, m.call(find(), [s(), a()], I)),
      m.if(m.i32.ge_s(k(), c(0)), m.block(null, [
        // A struct object: the field (plain data, never an accessor).
        ...(structOn ? [m.if(isStruct(s()), m.return(m.call(ctorGet(), [o(), k()], A)))] : []),
        m.if(m.i32.and(m.i32.eqz(m.ref.is_null(ic())), m.i32.eqz(shapeGet(SHAPE_DICT, s(), I))),
          m.block(null, [m.struct.set(IC_SHAPE, ic(), s()), m.struct.set(IC_SLOT, ic(), k())])),
        m.return(m.call(resolve(), [slotGet(o(), k()), o()], A))])),
      S(5, protoOf(o())),
      m.loop(`proto.${n}`, m.block(null, [
        // A null proto field is the default Object.prototype (its builtin
        // methods); the explicit null box (or anything else) ends the chain.
        m.if(m.ref.is_null(cur()), m.return(ctx.objectProto(a()))),
        m.if(m.i32.eqz(m.ref.test(cur(), OBN())), m.return(m.ref.null(A))),
        S(6, m.ref.cast(cur(), OBN())),
        S(4, m.call(find(), [shapeOf(co()), a()], I)),
        m.if(m.i32.ge_s(k(), c(0)), m.return(m.call(resolve(), [slotAt(co(), k()), o()], A))),
        S(5, protoOf(co())), m.br(`proto.${n}`)])),
      m.unreachable(),
    ], A);
  });
  /** Generic own-data set (adds through a transition), with an optional cache for existing slots. */
  /** A slot's value as read through property access: an accessor runs its getter on `recv`. */
  const resolve = () => helper("$obj.resolve", [A, A], A, [], () =>
    m.if(m.ref.test(L(0, A), nn(ACC())),
      m.if(m.ref.is_null(m.struct.get(0, m.ref.cast(L(0, A), nn(ACC())), A, false)), m.ref.null(A),
        ctx.callGetter(m.struct.get(0, m.ref.cast(L(0, A), nn(ACC())), A, false), L(1, A))),
      L(0, A)));
  /** Run an accessor's setter (1), or refuse when it has none (0). */
  const runSetter = (acc: number, recv: number, v: number) => m.block(null, [
    m.if(m.ref.is_null(m.struct.get(1, acc, A, false)), m.return(c(0))),
    ctx.callSetter(m.struct.get(1, acc, A, false), recv, v), m.return(c(1))]);
  /** Generic own-data set (adds through a transition), with an optional cache
   * for existing slots. An accessor (own, or inherited when one exists at all)
   * runs its setter instead. */
  const setAt = () => helper("$obj.setAt", [OB(), I, A, IC()], I, [SH(), I, SH(), I, ANY(), A, OB()], () => {
    declareGlobals();
    const o = () => L(0, OB()), a = () => L(1, I), v = () => L(2, A), ic = () => L(3, IC()), s = () => L(4, SH()), k = () => L(5, I), ns = () => L(6, SH()), n = () => L(7, I), grown = () => L(8, ANY());
    const cur = () => L(9, A), co = () => L(10, OB()), lp = loops++;
    return m.block(null, [
      // A struct object: an existing key's field takes the value when it can
      // hold it; otherwise (or for a new key) the object becomes ordinary first.
      ...(structOn ? [m.if(isStruct(shapeOf(o())), m.block(null, [
        S(5, m.call(find(), [shapeOf(o()), a()], I)),
        m.if(m.i32.ge_s(k(), c(0)), m.if(m.call(ctorSet(), [o(), k(), v()], I), m.return(c(1)))),
        m.call(ctorDemote(), [o()], N)]))] : []),
      S(4, shapeOf(o())), S(5, m.call(find(), [s(), a()], I)),
      m.if(m.i32.ge_s(k(), c(0)), m.block(null, [
        m.if(m.ref.test(slotGet(o(), k()), nn(ACC())), runSetter(m.ref.cast(slotGet(o(), k()), nn(ACC())), o(), v())),
        m.if(m.i32.and(m.call(flagsAt(), [s(), k()], I), c(ATTR_READONLY)), m.return(c(0))),
        m.if(m.i32.and(m.i32.eqz(m.ref.is_null(ic())), m.i32.eqz(shapeGet(SHAPE_DICT, s(), I))),
          m.block(null, [m.struct.set(IC_SHAPE, ic(), s()), m.struct.set(IC_SLOT, ic(), k())])),
        slotSet(o(), k(), v()), m.return(c(1))])),
      // A new own key: an inherited accessor's setter takes the write instead.
      m.if(m.global.get("$acc.any", I), m.block(`set.walk.end.${lp}`, [
        S(9, protoOf(o())),
        m.loop(`set.walk.${lp}`, m.block(null, [
          m.br(`set.walk.end.${lp}`, m.i32.eqz(m.ref.test(cur(), OBN()))),
          S(10, m.ref.cast(cur(), OBN())),
          S(5, m.call(find(), [shapeOf(co()), a()], I)),
          m.if(m.i32.ge_s(k(), c(0)), m.block(null, [
            // A struct object's fields are plain data (never an accessor).
            ...(structOn ? [m.br(`set.walk.end.${lp}`, isStruct(shapeOf(co())))] : []),
            m.if(m.ref.test(slotGet(co(), k()), nn(ACC())), runSetter(m.ref.cast(slotGet(co(), k()), nn(ACC())), o(), v())),
            m.br(`set.walk.end.${lp}`)])),
          S(9, protoOf(co())), m.br(`set.walk.${lp}`)]))])),
      // A non-extensible object refuses the new key (0).
      m.if(m.i32.eqz(m.call(append(), [o(), a(), v()], I)), m.return(c(0))),
      // A shared (non-dictionary) transition: the site's cache remembers it,
      // with the prototype whose chain was just searched for setters (an
      // eq reference or none; a page prototype is never cached).
      S(6, shapeOf(o())), S(9, protoOf(o())),
      m.if(m.i32.and(m.i32.eqz(m.ref.is_null(ic())), m.i32.eqz(m.i32.or(shapeGet(SHAPE_DICT, s(), I), shapeGet(SHAPE_DICT, ns(), I)))),
        m.if(m.i32.or(m.ref.is_null(cur()), m.ref.test(cur(), nn(binaryen.eqref))), m.block(null, [
          m.struct.set(IC_TFROM, ic(), s()), m.struct.set(IC_TTO, ic(), ns()), m.struct.set(IC_TSLOT, ic(), m.i32.sub(shapeGet(SHAPE_COUNT, ns(), I), c(1))),
          m.struct.set(IC_TPROTO, ic(), m.ref.cast(cur(), binaryen.eqref)), m.struct.set(IC_TEPOCH, ic(), m.global.get("$acc.epoch", I))]),
          m.struct.set(IC_TFROM, ic(), m.ref.null(SH())))),
      c(1),
    ], I);
  });
  /** A cached write's miss path: the site's add transition when the object is
   * in its from-shape (a compare and a store), else the generic set. The key
   * is absent from the from-shape; the generic path would also search the
   * prototype chain for a setter, which is unnecessary while no accessor
   * exists, and otherwise unchanged while the object has the cached
   * prototype and no accessor or prototype change happened since. */
  const setIC = () => helper("$obj.setIC", [OB(), I, A, nn(IC())], I, [I, ANY()], () => {
    declareGlobals();
    const o = () => L(0, OB()), ic = () => L(3, nn(IC())), k = () => L(4, I), sl = () => L(5, ANY());
    return m.block(null, [
      m.if(m.if(m.ref.eq(shapeOf(o()), m.struct.get(IC_TFROM, ic(), SH(), false)),
        m.if(m.global.get("$acc.any", I), m.call(sameProto(), [o(), ic()], I), c(1)), c(0)), m.block(null, [
        S(4, m.struct.get(IC_TSLOT, ic(), I, false)),
        ...(INL ? [
          m.if(m.i32.ge_u(k(), capOf(o())), m.drop(m.call(grow(), [o(), m.i32.add(k(), c(1)), m.struct.get(IC_TTO, ic(), SH(), false)], ANY()))),
          slotSet(o(), k(), L(2, A))] : [
          S(5, slotsOf(o())),
          m.if(m.i32.ge_u(k(), m.array.len(sl())), S(5, m.call(grow(), [o(), m.i32.add(k(), c(1)), m.struct.get(IC_TTO, ic(), SH(), false)], ANY()))),
          m.array.set(sl(), k(), L(2, A))]),
        m.struct.set(OBJ_SHAPE, o(), m.struct.get(IC_TTO, ic(), SH(), false)),
        m.return(c(1))])),
      m.call(setAt(), [o(), L(1, I), L(2, A), ic()], I),
    ], I);
  });
  const sameProto = () => helper("$obj.setIC.chain", [OB(), nn(IC())], I, [A], () => {
    const o = () => L(0, OB()), ic = () => L(1, nn(IC())), p = () => L(2, A);
    return m.block(null, [S(2, protoOf(o())),
      m.if(m.i32.ne(m.global.get("$acc.epoch", I), m.struct.get(IC_TEPOCH, ic(), I, false)), m.return(c(0))),
      m.if(m.ref.is_null(p()), m.return(m.ref.is_null(m.struct.get(IC_TPROTO, ic(), binaryen.eqref, false)))),
      m.if(m.i32.eqz(m.ref.test(p(), nn(binaryen.eqref))), m.return(c(0))),
      m.ref.eq(m.ref.cast(p(), nn(binaryen.eqref)), m.struct.get(IC_TPROTO, ic(), binaryen.eqref, false))], I);
  });
  /** Replace o's slots with a larger array for `n` keys under shape `ns`
   * (the first n-1 carried over). Below DICT_LIMIT keys the size is what
   * the shape path learned: ns's slack (the largest object seen through ns)
   * when it exceeds n, else geometric growth (2n+2), never past DICT_LIMIT,
   * where objects become dictionaries; a first array (from the shared empty
   * one) takes the slack with no growth floor. A dictionary past DICT_LIMIT
   * grows geometrically (live objects keep their arrays, so spare slots stay
   * resident: the slack bounds them by what objects on the path reached). */
  const grow = () => helper("$obj.grow", [OB(), I, SH()], ANY(), [I, ANY()], () => {
    const o = () => L(0, OB()), n = () => L(1, I), cap = () => L(3, I), grown = () => L(4, ANY());
    const geometric = () => m.i32.add(m.i32.shl(n(), c(1)), c(2));
    /** The slot count for n keys (local 3), from what the shape path learned. */
    const sizeCap = () => m.block(null, [
      S(3, shapeGet(SHAPE_SLACK, L(2, SH()), I)),
      m.if(m.i32.ge_s(n(), c(DICT_LIMIT)), S(3, geometric()),
        m.block(null, [
          m.if(m.i32.and(m.i32.le_s(cap(), n()), m.i32.ne(m.array.len(slotsOf(o())), c(0))), S(3, geometric())),
          m.if(m.i32.gt_s(cap(), c(DICT_LIMIT)), S(3, c(DICT_LIMIT))),
          m.if(m.i32.lt_s(cap(), n()), S(3, n()))]))]);
    // Inline slots: the overflow array holds slots INL.. of the cap computed
    // for all of them (n > INL here: the inline fields were full).
    if (INL) return m.block(null, [
      sizeCap(),
      S(4, m.array.new_default(heap(ANY()), m.i32.sub(cap(), c(INL)))),
      m.if(m.i32.gt_s(m.i32.sub(n(), c(1)), c(INL)), m.array.copy(grown(), c(0), slotsOf(o()), c(0), m.i32.sub(m.i32.sub(n(), c(1)), c(INL)))),
      m.struct.set(OBJ_SLOTS, o(), grown()),
      grown(),
    ], ANY());
    return m.block(null, [
      sizeCap(),
      S(4, m.array.new_default(heap(ANY()), cap())),
      m.array.copy(grown(), c(0), slotsOf(o()), c(0), m.i32.sub(n(), c(1))),
      m.struct.set(OBJ_SLOTS, o(), grown()),
      grown(),
    ], ANY());
  });
  /** Add own key `a` holding `v` through a shape transition (the key is
   * absent): 1, or 0 when the object is not extensible (nothing added). */
  const append = () => helper("$obj.append", [OB(), I, A], I, [SH(), I, SH(), I, ANY()], () => {
    const o = () => L(0, OB()), a = () => L(1, I), v = () => L(2, A), s = () => L(3, SH()), ns = () => L(5, SH()), n = () => L(6, I);
    return m.block(null, [
      ...demoteFirst(o),
      S(3, shapeOf(o())),
      m.if(m.i32.and(shapeGet(SHAPE_DICT, s(), I), c(SHAPE_NOEXT)), m.return(c(0))),
      S(5, m.call(add(), [s(), a()], SH())),
      S(6, shapeGet(SHAPE_COUNT, ns(), I)),
      m.if(m.i32.gt_s(n(), capOf(o())), m.drop(m.call(grow(), [o(), n(), ns()], ANY()))),
      slotSet(o(), m.i32.sub(n(), c(1)), v()),
      m.struct.set(OBJ_SHAPE, o(), ns()),
      c(1),
    ], I);
  });
  /** Definition: own slot `a` holds `v` directly (no setter, no attribute check). */
  const defineRaw = () => helper("$obj.defineRaw", [OB(), I, A], N, [I], () => m.block(null, [
    ...demoteFirst(() => L(0, OB())),
    S(3, m.call(find(), [shapeOf(L(0, OB())), L(1, I)], I)),
    m.if(m.i32.ge_s(L(3, I), c(0)), slotSet(L(0, OB()), L(3, I), L(2, A)), m.drop(m.call(append(), [L(0, OB()), L(1, I), L(2, A)], I)))]));
  /** `delete o[atom]`: the object moves to a dictionary shape; 0 when the property is non-configurable. */
  const del = () => helper("$obj.delete", [OB(), I], I, [I, SH(), I, I], () => {
    const o = () => L(0, OB()), k = () => L(2, I), d = () => L(3, SH()), n = () => L(4, I), j = () => L(5, I);
    const keys = () => shapeGet(SHAPE_KEYS, d(), I32S());
    return m.block(null, [
      S(2, m.call(find(), [shapeOf(o()), L(1, I)], I)),
      m.if(m.i32.lt_s(k(), c(0)), m.return(c(1))),
      ...demoteFirst(o),
      m.if(m.i32.and(m.call(flagsAt(), [shapeOf(o()), k()], I), c(ATTR_FIXED)), m.return(c(0))),
      S(3, shapeOf(o())),
      m.if(m.i32.eqz(shapeGet(SHAPE_DICT, d(), I)), S(3, m.call(toDict(), [d()], SH()))),
      S(4, m.i32.sub(shapeGet(SHAPE_COUNT, d(), I), c(1))),
      // The index drops the key and renumbers the later slots (before the keys move down).
      m.if(m.i32.eqz(m.ref.is_null(shapeGet(SHAPE_INDEX, d(), I32S()))), m.call(indexRemove(), [shapeGet(SHAPE_INDEX, d(), I32S()), keys(), k(), shapeGet(SHAPE_COUNT, d(), I)], N)),
      forRange(5, k(), n, [
        m.array.set(keys(), j(), m.array.get(keys(), m.i32.add(j(), c(1)), I, false)),
        slotSet(o(), j(), slotGet(o(), m.i32.add(j(), c(1)))),
        m.if(m.i32.eqz(m.ref.is_null(shapeGet(SHAPE_FLAGS, d(), I8S()))),
          m.array.set(shapeGet(SHAPE_FLAGS, d(), I8S()), j(), m.call(flagsAt(), [d(), m.i32.add(j(), c(1))], I)))]),
      slotSet(o(), n(), m.ref.null(A)),
      m.struct.set(SHAPE_COUNT, d(), n()),
      m.struct.set(OBJ_SHAPE, o(), d()),
      c(1),
    ], I);
  });
  /** `atom in o` through the prototype chain. */
  const has = () => helper("$obj.has", [OB(), I], I, [A, OB()], () => {
    const n = loops++;
    return m.block(null, [
      S(2, L(0, OB())),
      m.loop(`has.${n}`, m.block(null, [
        m.if(m.ref.is_null(L(2, A)), m.return(ctx.objectProtoHas(L(1, I)))),
        m.if(m.i32.eqz(m.ref.test(L(2, A), OBN())), m.return(c(0))),
        S(3, m.ref.cast(L(2, A), OBN())),
        m.if(m.i32.ge_s(m.call(find(), [shapeOf(L(3, OB())), L(1, I)], I), c(0)), m.return(c(1))),
        S(2, protoOf(L(3, OB()))), m.br(`has.${n}`)])),
      m.unreachable(),
    ], I);
  });
  /** Own keys in JS order: array indices ascending, then insertion order.
   * Enumerable only, or every own key (`all`: Reflect.ownKeys, getOwnPropertyNames). */
  const ownKeys = (all = false) => helper(all ? "$obj.ownKeysAll" : "$obj.ownKeys", [OB()], A, [SH(), I, I, I, I, I32S(), A, I], () => {
    const visible = (flags: number) => m.i32.eqz(m.i32.and(flags, c(all ? ATTR_INTERNAL : ATTR_HIDDEN | ATTR_INTERNAL)));
    const o = () => L(0, OB()), s = () => L(1, SH()), n = () => L(2, I), k = () => L(3, I), j = () => L(4, I), t = () => L(5, I), ids = () => L(6, I32S()), out = () => L(7, A), ni = () => L(8, I);
    const keyAt = (i: number) => m.array.get(shapeGet(SHAPE_KEYS, s(), I32S()), i, I, false);
    // The atom table is ensured once below (a literal's compile-time atoms need not have seeded it).
    const idx = (i: number) => m.array.get(idxs(), i, I, false);
    const push = (atomExpr: number) => m.call(ctx.dynArrPush(), [m.ref.cast(out(), nn(types.dynBox("dyn:arr").ref)), m.call(atomBox(), [atomExpr], nn(types.dynBox("dyn:str").ref))], N);
    const n2 = loops++;
    const isIndexKey = () => m.i32.and(m.i32.ne(idx(keyAt(k())), c(-1)), visible(m.call(flagsAt(), [s(), k()], I)));
    return m.block(null, [
      m.call(ensure(), [], N),
      S(1, shapeOf(o())), S(2, shapeGet(SHAPE_COUNT, s(), I)),
      // Sized for every key: no regrowth while pushing.
      S(7, ctx.newDynArr(n())),
      // Index-like atoms, insertion-sorted by value (the scratch array only when some exist).
      S(8, c(0)),
      forRange(3, c(0), n, [m.if(isIndexKey(), inc(8))]),
      m.if(ni(), m.block(null, [S(6, m.array.new_default(heap(I32S()), ni())), S(8, c(0)), forRange(3, c(0), n, [m.if(isIndexKey(), m.block(null, [
        S(4, ni()),
        m.block(`ins.end.${n2}`, [m.loop(`ins.top.${n2}`, m.block(null, [
          m.br(`ins.end.${n2}`, m.i32.le_s(j(), c(0))),
          m.br(`ins.end.${n2}`, m.i32.le_u(idx(m.array.get(ids(), m.i32.sub(j(), c(1)), I, false)), idx(keyAt(k())))),
          m.array.set(ids(), j(), m.array.get(ids(), m.i32.sub(j(), c(1)), I, false)),
          S(4, m.i32.sub(j(), c(1))), m.br(`ins.top.${n2}`)]))]),
        m.array.set(ids(), j(), keyAt(k())), inc(8)]))])])),
      forRange(5, c(0), ni, [push(m.array.get(ids(), t(), I, false))]),
      // Names only: a symbol key's reserved name is not a string key (Object.keys, for-in, getOwnPropertyNames).
      forRange(3, c(0), n, [m.if(m.i32.and(m.i32.and(m.i32.eq(idx(keyAt(k())), c(-1)), visible(m.call(flagsAt(), [s(), k()], I))), m.i32.eqz(m.call(isSymbolAtom(), [keyAt(k())], I))), push(keyAt(k())))]),
      out(),
    ], A);
  });

  /** Every own symbol key's reserved name, in insertion order (a facade's ownKeys turns them into symbols). */
  const ownSymbols = () => helper("$obj.ownSymbols", [OB()], A, [SH(), I, I, A], () => {
    const o = () => L(0, OB()), s = () => L(1, SH()), n = () => L(2, I), k = () => L(3, I), out = () => L(4, A);
    const keyAt = (i: number) => m.array.get(shapeGet(SHAPE_KEYS, s(), I32S()), i, I, false);
    return m.block(null, [
      m.call(ensure(), [], N),
      S(1, shapeOf(o())), S(2, shapeGet(SHAPE_COUNT, s(), I)), S(4, ctx.newDynArr(c(0))),
      forRange(3, c(0), n, [m.if(m.i32.and(m.call(isSymbolAtom(), [keyAt(k())], I), m.i32.eqz(m.i32.and(m.call(flagsAt(), [s(), k()], I), c(ATTR_INTERNAL)))),
        m.call(ctx.dynArrPush(), [m.ref.cast(out(), nn(types.dynBox("dyn:arr").ref)), m.call(atomBox(), [keyAt(k())], nn(types.dynBox("dyn:str").ref))], N))]),
      out(),
    ], A);
  });
  /** Object.keys for a caller that only reads the result (escape-checked by the
   * emitter: a local read only through `.length` and `[i]`): a shared shape's
   * key array is the same for every object of that shape, so the last two
   * shapes' arrays are reused. Dictionary and constructor-struct shapes
   * (SHAPE_DICT != 0) answer a fresh ownKeys. The arrays are never handed to
   * code that could change them. */
  let keysCacheDeclared = false;
  const ownKeysShared = () => helper("$obj.ownKeys.shared", [OB()], A, [SH(), A], () => {
    if (!keysCacheDeclared) {
      keysCacheDeclared = true;
      for (const k of [0, 1]) { m.addGlobal(`$keysro.s${k}`, SH(), true, m.ref.null(SH())); m.addGlobal(`$keysro.a${k}`, A, true, m.ref.null(A)); }
    }
    const o = () => L(0, OB()), sh = () => L(1, SH()), r = () => L(2, A);
    const G = (n: string, t: number) => m.global.get(n, t);
    return m.block(null, [
      S(1, shapeOf(o())),
      m.if(shapeGet(SHAPE_DICT, sh(), I), m.return(m.call(ownKeys(), [o()], A))),
      m.if(m.ref.eq(sh(), G("$keysro.s0", SH())), m.return(G("$keysro.a0", A))),
      m.if(m.ref.eq(sh(), G("$keysro.s1", SH())), m.return(G("$keysro.a1", A))),
      S(2, m.call(ownKeys(), [o()], A)),
      m.global.set("$keysro.s1", G("$keysro.s0", SH())), m.global.set("$keysro.a1", G("$keysro.a0", A)),
      m.global.set("$keysro.s0", sh()), m.global.set("$keysro.a0", r()),
      r(),
    ], A);
  });

  /** The atoms a for-in over `v` visits, when they are exactly its shape's
   * key list in order, or null. That holds for a native object whose shape is
   * shared (non-dictionary: its key array is never mutated, and every key is
   * enumerable), with no array-index key (those enumerate first, ascending),
   * and whose prototype adds nothing (not a native object: the default
   * Object.prototype has no enumerable keys). The array is the live shape's
   * own, so the caller holds a snapshot without copying it. */
  const forInAtoms = () => helper("$obj.forInAtoms", [A], I32S(), [OB(), SH(), I32S(), I], () => {
    const v = () => L(0, A), o = () => L(1, OB()), s = () => L(2, SH()), keys = () => L(3, I32S()), k = () => L(4, I);
    return m.block(null, [
      m.if(m.i32.eqz(m.ref.test(v(), OBN())), m.return(m.ref.null(I32S()))),
      S(1, m.ref.cast(v(), OBN())), S(2, shapeOf(o())),
      m.if(shapeGet(SHAPE_DICT, s(), I), m.return(m.ref.null(I32S()))),
      m.if(m.ref.test(protoOf(o()), OBN()), m.return(m.ref.null(I32S()))),
      S(3, shapeGet(SHAPE_KEYS, s(), I32S())),
      m.if(m.i32.ne(m.array.len(keys()), shapeGet(SHAPE_COUNT, s(), I)), m.return(m.ref.null(I32S()))),
      m.call(ensure(), [], N),
      forRange(4, c(0), () => m.array.len(keys()), [
        m.if(m.i32.or(m.i32.ne(m.array.get(idxs(), m.array.get(keys(), k(), I, false), I, false), c(-1)), m.call(isSymbolAtom(), [m.array.get(keys(), k(), I, false)], I)), m.return(m.ref.null(I32S())))]),
      keys(),
    ], I32S());
  });

  /** Record attribute bits for an existing own property (moves the object to a dictionary shape). */
  const setFlags = () => helper("$obj.setFlags", [OB(), I, I], N, [SH(), I, I8S()], () => {
    const o = () => L(0, OB()), a = () => L(1, I), f = () => L(2, I), d = () => L(3, SH()), k = () => L(4, I), fl = () => L(5, I8S());
    return m.block(null, [
      ...demoteFirst(o),
      S(3, shapeOf(o())),
      m.if(m.i32.eqz(shapeGet(SHAPE_DICT, d(), I)), m.block(null, [S(3, m.call(toDict(), [d()], SH())), m.struct.set(OBJ_SHAPE, o(), d())])),
      S(4, m.call(find(), [d(), a()], I)),
      m.if(m.i32.lt_s(k(), c(0)), m.return()),
      S(5, shapeGet(SHAPE_FLAGS, d(), I8S())),
      m.if(m.if(m.ref.is_null(fl()), c(1), m.i32.ge_u(k(), m.array.len(fl()))), m.block(null, [
        S(5, m.array.new_default(heap(I8S()), m.array.len(shapeGet(SHAPE_KEYS, d(), I32S())))),
        m.if(m.i32.eqz(m.ref.is_null(shapeGet(SHAPE_FLAGS, d(), I8S()))),
          m.array.copy(fl(), c(0), shapeGet(SHAPE_FLAGS, d(), I8S()), c(0), m.array.len(shapeGet(SHAPE_FLAGS, d(), I8S())))),
        m.struct.set(SHAPE_FLAGS, d(), fl())])),
      m.array.set(fl(), k(), f()),
    ]);
  });

  /** Integrity levels (Object.preventExtensions 0, seal 1, freeze 2): the
   * object moves to its own dictionary shape marked SHAPE_NOEXT; seal makes
   * every key ATTR_FIXED, freeze also makes every data key ATTR_READONLY. */
  const integrity = () => helper("$obj.integrity", [OB(), I], N, [SH(), I, I8S(), I, I], () => {
    const o = () => L(0, OB()), level = () => L(1, I), d = () => L(2, SH()), n = () => L(3, I), fl = () => L(4, I8S()), k = () => L(5, I);
    return m.block(null, [
      ...demoteFirst(o),
      S(2, shapeOf(o())),
      m.if(m.i32.eqz(shapeGet(SHAPE_DICT, d(), I)), m.block(null, [S(2, m.call(toDict(), [d()], SH())), m.struct.set(OBJ_SHAPE, o(), d())])),
      m.struct.set(SHAPE_DICT, d(), m.i32.or(shapeGet(SHAPE_DICT, d(), I), c(SHAPE_NOEXT))),
      m.if(m.i32.eqz(level()), m.return()),
      S(3, shapeGet(SHAPE_COUNT, d(), I)),
      // A flag per key slot (the key array's length, as setFlags keeps it).
      S(4, m.array.new_default(heap(I8S()), m.array.len(shapeGet(SHAPE_KEYS, d(), I32S())))),
      m.if(m.i32.eqz(m.ref.is_null(shapeGet(SHAPE_FLAGS, d(), I8S()))),
        m.array.copy(fl(), c(0), shapeGet(SHAPE_FLAGS, d(), I8S()), c(0), m.array.len(shapeGet(SHAPE_FLAGS, d(), I8S())))),
      forRange(5, c(0), n, [m.array.set(fl(), k(), m.i32.or(m.array.get(fl(), k(), I, false),
        m.if(m.i32.and(m.i32.eq(level(), c(2)), m.i32.eqz(m.ref.test(slotGet(o(), k()), nn(ACC())))), c(ATTR_FIXED | ATTR_READONLY), c(ATTR_FIXED))))]),
      m.struct.set(SHAPE_FLAGS, d(), fl()),
    ]);
  });
  /** Whether the object is at least at an integrity level: 0 not extensible, 1 sealed, 2 frozen. */
  const testIntegrity = () => helper("$obj.testIntegrity", [OB(), I], I, [SH(), I, I], () => {
    const o = () => L(0, OB()), level = () => L(1, I), s = () => L(2, SH()), k = () => L(3, I), f = () => L(4, I);
    return m.block(null, [
      S(2, shapeOf(o())),
      m.if(m.i32.eqz(m.i32.and(shapeGet(SHAPE_DICT, s(), I), c(SHAPE_NOEXT))), m.return(c(0))),
      forRange(3, c(0), () => m.if(m.i32.eqz(level()), c(0), shapeGet(SHAPE_COUNT, s(), I)), [
        S(4, m.call(flagsAt(), [s(), k()], I)),
        m.if(m.i32.eqz(m.i32.and(f(), c(ATTR_FIXED))), m.return(c(0))),
        m.if(m.i32.and(m.i32.eq(level(), c(2)), m.i32.eqz(m.ref.test(slotGet(o(), k()), nn(ACC())))),
          m.if(m.i32.eqz(m.i32.and(f(), c(ATTR_READONLY))), m.return(c(0))))]),
      c(1),
    ], I);
  });

  const bumpEpoch = () => m.global.set("$acc.epoch", m.i32.add(m.global.get("$acc.epoch", I), c(1)));

  /* ── constructor structs (ctor-structs.ts) ───────────────────────────
   * A struct object's properties live in its fields; its shape is one of
   * its constructor's S_C^k (keys: the first k properties, SHAPE_DICT =
   * SHAPE_STRUCT), so the generic paths below recognise it by its shape:
   * reads and writes of an existing key go to the field, and anything else
   * first converts it in place to an ordinary object (demote). */
  const ctors = ctx.ctorStructs ?? [];
  const structOn = ctors.length > 0;
  const isStruct = (s: number) => m.i32.eq(shapeGet(SHAPE_DICT, s, I), c(SHAPE_STRUCT));
  const ctorNN = (i: number) => nn(ctors[i]!.ref);
  const ctorShapes = new Set<string>();
  /** S_C^k as an immutable global with a constant initializer (created on first use, so its atoms come after the reserved ones). */
  const ctorShape = (i: number, k: number): number => {
    const g = `$ctor.${ctors[i]!.key}.s${k}`;
    if (!ctorShapes.has(g)) {
      ctorShapes.add(g);
      declareGlobals();
      const atoms = ctors[i]!.fields.slice(0, k).map(f => c(atom(f.name)));
      m.addGlobal(g, nn(SH()), false, m.struct.new([m.array.new_fixed(heap(I32S()), atoms), c(k), m.ref.null(SH()), m.ref.null(I32S()), m.ref.null(SHS()), c(0),
        c(SHAPE_STRUCT), m.ref.null(I8S()), c(k), m.ref.null(I32S())], heap(SH())));
    }
    return m.global.get(g, nn(SH()));
  };
  const ctorGlobal = (i: number, name: string, type: number, init: () => number) => {
    const g = `$ctor.${ctors[i]!.key}.${name}`;
    if (!ctorShapes.has(g)) { ctorShapes.add(g); m.addGlobal(g, type, true, init()); }
    return g;
  };
  const demotedGlobal = (i: number) => ctorGlobal(i, "demoted", I, () => c(0));
  /** Struct objects constructor i allocated (the demotion share's denominator). */
  const allocsGlobal = (i: number) => ctorGlobal(i, "allocs", I, () => c(0));
  /** 1 while no object of constructor i was ever converted: then every reachable struct
   * object of i (construction never lets one escape early) is complete, S_C^n. */
  const cleanGlobal = (i: number) => ctorGlobal(i, "clean", I, () => c(1));
  let tables = 0;
  /** br_table over i32 `k`: case j runs cases[j] (each ends in a return), anything else `dflt`. */
  const brTable = (k: number, cases: number[], dflt: number): number => {
    const n = tables++, labels = cases.map((_, j) => `ct.${n}.${j}`), def = `ct.${n}.def`;
    let cur = m.block(labels[0]!, [m.switch(labels, def, k)]);
    for (let j = 0; j < cases.length; j++) cur = m.block(j + 1 < cases.length ? labels[j + 1]! : def, [cur, cases[j]!]);
    return m.block(null, [cur, dflt]);
  };
  const fieldType = (kind: "any" | "i32" | "f64") => kind === "any" ? A : kind === "i32" ? I : binaryen.f64;
  const layouts = ctors.map(ct => ctorFieldLayout(ct.fields.map(f => f.kind), INL));
  /** Struct field index of constructor i's field j (ctorFieldLayout). */
  const fieldAt = (i: number, j: number) => layouts[i]!.index[j]!;
  /** Field j of struct `t` as a dyn value. */
  const fieldRead = (i: number, j: number, t: number): number => {
    const f = ctors[i]!.fields[j]!, v = m.struct.get(fieldAt(i, j), t, fieldType(f.kind), false);
    return f.kind === "any" ? v : ctx.boxNum!(f.kind === "i32" ? m.f64.convert_s.i32(v) : v);
  };
  /** Positional property k of struct object `o` (k below its shape's count). */
  const ctorGet = () => helper("$ctor.get", [OB(), I], A, [], () => {
    const o = () => L(0, OB()), k = () => L(1, I);
    return m.block(null, [
      ...ctors.map((ct, i) => m.if(m.ref.test(o(), ctorNN(i)),
        brTable(k(), ct.fields.map((_, j) => m.return(fieldRead(i, j, m.ref.cast(o(), ctorNN(i))))), m.unreachable()))),
      m.unreachable()], A);
  });
  /** Store dyn `v` as positional property k of struct object `o`: 1, or 0 when a typed field cannot hold it (nothing stored). */
  const ctorSet = () => helper("$ctor.set", [OB(), I, A], I, [binaryen.f64, I], () => {
    const o = () => L(0, OB()), k = () => L(1, I), v = () => L(2, A), f = () => L(3, binaryen.f64), n = () => L(4, I);
    const write = (i: number, j: number): number => {
      const t = () => m.ref.cast(o(), ctorNN(i)), kind = ctors[i]!.fields[j]!.kind, idx = fieldAt(i, j);
      if (kind === "any") return m.block(null, [m.struct.set(idx, t(), v()), m.return(c(1))]);
      const num = m.block(null, [S(3, ctx.numOf!(v())),
        ...(kind === "f64" ? [m.struct.set(idx, t(), f()), m.return(c(1))] : [
          // An int32 (not -0, not NaN): the bit pattern survives the round trip.
          S(4, m.i32.trunc_s_sat.f64(f())),
          m.if(m.i64.eq(m.i64.reinterpret(m.f64.convert_s.i32(n())), m.i64.reinterpret(f())), m.block(null, [m.struct.set(idx, t(), n()), m.return(c(1))]))])]);
      // dynI31: an i31 fits an i32 field as it stands.
      const small = kind === "i32" && ctx.i31 ? [m.if(m.ref.test(v(), ctx.i31), m.block(null, [m.struct.set(idx, t(), m.i31.get_s(m.ref.cast(v(), ctx.i31))), m.return(c(1))]))] : [];
      return m.block(null, [...small, m.if(ctx.isNum!(v()), num), m.return(c(0))]);
    };
    return m.block(null, [
      ...ctors.map((ct, i) => m.if(m.ref.test(o(), ctorNN(i)), brTable(k(), ct.fields.map((_, j) => write(i, j)), m.unreachable()))),
      m.unreachable()], I);
  });
  /** Convert a struct object in place to an ordinary object: the generic
   * shape for its keys (the transitions a generic object built the same way
   * took) and a slot array filled from its fields. No-op for anything else. */
  const ctorDemote = () => helper("$ctor.demote", [OB()], N, [SH(), I, SH(), I, ANY(), ...Array.from({ length: INL }, () => A)], () => {
    const o = () => L(0, OB()), s = () => L(1, SH()), n = () => L(2, I), ns = () => L(3, SH()), j = () => L(4, I), sl = () => L(5, ANY());
    return m.block(null, [
      S(1, shapeOf(o())),
      m.if(m.i32.eqz(isStruct(s())), m.return()),
      S(2, shapeGet(SHAPE_COUNT, s(), I)), S(3, m.call(root(), [], SH())),
      forRange(4, c(0), n, [S(3, m.call(add(), [ns(), m.array.get(shapeGet(SHAPE_KEYS, s(), I32S()), j(), I, false)], SH()))]),
      ...(INL ? [
        // The inline fields take the first INL properties. The struct's own
        // anyref fields may live in them (ctorFieldLayout), so every field is
        // read (the first INL into locals, the rest into the overflow array)
        // before any inline field is written.
        ...Array.from({ length: INL }, (_, q) => m.if(m.i32.gt_s(n(), c(q)), S(6 + q, m.call(ctorGet(), [o(), c(q)], A)))),
        S(5, m.if(m.i32.gt_s(n(), c(INL)), m.array.new_default(heap(ANY()), m.i32.sub(n(), c(INL))), noSlots())),
        forRange(4, c(INL), n, [m.array.set(sl(), m.i32.sub(j(), c(INL)), m.call(ctorGet(), [o(), j()], A))]),
        m.struct.set(OBJ_SLOTS, o(), sl()),
        ...Array.from({ length: INL }, (_, q) => m.struct.set(OBJ_INLINE0 + q, o(), L(6 + q, A)))] : [
        S(5, m.if(n(), m.array.new_default(heap(ANY()), n()), noSlots())),
        forRange(4, c(0), n, [m.array.set(sl(), j(), m.call(ctorGet(), [o(), j()], A))]),
        m.struct.set(OBJ_SLOTS, o(), sl())]),
      m.struct.set(OBJ_SHAPE, o(), ns()),
      ...ctors.map((_, i) => m.if(m.ref.test(o(), ctorNN(i)), m.block(null, [m.global.set(cleanGlobal(i), c(0)),
        m.global.set(demotedGlobal(i), m.i32.add(m.global.get(demotedGlobal(i), I), c(1)))]))),
    ]);
  });
  /** A fresh struct object of constructor i at S_C^0 (no property yet) with prototype `proto`. */
  const ctorNew = (i: number) => helper(`$ctor.${ctors[i]!.key}.new`, [A], ctorNN(i), [], () => m.block(null, [
    m.global.set(allocsGlobal(i), m.i32.add(m.global.get(allocsGlobal(i), I), c(1))),
    m.struct.new([ctorShape(i, 0), noSlots(), L(0, A), m.ref.null(binaryen.externref), ...Array.from({ length: INL }, () => m.ref.null(A)),
      ...layouts[i]!.extra.map(k => k === "any" ? m.ref.null(A) : k === "i32" ? c(0) : m.f64.const(0))], heap(ctors[i]!.ref))], ctorNN(i)));
  /** A literal layout's struct object, complete (S_L^n) with the default prototype: `values` are
   * field j's value in its field kind (an anyref, or an i32 for an i32 field). */
  const literalNew = (i: number, values: number[]): number => {
    const lay = layouts[i]!, inline = Array.from({ length: INL }, () => m.ref.null(A)), extra: number[] = [];
    values.forEach((v, j) => { const at = lay.index[j]!; if (at < CTOR_FIELD0 + INL) inline[at - OBJ_INLINE0] = v; else extra[at - CTOR_FIELD0 - INL] = v; });
    return m.struct.new([ctorShape(i, ctors[i]!.fields.length), noSlots(), m.ref.null(A), m.ref.null(binaryen.externref), ...inline, ...extra], heap(ctors[i]!.ref));
  };
  /** Whether a literal layout still allocates structs: until more than DICT_LIMIT of its objects
   * converted (no allocation counter: a literal is often the hottest allocation there is). */
  const literalOk = (i: number): number => m.i32.le_s(m.global.get(demotedGlobal(i), I), c(DICT_LIMIT));
  /** Whether `new C` may allocate a struct object under prototype `proto` (null: the default
   * Object.prototype; else a native object): no accessor anywhere on the chain for any of
   * C's keys (a setter would take the put; checked once per prototype and accessor epoch),
   * and C has not demoted too many objects. */
  const ctorOk = (i: number) => helper(`$ctor.${ctors[i]!.key}.ok`, [A], I, [A, OB(), I], () => {
    declareGlobals();
    const proto = () => L(0, A), p = () => L(1, A), po = () => L(2, OB()), k = () => L(3, I);
    const okProto = ctorGlobal(i, "okProto", binaryen.eqref, () => m.ref.null(binaryen.eqref)), okEpoch = ctorGlobal(i, "okEpoch", I, () => c(-1));
    const epoch = () => m.global.get("$acc.epoch", I), lp = loops++;
    return m.block(null, [
      m.if(m.i32.and(m.i32.gt_s(m.global.get(demotedGlobal(i), I), c(DICT_LIMIT)),
        m.i32.gt_u(m.i32.mul(m.global.get(demotedGlobal(i), I), c(CTOR_DEMOTION_SHARE)), m.global.get(allocsGlobal(i), I))), m.return(c(0))),
      m.if(m.i32.or(m.i32.eqz(m.global.get("$acc.any", I)), m.ref.is_null(proto())), m.return(c(1))),
      m.if(m.i32.eqz(m.ref.test(proto(), nn(binaryen.eqref))), m.return(c(0))),
      m.if(m.i32.and(m.ref.eq(m.ref.cast(proto(), nn(binaryen.eqref)), m.global.get(okProto, binaryen.eqref)), m.i32.eq(epoch(), m.global.get(okEpoch, I))), m.return(c(1))),
      S(1, proto()),
      m.block(`ok.end.${lp}`, [m.loop(`ok.top.${lp}`, m.block(null, [
        m.br(`ok.end.${lp}`, m.i32.eqz(m.ref.test(p(), OBN()))),
        S(2, m.ref.cast(p(), OBN())),
        m.if(m.i32.eqz(isStruct(shapeOf(po()))), m.block(null, ctors[i]!.fields.map(f => m.block(null, [
          S(3, m.call(find(), [shapeOf(po()), c(atom(f.name))], I)),
          m.if(m.i32.ge_s(k(), c(0)), m.if(m.ref.test(slotGet(po(), k()), nn(ACC())), m.return(c(0))))])))),
        S(1, protoOf(po())), m.br(`ok.top.${lp}`)]))]),
      m.global.set(okProto, m.ref.cast(proto(), nn(binaryen.eqref))), m.global.set(okEpoch, epoch()),
      c(1),
    ], I);
  });
  /** Positional slot j of a native object, as a struct object holds it in its fields. */
  const slotAt = (o: number, j: number) => structOn ? m.call(helper("$obj.slotAt", [OB(), I], A, [], () =>
    m.if(isStruct(shapeOf(L(0, OB()))), m.call(ctorGet(), [L(0, OB()), L(1, I)], A), slotGet(L(0, OB()), L(1, I)))), [o, j], A)
    : slotGet(o, j);
  /** A struct object becomes an ordinary one before a generic path changes its keys or attributes. */
  const demoteFirst = (o: () => number): number[] => structOn ? [m.if(isStruct(shapeOf(o())), m.call(ctorDemote(), [o()], N))] : [];

  /* ── inline caches and literal shapes ───────────────────────────── */
  let icCount = 0, litCount = 0;
  const newIC = (): string => {
    declareGlobals();
    const name = `$ic.${icCount++}`;
    m.addGlobal(name, nn(IC()), false, m.struct.new([m.ref.null(SH()), c(0), m.ref.null(SH()), m.ref.null(SH()), c(0), m.ref.null(binaryen.eqref), c(0)], heap(IC())));
    return name;
  };
  /** Allocation sites that remember how large their objects become (`new`):
   * a per-site IC struct whose IC_SLOT holds the largest own-key count an
   * object from the site reached, so the next object's slots are allocated
   * at that size up front (one array, no spare slots for objects of a
   * different kind that share a shape prefix, e.g. React's FiberNode and
   * FiberRootNode both start with `tag`). */
  const newSite = (): string => newIC();
  /** An empty object whose slots are sized by the site hint (no hint: the shared empty array). */
  const createAt = (site: number) => newObj(m.call(root(), [], SH()), m.call(sizedSlots(), [site], nn(ANY())));
  const sizedSlots = () => helper("$obj.sizedSlots", [nn(IC())], nn(ANY()), [], () => INL
    ? m.if(m.i32.gt_s(m.struct.get(IC_SLOT, L(0, nn(IC())), I, false), c(INL)), m.array.new_default(heap(ANY()), m.i32.sub(m.struct.get(IC_SLOT, L(0, nn(IC())), I, false), c(INL))), noSlots())
    : m.if(m.struct.get(IC_SLOT, L(0, nn(IC())), I, false), m.array.new_default(heap(ANY()), m.struct.get(IC_SLOT, L(0, nn(IC())), I, false)), noSlots()));
  /** Raise a site's hint to dyn value `v`'s own key count (anything but a non-dictionary object is ignored). */
  const noteSize = () => helper("$obj.noteSize", [nn(IC()), A], N, [SH()], () => m.if(m.ref.test(L(1, A), OBN()), m.block(null, [
    S(2, shapeOf(m.ref.cast(L(1, A), OBN()))),
    m.if(m.i32.and(m.i32.eqz(shapeGet(SHAPE_DICT, L(2, SH()), I)), m.i32.gt_s(shapeGet(SHAPE_COUNT, L(2, SH()), I), m.struct.get(IC_SLOT, L(0, nn(IC())), I, false))),
      m.struct.set(IC_SLOT, L(0, nn(IC())), m.select(m.i32.gt_s(shapeGet(SHAPE_COUNT, L(2, SH()), I), c(DICT_LIMIT)), c(DICT_LIMIT), shapeGet(SHAPE_COUNT, L(2, SH()), I))))])));

  /** Cached own-property read: `o` is a non-null object expression (evaluated once by the caller). */
  const getCached = (o: () => number, name: string): number => {
    const ic = newIC(), icv = () => m.global.get(ic, nn(IC()));
    return m.if(m.ref.eq(shapeOf(o()), m.struct.get(IC_SHAPE, icv(), SH(), false)),
      slotGet(o(), m.struct.get(IC_SLOT, icv(), I, false)),
      m.call(getAt(), [o(), c(atom(name)), icv()], A));
  };
  /** A read inline cache whose probe and fill a caller places separately:
   * `ic()` (the cache, for `cacheHit`/`cachedSlot`) and `get(o)` (the full
   * own-or-inherited read, which refills the cache). `o` is a non-null
   * object expression. */
  const readCache = (name: string) => {
    const ic = newIC(), icv = () => m.global.get(ic, nn(IC()));
    return { ic: icv, get: (o: () => number) => m.call(getAt(), [o(), c(atom(name)), icv()], A) };
  };
  /** Whether object `o` has the shape cache `ic` holds: then the cached slot
   * is an own data slot (caches skip dictionary shapes, where accessors
   * live), so reading it has no effects. */
  const cacheHit = (o: number, ic: number) => m.ref.eq(shapeOf(o), m.struct.get(IC_SHAPE, ic, SH(), false));
  /** The value in `o`'s slot cached by `ic` (valid on a cacheHit). */
  const cachedSlot = (o: number, ic: number) => slotGet(o, m.struct.get(IC_SLOT, ic, I, false));
  const setCached = (o: () => number, name: string, v: number): number => {
    const ic = newIC(), icv = () => m.global.get(ic, nn(IC()));
    return m.if(m.ref.eq(shapeOf(o()), m.struct.get(IC_SHAPE, icv(), SH(), false)),
      slotSet(o(), m.struct.get(IC_SLOT, icv(), I, false), v),
      m.if(m.i32.eqz(m.call(setIC(), [o(), c(atom(name)), v, icv()], I)), ctx.readOnlyError(c(atom(name)))));
  };
  /** An object literal with distinct constant keys: one shared shape, one allocation. */
  const literal = (keys: string[], values: number[]): number => {
    if (keys.length > DICT_LIMIT || new Set(keys).size !== keys.length) throw new Error("dyn-object: literal() needs distinct keys within the shape limit");
    declareGlobals();
    const g = `$lit.${litCount++}`, fnName = `$lit.shape.${litCount - 1}`;
    m.addGlobal(g, SH(), true, m.ref.null(SH()));
    let chain = m.call(root(), [], SH());
    for (const k of keys) chain = m.call(add(), [chain, c(atom(k))], SH());
    ctx.defineHelper(fnName, () => m.addFunction(fnName, N, SH(), [], m.block(null, [
      m.if(m.ref.is_null(m.global.get(g, SH())), m.global.set(g, chain)), m.global.get(g, SH())], SH())));
    const over = values.slice(INL);
    return newObj(m.call(fnName, [], SH()), over.length ? m.array.new_fixed(heap(ANY()), over) : noSlots(), values.slice(0, INL));
  };

  /** Call once after emission: seeds the atom table with every compile-time name. */
  const finalize = () => {
    // A shared-runtime owner always exports its state (clients import it),
    // and a client always checks its atoms ($atoms.link).
    if (ctx.shared) declareGlobals();
    if (!globalsDeclared) return;
    m.addFunction("$atoms.seed", N, N, [], m.block(null, atomNames.map(name => m.drop(m.call(intern(), [ctx.stringConst(name)], I)))));
    // A shared-runtime client: before any module runs, its own compile-time
    // atoms must take exactly the ids it was compiled with, right after the
    // owner's. 0 when they do; else 1 + the first id that did not (the
    // owner interned other names first: the link order was violated).
    if (ctx.shared && !ctx.shared.owner) {
      const checks = atomNames.slice(ownerAtoms).map((name, k) =>
        m.if(m.i32.ne(m.call(intern(), [ctx.stringConst(name)], I), c(ownerAtoms + k)), m.return(c(ownerAtoms + k + 1))));
      m.addFunction("$atoms.link", N, I, [], m.block(null, [m.call(ensure(), [], N), ...checks, c(0)], I));
    }
  };

  return {
    atom, create, literal, getCached, readCache, cacheHit, cachedSlot, setCached, finalize,
    /** Every compile-time atom name in id order (a shared-runtime owner's link manifest). */
    atomNames: () => atomNames.slice(),
    /** A per-site allocation hint (global name of its IC struct); see newSite. */
    newSite, siteRef: (name: string) => m.global.get(name, nn(IC())), siteType: () => nn(IC()),
    createAt, noteSize: (site: number, v: number) => m.call(noteSize(), [site, v], N),
    get: (o: number, a: number) => m.call(getAt(), [o, a, m.ref.null(IC())], A),
    /** An own-data write that ignores attributes' refusal (definitions, initialization). */
    set: (o: number, a: number, v: number) => m.drop(m.call(setAt(), [o, a, v, m.ref.null(IC())], I)),
    /** A strict write: 1 written, 0 refused (read-only). */
    trySet: (o: number, a: number, v: number) => m.call(setAt(), [o, a, v, m.ref.null(IC())], I),
    setFlags: (o: number, a: number, f: number) => m.call(setFlags(), [o, a, f], N),
    /** Object.preventExtensions (level 0), seal (1), freeze (2) of a native object. */
    integrity: (o: number, level: number) => m.call(integrity(), [o, level], N),
    /** 1 when the native object is not extensible (0) / sealed (1) / frozen (2). */
    testIntegrity: (o: number, level: number) => m.call(testIntegrity(), [o, level], I),
    /** 1 when the native object accepts new keys. */
    extensible: (o: number) => m.i32.eqz(m.i32.and(shapeGet(SHAPE_DICT, shapeOf(o), I), c(SHAPE_NOEXT))),
    /** Attribute bits of own property `a`, or -1 when absent. */
    flags: (o: number, a: number) => { const k = m.call(find(), [shapeOf(o), a], I); return k; },
    flagsAtSlot: (o: number, k: number) => m.call(flagsAt(), [shapeOf(o), k], I),
    /** Whether positional slot j is enumerable (whole-object walks). */
    enumAt: (o: number, j: number) => m.i32.eqz(m.i32.and(m.call(flagsAt(), [shapeOf(o), j], I), c(ATTR_HIDDEN | ATTR_INTERNAL))),
    delete: (o: number, a: number) => m.call(del(), [o, a], I),
    has: (o: number, a: number) => m.call(has(), [o, a], I),
    ownKeys: (o: number) => m.call(ownKeys(), [o], A),
    /** ownKeys for a read-only caller: shared per shape (see ownKeysShared). */
    ownKeysShared: (o: number) => m.call(ownKeysShared(), [o], A),
    ownKeysAll: (o: number) => m.call(ownKeys(true), [o], A),
    ownSymbols: (o: number) => m.call(ownSymbols(), [o], A),
    /** The shape key atoms a for-in over dyn value `v` visits, or null (see forInAtoms). */
    forInAtoms: (v: number) => m.call(forInAtoms(), [v], I32S()),
    /** An atom's name as its shared dyn string box. */
    atomBox: (a: number) => m.call(atomBox(), [a], nn(types.dynBox("dyn:str").ref)),
    /** The atom of a string key as the program spelled it. */
    intern: (s: number) => m.call(intern(), [s], I),
    /** The atom of a key already in key form (KEY_MARK): a symbol's reserved name, a key the host encoded. */
    internKey: (s: number) => m.call(internKey(), [s], I),
    /** The array-index value of an atom, or -1. */
    index: (a: number) => m.call(atomIndex(), [a], I),
    /** The canonical array-index value of a string (unsigned), or -1; no interning. */
    indexOf: (s: number) => m.call(indexOf(), [s], I),
    /** The canonical array index a string spells ("0".."4294967294", no
     * sign, exponent, fraction or leading zero), or -1. */
    stringIndex: (s: number) => m.call(indexOf(), [s], I),
    /** An atom's name in key form: for host imports that take a key (host.ts K reads it back). */
    name: (a: number) => m.call(atomName(), [a], ST),
    /** An atom's key as the program sees it (an escaped string key unescaped; a symbol's reserved name as is). */
    string: (a: number) => m.call(atomString(), [a], ST),
    /** Whether a key-form name (an atom's) is a symbol key's reserved name. */
    isSymbolName: (name: () => number) => isSymbolName(name),
    isSymbolAtom: (a: number) => m.call(isSymbolAtom(), [a], I),
    find: (o: number, a: number) => m.call(find(), [shapeOf(o), a], I),
    /* Positional access for whole-object walks (checked extraction, JSON). */
    count: (o: number) => shapeGet(SHAPE_COUNT, shapeOf(o), I),
    /** Positional slot j's key as the program sees it (dobj.string). */
    keyAt: (o: number, j: number) => m.call(atomString(), [m.array.get(shapeGet(SHAPE_KEYS, shapeOf(o), I32S()), j, I, false)], ST),
    /** Positional slot j's atom. */
    atomAt: (o: number, j: number) => m.array.get(shapeGet(SHAPE_KEYS, shapeOf(o), I32S()), j, I, false),
    valAt: (o: number, j: number) => slotAt(o, j),
    /** Positional slot j as property access sees it (an accessor runs its getter on o). */
    valAtResolved: (o: number, j: number, recv: number) => m.call(resolve(), [slotAt(o, j), recv], A),
    /** Whether positional slot j holds an accessor (then `accAt` reads it). */
    isAccAt: (o: number, j: number) => m.ref.test(slotAt(o, j), nn(ACC())),
    accAt: (o: number, j: number) => m.ref.cast(slotAt(o, j), nn(ACC())),
    /** Define an accessor property (or a data value) directly in own slot `a`. */
    defineAccessor: (o: number, a: number, get: number, set: number) => m.block(null, [
      m.global.set("$acc.any", c(1)), bumpEpoch(),
      m.call(defineRaw(), [o, a, m.struct.new([get, set, m.f32.const(0)], heap(ACC()))], N)]),
    defineValue: (o: number, a: number, v: number) => m.call(defineRaw(), [o, a, v], N),
    protoOf, shapeOf,
    /* Constant add transitions (profile guards): what $obj.setIC does for a
     * cached transition, with the shapes and slot known at compile time. */
    /** The empty object's shape, and the (shared) shape after adding `a` to shape `s`. */
    rootShape: () => m.call(root(), [], SH()),
    addKey: (s: number, a: number) => m.call(add(), [s, a], SH()),
    /** o's slots replaced by a larger array for `n` keys under shape `to` (the slots array). */
    grow: (o: number, n: number, to: number) => m.call(grow(), [o, n, to], ANY()),
    /** experimentalDynInlineSlots: how many slots live in dyn:obj's own fields (0: none). */
    inlineSlots: INL,
    /** Whether any accessor property exists (only then may an add meet an inherited setter). */
    accessorsExist: () => { declareGlobals(); return m.global.get("$acc.any", I); },
    /** The accessor/prototype epoch: unchanged since a chain was checked means the check holds. */
    accessorEpoch: () => { declareGlobals(); return m.global.get("$acc.epoch", I); },
    /** Call after changing an existing object's prototype: cached add transitions recheck their chain. */
    protoChanged: () => { declareGlobals(); return bumpEpoch(); },
    parentField: SHAPE_PARENT,
    /** Constructor structs (null when there are none): see ctor-structs.ts. */
    ctor: structOn ? {
      /** S_C^k, and S_C^n (every property present: the fast paths' one shape). */
      shape: ctorShape, full: (i: number) => ctorShape(i, ctors[i]!.fields.length),
      newObj: (i: number, proto: number) => m.call(ctorNew(i), [proto], ctorNN(i)),
      ok: (i: number, proto: number) => m.call(ctorOk(i), [proto], I),
      literalNew, literalOk: (i: number) => { declareGlobals(); return literalOk(i); },
      demote: (o: number) => m.call(ctorDemote(), [o], N),
      type: ctorNN, isStruct,
      /** Whether no object of constructor i was ever converted (see cleanGlobal). */
      clean: (i: number) => m.global.get(cleanGlobal(i), I),
    } : null,
  };
}
