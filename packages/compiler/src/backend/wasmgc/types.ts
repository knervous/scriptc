/* WasmGC type layer: every composite IR type becomes a GC heap type in ONE
 * recursive group, built from a pre-pass over the whole module (records,
 * classes, unions and closures reference each other freely).
 *
 * Representations:
 * - record      struct per shape, mutable fields in shape order
 * - object      struct per class; subclasses extend the base prefix (open)
 * - array       struct { len: mut i32, data: mut ref array<E>, states: mut ref array<i8> }
 *               `states` stays null until a hole or a present undefined exists
 * - union       by its arms (UnionRep, unionRep()):
 *               box   struct { tag: i32, num: f64, ref: anyref, str: externref }; the
 *                     null reference is undefined
 *               ref1  one reference arm (or a string) and one unit arm (`T | null`,
 *                     `string | undefined`): the arm's own nullable reference (a string's
 *                     externref); the null reference is the unit
 *               refs  reference arms with null and/or undefined otherwise: eqref; the
 *                     null reference is undefined, the $dyn.null singleton is null, a
 *                     reference arm is told apart by ref.test (most derived class first)
 *               No representation allocates for a reference arm or a unit.
 *               A record or class field of a box union with one number or boolean arm
 *               and undefined and/or null is held inline instead (InlineField: an i64
 *               or i32 in the field itself), so a write allocates nothing.
 * - func        closure struct { code: ref $sig, env: structref }; $sig takes env first
 * - boxed local struct { v: mut T }
 * - map/set     struct { keys, vals, live: i8[], hashes, next, buckets: i32[],
 *               count, size, depth: mut i32 } — insertion-ordered dense
 *               entries with tombstones and chained buckets (sets: vals null)
 * - promise     one shared $Promise { state, value: anyref, reactions: $Job list };
 *               values use the dyn boxing for scalars, references as-is
 * - async fn    a per-function $Frame { state, promise, handler, caught, env,
 *               ...every local } resumed by a $ResumeSig function
 * - dyn         anyref: the dynamic tier's uniform value. undefined is null;
 *               primitives box into the fixed $DynNum/$DynBool/$DynStr structs;
 *               null is the $DynNull singleton; references stand for themselves
 * - caught      anyref: the thrown value, same encoding as dyn
 * All composite values are nullable references: fields and locals stay
 * defaultable, and a null dereference traps like the LLVM backend's. */
import binaryen from "binaryen";
import { FORK_BYTES_ELEMENT_NAME, RUNTIME_ERROR_CLASSES, type IrBytesElem, type IrFunction, type IrModule, type IrType } from "../../ir/ir.js";

type Unsupported = (construct: string) => never;

export interface ArrayInfo { ref: number; data: number; states: number; elem: number }
/** A record that can come from untyped data keeps the source's own keys (in the source's order) in an optional extension subtype:
 * `ext.src` is the field holding the source dyn object (types.ts recordExtOf). */
export interface RecordExt { ref: number; heap: number; src: number }
export interface StructInfo { ref: number; heap: number; fields: Map<string, number>; fieldTypes: number[]; ovf?: number; js?: number; jsFirst?: boolean; id?: number; /** The integrity level field (0 ordinary .. 3 frozen), after the page object and id: present when the program freezes records. */ frozen?: number; ext?: RecordExt;
  /** Native dyn: the type-index field (the last of the $typedrec prefix) and this type's index, which selects its arm in every
   * dispatcher's table (docs-draft/DESCRIPTOR_DISPATCH.md). */
  tid?: number; tidValue?: number;
  /** A class's type-index field (in the $classbase prefix, after the identity id) and the class's index, which selects its arm in a
   * class dispatcher's table. Absent in a shared runtime. */
  cid?: number; cidValue?: number }
export interface ClosureInfo { ref: number; sig: number; params: number[]; result: number }

const TYPE_KINDS = new Set(["regex", "date", "jsval", "bytes", "f64", "bool", "string", "void", "array", "record", "object", "union", "func", "undefinedT", "nullT", "dyn", "caught", "map", "set", "promise", "symbol", "bigint", "classval", "generator"]);
export const PROMISE_STATE = 0, PROMISE_VALUE = 1, PROMISE_REACTIONS = 2, PROMISE_HANDLED = 3;
export const JOB_CODE = 0, JOB_ENV = 1, JOB_VALUE = 2, JOB_REJECTED = 3, JOB_NEXT = 4;
/** A generator object { frame, resume, status, out }: the resumable frame of its function behind one uniform type. */
export const GEN_FRAME = 0, GEN_RESUME = 1, GEN_STATUS = 2, GEN_OUT = 3, GEN_TYPE = 4;
/** Generator status (GEN_STATUS): not started, suspended at a yield, running, completed. */
export const GEN_START = 0, GEN_SUSPENDED = 1, GEN_RUNNING = 2, GEN_DONE = 3;
/** A generator frame keeps its generator object in the promise slot (FRAME_GEN). */
export const FRAME_STATE = 0, FRAME_PROMISE = 1, FRAME_GEN = 1, FRAME_HANDLER = 2, FRAME_CAUGHT = 3, FRAME_ENV = 4, FRAME_LOCALS = 5;
export const MAP_KEYS = 0, MAP_VALS = 1, MAP_LIVE = 2, MAP_HASH = 3, MAP_NEXT = 4, MAP_BUCKETS = 5, MAP_COUNT = 6, MAP_SIZE = 7, MAP_DEPTH = 8;
/** A native dyn Map/Set's page form once it crossed to the page (GcTypes.dynCollectionSlots). */
export const DYNCOLL_JS = 9;
/** A native dyn Map/Set's iteration log: the latest table change an iterator may have to replay (null until an iterator exists). */
export const DYNCOLL_LOG = 10;
/** hostHandles: the lazily assigned identity id of a native dyn Map/Set (types.idFields). */
export const DYNCOLL_ID = 11;
/** A built-in iterator's state ($iterstate): source, position, kind code, log node, page iterator once its collection crossed, done flag, array-like length. */
export const ITER_SRC = 0, ITER_IDX = 1, ITER_KIND = 2, ITER_NODE = 3, ITER_PAGE = 4, ITER_DONE = 5, ITER_LEN = 6, ITER_LAST = 7, ITER_HAS = 8;
/** A table change of a native dyn Map/Set ($iterlog): mode (0 same positions, 1 compacted, 2 cleared, 3 crossed to the page), the old live flags, the next change. */
export const ITERLOG_MODE = 0, ITERLOG_LIVE = 1, ITERLOG_NEXT = 2;
export interface MapInfo { ref: number; heap: number; keys: number; vals: number; key: number; val: number; i8s: number; i32s: number }
export const DYN_BOXES = ["dyn:num", "dyn:bool", "dyn:str", "dyn:null", "dyn:arr", "dyn:obj", "dyn:shape", "dyn:shapes", "dyn:ic", "dyn:hole", "dyn:acc"] as const;
export const DYN_ARR_ITEMS = 0, DYN_ARR_LEN = 1, DYN_ARR_JS = 2, DYN_ARR_PROPS = 3;
/* Shaped dynamic objects (dyn-object.ts): {shape, slots, proto}. A shape is
 * the ordered atom list plus transitions; dictionary shapes are unshared and
 * mutated in place. An inline cache is {shape, slot}. */
export const OBJ_SHAPE = 0, OBJ_SLOTS = 1, OBJ_PROTO = 2, OBJ_JS = 3;
export const SHAPE_KEYS = 0, SHAPE_COUNT = 1, SHAPE_PARENT = 2, SHAPE_TKEYS = 3, SHAPE_TSHAPES = 4, SHAPE_TCOUNT = 5, SHAPE_DICT = 6, SHAPE_FLAGS = 7, SHAPE_SLACK = 8, SHAPE_INDEX = 9;
/** An inline cache: an own slot (shape, slot), and for write sites one add
 * transition (from, to, slot) with the prototype and accessor epoch it was
 * checked against. */
export const IC_SHAPE = 0, IC_SLOT = 1, IC_TFROM = 2, IC_TTO = 3, IC_TSLOT = 4, IC_TPROTO = 5, IC_TEPOCH = 6;
/** Closure fields; INVOKE and PROPS exist on the native-dyn browser target only.
 * The last field is META (closureMeta): the source function's JS name,
 * length and kind ($fnmeta), null for compiler-made adapters. */
/** Closure code and invoke slots: an i32 `(signatureOrdinal << SLOT_BITS) | index` into that signature's own typed funcref table.
 * wasmtime resolves a funcref READ from a GC object through a runtime call on every closure call; a table read costs none, and a
 * table typed `(ref null $sig)` needs no cast before the call. The ordinal also answers "is this closure of signature S". */
/** Closure tables are typed `(ref null $sig)`: a call is a table read and call_ref, no cast. Binaryen cannot type an element segment
 * that finely, so a start function fills them with table.set. SCRIPTC_FNTAB_CAST=1 (A/B only) uses untyped funcref tables, filled by
 * active element segments, with a cast before every call; measured slightly slower. */
const FNTAB_CAST = typeof process !== "undefined" && !!process.env?.["SCRIPTC_FNTAB_CAST"];
const SLOT_BITS = 20, SLOT_MASK = (1 << SLOT_BITS) - 1;
/** A module may declare at most 100 tables (wasmparser's limit, which wasmtime enforces; V8 allows more): the most frequent closure
 * signatures get a table typed to their signature, every other signature shares ONE untyped funcref table (a cast before the call). */
export const MAX_TABLES = 100, TYPED_TABLE_BUDGET = 64;
interface FnTable { name: string; funcs: string[]; index: Map<string, number>; sig: number | null }
interface FnTables { sharedUsed: boolean; ordinals: Map<number, number>; typedSigs: Set<number> | null; tables: Map<number, FnTable>; shared: FnTable }
const fnTables = new WeakMap<binaryen.Module, FnTables>();
function fnRegistry(m: binaryen.Module): FnTables {
  let r = fnTables.get(m);
  if (!r) fnTables.set(m, r = { sharedUsed: false, ordinals: new Map(), typedSigs: null, tables: new Map(), shared: { name: "$ftabU", funcs: [], index: new Map(), sig: null } });
  return r;
}
/** Choose which signatures get a table typed to them (call before any slot is handed out; unset: every signature is typed). */
export function configureFnTables(m: binaryen.Module, typedSigs: Set<number>): void { fnRegistry(m).typedSigs = FNTAB_CAST ? new Set() : typedSigs; }
function ordinalOf(r: FnTables, sig: number): number {
  let o = r.ordinals.get(sig);
  if (o === undefined) { o = r.ordinals.size; r.ordinals.set(sig, o); }
  return o;
}
/** The table holding signature `sig`'s functions: its own typed one, or the shared untyped one. */
function tableFor(r: FnTables, sig: number): FnTable {
  if (r.typedSigs !== null && !r.typedSigs.has(sig)) { r.sharedUsed = true; return r.shared; }
  let t = r.tables.get(sig);
  if (!t) r.tables.set(sig, t = { name: `$ftab${r.tables.size}`, funcs: [], index: new Map(), sig });
  return t;
}
/** The slot constant naming function `name` (whose type is signature heap type `sig`). */
export function fnSlotConst(m: binaryen.Module, sig: number, name: string): number {
  const r = fnRegistry(m), t = tableFor(r, sig), ordinal = ordinalOf(r, sig);
  let k = t.index.get(name);
  if (k === undefined) { k = t.funcs.length; t.funcs.push(name); t.index.set(name, k); if (k > SLOT_MASK) throw new Error("wasmgc backend: too many functions for one closure table"); }
  return m.i32.const((ordinal << SLOT_BITS) | k);
}
/** i32: whether a closure slot names a function of signature `sig`. */
export function slotHasSig(m: binaryen.Module, slot: number, sig: number): number {
  return m.i32.eq(m.i32.shr_u(slot, m.i32.const(SLOT_BITS)), m.i32.const(ordinalOf(fnRegistry(m), sig)));
}
/** Call the function a closure slot names (its signature `sig`): a typed table read then call_ref, or (shared table) a funcref read and a cast. */
export function callCode(m: binaryen.Module, slot: number, operands: readonly number[], sig: number, result: number): number {
  const r = fnRegistry(m), t = tableFor(r, sig), index = m.i32.and(slot, m.i32.const(SLOT_MASK));
  if (t.sig === null) return m.call_ref(m.ref.cast(m.table.get(t.name, index, binaryen.funcref), binaryen.getTypeFromHeapType(sig, false)), operands, result);
  return m.call_ref(m.table.get(t.name, index, binaryen.getTypeFromHeapType(sig, true)), operands, result);
}
/** Declare the tables and fill them (call once, after the last slot was handed out). A module with more than MAX_TABLES tables cannot be emitted. */
export function finishFnTables(m: binaryen.Module): void {
  const r = fnTables.get(m);
  if (!r) return;
  const typed = [...r.tables.values()], count = typed.length + (r.sharedUsed ? 1 : 0);
  if (count > MAX_TABLES) throw new Error(`wasmgc backend: internal error: ${count} closure tables exceed the limit of ${MAX_TABLES} per module`);
  const addTable = (name: string, size: number, type: number) => (m as unknown as { addTable(name: string, initial: number, max: number, type: number): unknown }).addTable(name, size, size, type);
  if (r.sharedUsed) {
    addTable(r.shared.name, Math.max(r.shared.funcs.length, 1), binaryen.funcref);
    if (r.shared.funcs.length) m.addActiveElementSegment(r.shared.name, `${r.shared.name}.elems`, r.shared.funcs, m.i32.const(0));
  }
  const sets: number[] = [];
  for (const t of typed) {
    addTable(t.name, Math.max(t.funcs.length, 1), binaryen.getTypeFromHeapType(t.sig!, true));
    t.funcs.forEach((f, k) => sets.push(m.table.set(t.name, m.i32.const(k), m.ref.func(f, binaryen.getTypeFromHeapType(t.sig!, false)))));
  }
  if (sets.length) {
    const previous = m.getStart();
    m.addFunction("$ftab.init", binaryen.none, binaryen.none, [], m.block(null, [...sets, ...(previous ? [m.call(binaryen.getFunctionInfo(previous).name, [], binaryen.none)] : [])], binaryen.none));
    m.setStart(m.getFunction("$ftab.init"));
  }
}
export const CLOSURE_CODE = 0, CLOSURE_ENV = 1, CLOSURE_INVOKE = 2, CLOSURE_PROPS = 3, CLOSURE_JS = 4;
/** A class value ($classval, native dyn only): a $fnbase subtype, so it is a
 * function to every dynamic operation (typeof, calls through `invoke`, which
 * throws, page wrappers, `props` as its own properties: name, length,
 * prototype and the static expando bag), plus the class's id (exact-class
 * tests, construction and instanceof dispatch), its prototype object, and a
 * local class's captured binding boxes. */
export const CLASSOBJ_CID = 6, CLASSOBJ_PROTO = 7, CLASSOBJ_CAPS = 8;
export const closureMeta = (nativeDyn: boolean): number => nativeDyn ? 5 : 2;
/** Native dyn: a closure's identity root when it is a signature adapter (the function it adapts), else null. */
export const CLOSURE_ORIGIN = 6;
/** $fnmeta fields, and FNMETA_FLAGS bits. */
export const FNMETA_NAME = 0, FNMETA_LENGTH = 1, FNMETA_FLAGS = 2;
export const FN_OWNS_PROTOTYPE = 1, FN_FORWARD = 2;
/** A class value's $fnmeta: its page wrapper constructs (`new` reaches the class's construct entry). */
export const FN_CLASS = 4;
export type DynBox = typeof DYN_BOXES[number];
export const UNION_TAG = 0, UNION_NUM = 1, UNION_REF = 2, UNION_STR = 3;
/** How a union's values are held (see the header). `refTags` lists the
 * reference arms in ref.test order: a subclass before its base, the last one
 * decided by elimination. A tag of -1 means the union has no such arm. */
export type UnionRep =
  | { kind: "box" }
  | { kind: "ref1"; refTag: number; unitTag: number }
  | { kind: "refs"; refTags: number[]; nullTag: number; undefTag: number };
/** A boxed scalar union stored in a record or class field itself (inlineField): one scalar arm (number or boolean) and
 * undefined and/or null. `num`: an i64, the f64 form's bits XOR `key`; `bool`: an i32, 1 false, 2 true, 3 null. Stored
 * 0 is always the union's null reference (undefined; a never-written field of a union without undefined), so a field
 * left by struct.new_default reads as before. The f64 form is the narrowed number (UNDEF_NAN: undefined); null is
 * INLINE_NULL_BITS. Under a union without undefined the key is INLINE_DEFAULT_BITS, and a number whose form is a
 * reserved pattern stores canonical NaN (JS never produces one: only raw bits can). */
export interface InlineField { kind: "num" | "bool"; unionId: string; scalarTag: number; undefTag: number; nullTag: number; key: bigint }
export const INLINE_NULL_BITS = 0x7ff4000000000003n;
export const INLINE_DEFAULT_BITS = 0x7ff4000000000004n;
const INLINE_UNDEF_BITS = 0x7ff4000000000001n;
/** Arm kinds held as a non-null struct reference: the reference stands for
 * itself in a ref union (the SIMD v128 class is not one). A string arm is a
 * ref1 arm too (chooseRep), but never in refs. */
const REF_ARM_KINDS = new Set(["object", "record", "array", "func", "map", "set", "promise", "bytes"]);
export const ARRAY_LEN = 0, ARRAY_DATA = 1, ARRAY_STATES = 2;
/** The match-result subtype of arr<string> (a regex exec/match/matchAll row): the string[] fields, then the
 * own data properties index and input, the groups object (the one null-prototype untyped object; null: undefined). Untyped code sees the struct itself. */
export const MATCH_INDEX = 3, MATCH_INPUT = 4, MATCH_DGROUPS = 5;
export const BYTES_BASE = 0, BYTES_LEN = 1, BYTES_OWNER = 2, BYTES_CAP = 3;
/** The storage owner's whole-buffer value (`x.buffer`, `new ArrayBuffer(n)`; null until asked, and on views): kept in
 * the owner itself, so buffer identity costs no host table, and the collector reclaims owner and buffer together (a
 * host table of them was a root: natively nothing that ever had a `.buffer` was freed). */
export const BYTES_BUFFER = 4;
/** The storage owner's host finalization token (bytes.track's result; null on views and on hosts that finalize the
 * owner themselves): it lives exactly as long as the owner, so a native host frees the storage when it is swept.
 * The last field: the native host reads it there. */
export const BYTES_TOKEN = 5;
/** The element kinds, each its own $Bytes subtype (bytesType). */
const BYTES_ELEMS = Object.keys(FORK_BYTES_ELEMENT_NAME) as IrBytesElem[];

const raw = binaryen as unknown as Record<string, (...args: number[]) => number>;

/** Shared runtime: the typed-value dispatchers a module offers its peers
 * (field order of $peervt): [helper, params, result]; "a" anyref, "i" i32,
 * "e" externref, "n" none. */
export const PEER_OPS: readonly (readonly [string, readonly ("a" | "i")[], "a" | "i" | "e" | "n"])[] = [
  ["$typed.is", ["a"], "i"], ["$typed.get", ["a", "i"], "a"], ["$typed.set", ["a", "i", "a"], "n"], ["$typed.has", ["a", "i"], "i"],
  ["$typed.hasOwn", ["a", "i"], "i"], ["$typed.keys", ["a"], "a"], ["$typed.toJs", ["a"], "e"],
  ["$tarr.is", ["a"], "i"], ["$tarr.has", ["a", "i"], "i"], ["$tarr.len", ["a"], "i"], ["$tarr.get", ["a", "i"], "a"],
  ["$tarr.set", ["a", "i", "a"], "n"], ["$tarr.snapshot", ["a"], "a"], ["$tarr.toJs", ["a"], "e"],
];
export const PEER_VALTYPE: Record<"a" | "i" | "e" | "n", () => number> = { a: () => binaryen.anyref, i: () => binaryen.i32, e: () => binaryen.externref, n: () => binaryen.none };

/** The contract types a class field can be stored narrow for. */
export type NarrowKind = "Int8" | "Uint8" | "Int16" | "Uint16" | "Int32" | "Uint32";

export class GcTypes {
  private readonly slots = new Map<string, number>();
  private readonly defs: { key: string; build: (b: binaryen.TypeBuilder, index: number) => void }[] = [];
  private heaps: number[] = [];
  readonly records = new Map<string, StructInfo>();
  readonly classes = new Map<string, StructInfo>();
  readonly unions = new Map<string, number>();
  readonly arrays = new Map<string, ArrayInfo>();
  readonly closures = new Map<string, ClosureInfo>();
  readonly boxes = new Map<string, number>();
  readonly envs = new Map<string, StructInfo>();
  /** Shared scope environments (emitter scopeGroups): one struct per scope
   * instance holding the captured variables that scope declares, keyed by
   * the member types; set by the emitter before collect(). */
  readonly scopeGroups = new Map<string, readonly IrType[]>();
  private readonly groupInfos = new Map<string, StructInfo>();
  /** Closure environments over carriers (emitter scopeGroups): per lifted
   * function, the distinct boxes and scope groups its captures live in.
   * `direct`: the one carrier is the environment itself (no env struct).
   * Functions absent here keep one box reference per capture. */
  readonly envLayouts = new Map<string, { carriers: readonly ({ box: IrType } | { group: string })[]; direct: boolean }>();
  readonly maps = new Map<string, MapInfo>();
  readonly frameLocals = new Map<string, string[]>();
  private readonly unionIds = new Set<string>();
  private readonly unionArmsSeen = new Set<string>();
  readonly subclasses = new Map<string, string[]>();
  readonly dynBoxes = new Map<DynBox, { ref: number; heap: number }>();
  private readonly unionDefs: Map<string, IrType[]>;
  private readonly recordDefs: Map<string, { name: string; type: IrType }[]>;
  private readonly tupleIds: ReadonlySet<string>;
  /** Closed record shapes some reachable `dynCheck` can produce (a conversion from untyped data): they get an extension subtype that keeps
   * the source's undeclared and reordered own keys. */
  private readonly srcShapes = new Set<string>();
  private markSrc(t: IrType, seen = new Set<string>()): void {
    switch (t.kind) {
      case "record": {
        if (seen.has(t.shapeId)) return;
        seen.add(t.shapeId);
        const fields = this.recordDefs.get(t.shapeId);
        if (!fields) return;
        if (!this.isTupleShape(t.shapeId) && !this.indexValues.has(t.shapeId)) this.srcShapes.add(t.shapeId);
        for (const f of fields) this.markSrc(f.type, seen);
        const index = this.indexValues.get(t.shapeId);
        if (index) this.markSrc(index, seen);
        return;
      }
      case "array": case "set": this.markSrc(t.elem, seen); return;
      case "map": this.markSrc(t.key, seen); this.markSrc(t.value, seen); return;
      case "promise": this.markSrc(t.inner, seen); return;
      case "union": {
        // A union may reach itself through an array arm (`type Child = Node | readonly Child[]`).
        if (seen.has(`union:${t.unionId}`)) return;
        seen.add(`union:${t.unionId}`);
        for (const arm of this.unionDefs.get(t.unionId) ?? []) this.markSrc(arm, seen);
        return;
      }
      default: return;
    }
  }
  private hasSubclass(name: string): boolean { for (const d of this.classDefs.values()) if (d.base === name) return true; return false; }
  /** Whether a class with subclasses gets a final instantiable subtype (see klass). */
  private splitsClass(name: string): boolean { return !this.sharedRuntime && (name === "%Error" || this.hasSubclass(name)); }
  /** A tuple shape: an array to JS, no $typedrec subtype and no type index. */
  isTupleShape(id: string): boolean { return this.tupleIds.has(id); }
  /** A native-dyn browser record (not a tuple) keeps its page-object field first. */
  private recordJsFirst(id: string): boolean { return this.nativeDyn && this.browser && !this.tupleIds.has(id); }
  /** Native host (hostHandles): classes and native-dyn browser records carry a lazily assigned identity id (an i32, 0 = unassigned)
   * so compiled references hash in O(1) compiled-side (the host cannot number a GC object). Records keep it right after the page
   * field (struct field 1, in $typedrec); a class keeps it first, in $classbase. Set before the first type is registered. */
  idFields = false;
  /** The program freezes typed records (record.freeze): every non-tuple typed record carries an integrity-level field after its page object and id.
   * Decided in collect(), before any record type is built; off in a shared runtime. */
  frozenBit = false;
  /** The integrity-level field's index in the $typedrec prefix (frozenBit). */
  get frozenIndex(): number { return this.idFields ? 2 : 1; }
  /** Native dyn: each $typedrec record shape's type index, dense from 1 in registration order (0: no shape). */
  private readonly recordTids = new Map<string, number>();
  /** Whether record shape `id` is a $typedrec subtype, which carries a type index. */
  private hasTid(id: string): boolean { return this.nativeDyn && !this.isTupleShape(id); }
  /** The type-index field's index in the $typedrec prefix: after the page object, id and integrity level (browser), else first. */
  get tidIndex(): number { return this.browser ? 1 + (this.idFields ? 1 : 0) + (this.frozenBit ? 1 : 0) : 0; }
  /** The number of record type indices (the size of a record dispatcher's table, less its 0 entry). */
  get recordTidCount(): number { return this.recordTids.size; }
  /** Record shape ids by type index (index 0 first: none). */
  recordShapesByTid(): (string | null)[] { const out: (string | null)[] = [null]; for (const [id, tid] of this.recordTids) out[tid] = id; return out; }
  hasSlot(key: string): boolean { return this.slots.has(key); }
  /** Each class's type index, dense from 1 in registration order (0: no class); the classes carry it unless the runtime is shared. */
  private readonly classCids = new Map<string, number>();
  private get hasCid(): boolean { return !this.sharedRuntime; }
  /** The type-index field's index in a class struct: after the identity id. */
  get cidIndex(): number { return this.idFields ? 1 : 0; }
  /** Whether classes carry a type index (class dispatchers use it). */
  get classesHaveCid(): boolean { return this.hasCid && this.slots.has("classbase"); }
  /** Class names by type index (index 0 first: none). */
  classesByCid(): (string | null)[] { const out: (string | null)[] = [null]; for (const [name, cid] of this.classCids) out[cid] = name; return out; }
  /** A class's type index (0 for none). */
  classCid(name: string): number { return this.classCids.get(name) ?? 0; }
  /** The class prefix fields: the identity id (native host), then the type index. */
  private classPrefix(): { type: number; packedType: number; mutable: boolean }[] {
    return [...(this.idFields ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
      ...(this.hasCid ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : [])];
  }
  /** The common prefix of every class: { id: i32 }. */
  classBaseRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("classbase")!]!, false); }
  private ensureClassBase(): void {
    // Every class subtypes it (the dyn class chains test it first); it holds the identity id only on a native host.
    if (this.sharedRuntime && !this.idFields) return;
    this.slot("classbase", (b, i) => { b.setStructType(i, this.classPrefix()); b.setOpen(i); });
  }
  private readonly indexValues: Map<string, IrType>;
  private readonly classDefs: Map<string, { base?: string; fields: { name: string; type: IrType }[] }>;
  private built = false;
  /** The program has typed regex match results: arr<string> is open and `matcharr` subtypes it. */
  private matchArrays = false;

  /** The SIMD library's v128 class: a native v128 value, never a struct (simd.ts). */
  simdV128: string | null = null;

  /** Engine-backed dyn (browser builds): a dyn value is the engine's own JS
   * value (externref) and every dynamic operation is a host import. */
  readonly engineDyn: boolean;
  /** Browser target: page-boundary layouts (a record's page-object slot). */
  readonly browser: boolean;
  /** Browser target with untyped JS as compiled values (dyn-object.ts). */
  readonly nativeDyn: boolean;
  /** Shared runtime (WasmGcLink.sharedRuntime): the runtime's types form
   * their own rec group, identical in every module built this way whatever
   * the program, so separately compiled modules agree on them (isorecursive
   * canonicalization) and dyn values cross between them. Program types form
   * a second group that refers to it. */
  readonly sharedRuntime: boolean;
  /** Slots [0, runtimeCount) are the shared runtime group (0: one group). */
  private runtimeCount = 0;
  /** While a group builds: the slot index of its first type. */
  private groupBase = 0;
  constructor(private readonly mod: IrModule, private readonly unsupported: Unsupported, engineDyn = false, browser = engineDyn, sharedRuntime = false) {
    this.engineDyn = engineDyn;
    this.browser = browser;
    this.nativeDyn = browser && !engineDyn;
    this.sharedRuntime = sharedRuntime && this.nativeDyn;
    this.unionDefs = new Map((mod.unions ?? []).map(u => [u.id, u.arms]));
    this.recordDefs = new Map((mod.records ?? []).map(r => [r.id, r.fields]));
    this.indexValues = new Map((mod.records ?? []).flatMap(r => r.indexValue ? [[r.id, r.indexValue] as const] : []));
    this.tupleIds = new Set((mod.records ?? []).flatMap(r => r.tuple ? [r.id] : []));
    this.classDefs = new Map((mod.classes ?? []).map(c => [c.name, c]));
    for (const c of mod.classes ?? []) if (c.base) this.subclasses.set(c.base, [...(this.subclasses.get(c.base) ?? []), c.name]);
  }

  static typeKey(t: IrType): string {
    switch (t.kind) {
      case "array": return `arr<${GcTypes.typeKey(t.elem)}>`;
      case "record": return `rec:${t.shapeId}`;
      case "object": return `cls:${t.className}`;
      case "union": return `uni:${t.unionId}`; // semantic identity; the struct slot is shared ("union")
      case "func": return `fn(${t.params.map(GcTypes.typeKey).join(",")}${GcTypes.hiddenRest(t) ? ",...rest" : ""})${GcTypes.typeKey(t.ret)}`;
      case "map": return `map<${GcTypes.typeKey(t.key)},${GcTypes.typeKey(t.value)}>`;
      case "set": return `set<${GcTypes.typeKey(t.elem)}>`;
      // One struct for every class value; the key keeps the class (checks and boxes are per class).
      case "classval": return `classval:${t.className}`;
      default: return t.kind;
    }
  }

  /* ── collection ──────────────────────────────────────────────────── */
  collect(reachable: Iterable<IrFunction>): void {
    this.baseSlots();
    if (this.sharedRuntime) this.ensureSharedRuntime();
    for (const name of this.classDefs.keys()) if (RUNTIME_ERROR_CLASSES.has(name)) this.klass(name);
    // Shapes a conversion from untyped data can produce are marked before any record type is built (their supertype must be open).
    if (this.nativeDyn) {
      const fns = [...reachable];
      const scan = (node: unknown): void => {
        if (Array.isArray(node)) { node.forEach(scan); return; }
        if (!node || typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        if (obj["kind"] === "dynCheck" && obj["type"] && typeof obj["type"] === "object") this.markSrc(obj["type"] as IrType);
        if (obj["kind"] === "libCall" && obj["fn"] === "record.carry" && obj["type"] && typeof obj["type"] === "object") this.markSrc(obj["type"] as IrType);
        if (obj["kind"] === "libCall" && obj["fn"] === "record.freeze" && this.browser && !this.sharedRuntime) this.frozenBit = true;
        for (const value of Object.values(obj)) scan(value);
      };
      for (const f of fns) scan(f.body);
    }
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj["kind"] === "string" && TYPE_KINDS.has(obj["kind"] as string) && !("loc" in obj)) this.require(obj as IrType);
      if (obj["kind"] === "regexIntrinsic" && this.browser && ["match", "exec", "matchAll", "matchAllInto"].includes(obj["method"] as string)) this.matchArrays = true;
      // The timer runtime's slot table holds `() => void` thunks; a program that
      // only CLEARS a handle (a ref's value, a parameter) has no thunk type of its own.
      if (obj["kind"] === "libCall" && typeof obj["fn"] === "string" && (obj["fn"] as string).startsWith("timers.")) {
        this.require({ kind: "func", params: [], ret: { kind: "void" } });
      }
      for (const value of Object.values(obj)) visit(value);
    };
    for (const g of this.mod.globals ?? []) visit(g.type);
    for (const [key, members] of this.scopeGroups) {
      for (const t of members) this.require(t);
      this.slot(`group:${key}`, (b, i) => b.setStructType(i, members.map(t => ({ type: this.temp(b, t), packedType: binaryen.notPacked, mutable: true }))));
    }
    for (const f of reachable) {
      visit(f.params); visit(f.returnType); visit(f.locals); visit(f.body);
      for (const local of f.locals) if (local.boxed) this.box(local.type);
      if (f.captures?.length) this.env(f);
      if (f.async || f.generator) this.frame(f);
    }
    if (this.matchArrays) {
      this.require({ kind: "array", elem: { kind: "string" } });
      const key = GcTypes.typeKey({ kind: "array", elem: { kind: "string" } });
      const field = (type: number) => ({ type, packedType: binaryen.notPacked, mutable: true });
      // The plain string array is then an open BASE nothing instantiates: its instances are of a final subtype `<key>!`.
      if (!this.sharedRuntime) this.slot(`${key}!`, (b, i) => {
        b.setStructType(i, [
          field(binaryen.i32), field(b.getTempRefType(this.htIndex(b, this.slots.get(`data:${key}`)!), true)), field(b.getTempRefType(this.htIndex(b, this.slots.get(`states:${key}`)!), true))]);
        b.setSubType(i, this.htIndex(b, this.slots.get(key)!));
      });
      this.slot("matcharr", (b, i) => {
        b.setStructType(i, [
          field(binaryen.i32), field(b.getTempRefType(this.htIndex(b, this.slots.get(`data:${key}`)!), true)), field(b.getTempRefType(this.htIndex(b, this.slots.get(`states:${key}`)!), true)),
          field(binaryen.f64), field(binaryen.externref), field(binaryen.anyref)]);
        b.setSubType(i, this.htIndex(b, this.slots.get(key)!));
      });
    }
  }
  /** The match-result struct type (null without typed regex matches). */
  matchArr(): { ref: number; heap: number } | null {
    const slot = this.slots.get("matcharr");
    if (slot === undefined) return null;
    const heap = this.heaps[slot]!;
    return { ref: binaryen.getTypeFromHeapType(heap, true), heap };
  }

  /** The types every module has: dyn boxes, dyn objects and arrays, shapes,
   * caches, and (native dyn) $fnbase and the native collections. Idempotent. */
  private baseSlots(): void {
    // Dynamic-tier boxes are always present: exceptions and dyn use them.
    const boxField = (type: number) => [{ type, packedType: binaryen.notPacked, mutable: false }];
    this.slot("dyn:num", (b, i) => b.setStructType(i, boxField(binaryen.f64)));
    this.slot("dyn:bool", (b, i) => b.setStructType(i, boxField(binaryen.i32)));
    // A string box: the string, and its atom + 1 once a property access has
    // interned it (0: not yet), so a box used as a key again (a for-in key,
    // React's propKey) skips the intern table.
    this.slot("dyn:str", (b, i) => b.setStructType(i, [...boxField(binaryen.externref), { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }]));
    this.slot("dyn:null", (b, i) => b.setStructType(i, []));
    // An array hole marker; its i64 field keeps it structurally distinct from every other box.
    this.slot("dyn:hole", (b, i) => b.setStructType(i, boxField(binaryen.i64)));
    // An accessor property's {get, set} (held in the property's slot; never a
    // value). The f32 tag keeps it structurally distinct from every other box.
    this.slot("dyn:acc", (b, i) => b.setStructType(i, [
      { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: false },
      { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: false },
      { type: binaryen.f32, packedType: binaryen.notPacked, mutable: false }]));
    // Dynamic arrays (growable) and shaped objects (dyn-object.ts).
    this.slot("anyarr", (b, i) => b.setArrayType(i, binaryen.anyref, binaryen.notPacked, true));
    this.slot("strarr", (b, i) => b.setArrayType(i, binaryen.externref, binaryen.notPacked, true));
    const own = (b: binaryen.TypeBuilder, slot: string) => ({ type: b.getTempRefType(this.htIndex(b, this.slots.get(slot)!), true), packedType: binaryen.notPacked, mutable: true });
    const count = { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true };
    // `js` caches the page facade of a compiled array/object (created once).
    const jsCache = { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true };
    // `props`: the array's own named properties (a dyn:obj, created on first use): RegExpBuiltinExec's
    // index / input / groups, and any `arr.key = x` store.
    this.slot("dyn:arr", (b, i) => b.setStructType(i, [own(b, "anyarr"), count, jsCache, own(b, "dyn:obj")]));
    this.slot("i8s", (b, i) => b.setArrayType(i, binaryen.i32, binaryen.i8, true));
    this.slot("i32s", (b, i) => b.setArrayType(i, binaryen.i32, binaryen.notPacked, true));
    this.slot("dyn:shape", (b, i) => b.setStructType(i, [
      own(b, "i32s"), count, { ...own(b, "dyn:shape"), mutable: false }, own(b, "i32s"), own(b, "dyn:shapes"), count, count, own(b, "i8s"), count, own(b, "i32s"),
    ]));
    this.slot("dyn:shapes", (b, i) => b.setArrayType(i, b.getTempRefType(this.htIndex(b, this.slots.get("dyn:shape")!), true), binaryen.notPacked, true));
    // Open only when constructor structs extend it (experimentalJsConstructorStructs),
    // and always in a shared runtime (its group cannot depend on the program).
    this.slot("dyn:obj", (b, i) => { b.setStructType(i, this.objBaseFields(b)); if (this.ctorKeys.length || this.sharedRuntime) b.setOpen(i); });
    this.slot("dyn:ic", (b, i) => b.setStructType(i, [own(b, "dyn:shape"), count, own(b, "dyn:shape"), own(b, "dyn:shape"), count,
      { type: binaryen.eqref, packedType: binaryen.notPacked, mutable: true }, count]));
    // Caches of shared boxes: small integers, and atom names as dyn strings.
    this.slot("numboxes", (b, i) => b.setArrayType(i, b.getTempRefType(this.htIndex(b, this.slots.get("dyn:num")!), true), binaryen.notPacked, true));
    this.slot("strboxes", (b, i) => b.setArrayType(i, b.getTempRefType(this.htIndex(b, this.slots.get("dyn:str")!), true), binaryen.notPacked, true));
    if (this.nativeDyn) { this.fnbaseSlots(); this.dynCollectionSlots(); this.iterSlots(); }
  }
  /** Shared runtime: the runtime group must be the first slots whatever asks
   * for a type first (the emitter registers class types before collect()). */
  private runtimeDone = false;
  private ensureSharedRuntime(): void {
    if (!this.sharedRuntime || this.runtimeDone) return;
    this.runtimeDone = true;
    this.baseSlots();
    this.sharedRuntimeSlots();
  }

  /** The shared runtime group (WasmGcLink.sharedRuntime): everything a dyn
   * value can be or point to, defined the same way in every module whatever
   * its program. Called once from collect(), after the boxes, dyn
   * objects/arrays, $fnbase and the native collections. */
  private sharedRuntimeSlots(): void {
    this.promiseTypes();
    this.bytesType();
    // The runtime error classes, root first (their layouts are fixed by the frontend).
    for (const name of RUNTIME_ERROR_CLASSES.keys()) {
      const def = this.classDefs.get(name);
      if (!def) this.unsupported(`shared runtime: the runtime error class ${name}`);
      this.slot(`cls:${name}`, (b, i) => {
        b.setStructType(i, def!.fields.map(f => ({ type: this.temp(b, f.type), packedType: binaryen.notPacked, mutable: true })));
        b.setOpen(i);
        if (def!.base) b.setSubType(i, this.htIndex(b, this.slots.get(`cls:${def!.base}`)!));
      });
    }
    // Every typed record, tuple and typed array is a subtype of $typedbase,
    // so one ref.test tells "a typed value of some module" (peer dispatch).
    this.slot("typedbase", (b, i) => { b.setStructType(i, []); b.setOpen(i); });

    // A module's typed-value dispatchers, registered at link time ($rt.link)
    // so other modules can read its typed values (PEER_OPS order).
    this.slot("peervt", (b, i) => b.setStructType(i, PEER_OPS.map(([, params, result]) => ({
      type: b.getTempRefType(GcTypes.signatureHeap(params.map(p => PEER_VALTYPE[p]()), PEER_VALTYPE[result]()), false), packedType: binaryen.notPacked, mutable: false }))));
    this.slot("peers", (b, i) => b.setArrayType(i, b.getTempRefType(this.htIndex(b, this.slots.get("peervt")!), true), binaryen.notPacked, true));
    this.runtimeCount = this.defs.length;
    // User subclasses of the error classes belong to the program group.
    for (const name of RUNTIME_ERROR_CLASSES.keys()) for (const sub of this.subclasses.get(name) ?? []) if (!RUNTIME_ERROR_CLASSES.has(sub)) this.klass(sub);
  }
  /** The canonical (singleton rec group) heap type of a function signature:
   * the type binaryen gives a function declared with these params/result. */
  static signatureHeap(params: number[], result: number): number {
    const b = new binaryen.TypeBuilder(1);
    b.setSignatureType(0, binaryen.createType(params), result);
    return b.buildAndDispose()[0]!;
  }
  /** Peer vtable layout (shared runtime). */
  peerVt(): { ref: number; heap: number; arr: number; arrHeap: number } {
    const heap = this.heaps[this.slots.get("peervt")!]!, arrHeap = this.heaps[this.slots.get("peers")!]!;
    return { ref: binaryen.getTypeFromHeapType(heap, true), heap, arr: binaryen.getTypeFromHeapType(arrHeap, true), arrHeap };
  }
  /** $dyn:bound (fnbaseSlots): a bound function's environment. */
  boundEnv(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("dyn:bound")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  /** The typed record types (non-null refs), when nothing outside this module can add one; null otherwise. */
  typedRecMembers(weight?: (shapeId: string) => number): number[] | null {
    if (this.sharedRuntime || !this.slots.has("typedrec")) return null;
    // Most-constructed shape first: a test that hits ends at the first member that matches (a miss runs them all).
    const ids = [...this.records].filter(([id]) => !this.isTupleShape(id));
    if (weight) ids.sort(([a], [b]) => weight(b) - weight(a));
    return ids.map(([, info]) => binaryen.getTypeFromHeapType(info.heap, false));
  }
  /** Open struct bases whose every instance is one of a known set of FINAL types (a test is a chain of exact tests):
   * the typed-record base and each class that others extend. Empty when other modules could add subtypes. */
  openTestMembers(recordWeight?: (shapeId: string) => number): Map<number, number[]> {
    const out = new Map<number, number[]>();
    if (this.sharedRuntime) return out;
    const nn = (heap: number) => binaryen.getTypeFromHeapType(heap, false);
    const rec = this.typedRecMembers(recordWeight);
    if (rec !== null) out.set(this.typedRec(), rec);
    const finalOf = (name: string): number | null => {
      const fin = this.slots.get(`clsf:${name}`), own = this.slots.get(`cls:${name}`);
      return fin !== undefined ? nn(this.heaps[fin]!) : own !== undefined ? nn(this.heaps[own]!) : null;
    };
    const descend = (name: string, acc: number[]): void => {
      const f = finalOf(name);
      if (f !== null) acc.push(f);
      for (const sub of this.subclasses.get(name) ?? []) descend(sub, acc);
    };
    const strKey = GcTypes.typeKey({ kind: "array", elem: { kind: "string" } });
    if (this.slots.has(`${strKey}!`) && this.slots.has("matcharr")) {
      out.set(nn(this.heaps[this.slots.get(strKey)!]!), [nn(this.heaps[this.slots.get(`${strKey}!`)!]!), nn(this.heaps[this.slots.get("matcharr")!]!)]);
    }
    const objFinal = this.slots.get("dyn:obj!");
    if (objFinal !== undefined) {
      const members = [nn(this.heaps[objFinal]!)];
      for (const key of this.ctorKeys) members.push(nn(this.heaps[this.slots.get(`ctor:${key}`)!]!));
      out.set(nn(this.heaps[this.slots.get("dyn:obj")!]!), members);
    }
    for (const name of this.classes.keys()) {
      if (!this.slots.has(`clsf:${name}`)) continue;
      const members: number[] = [];
      descend(name, members);
      if (name === "%Error" && this.slots.has("aggerr")) members.push(nn(this.heaps[this.slots.get("aggerr")!]!));
      out.set(nn(this.heaps[this.slots.get(`cls:${name}`)!]!), members);
    }
    return out;
  }
  /** Open bases nothing instantiates, by heap type, with the final subtype struct.new must use instead. */
  instantiableOf(): Map<number, number> {
    const out = new Map<number, number>();
    if (this.sharedRuntime) return out;
    const strKey = GcTypes.typeKey({ kind: "array", elem: { kind: "string" } });
    const fin = this.slots.get(`${strKey}!`);
    if (fin !== undefined) out.set(this.heaps[this.slots.get(strKey)!]!, this.heaps[fin]!);
    return out;
  }
  typedBase(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("typedbase")!]!, false); }
  /** Native dyn: the supertype of every typed record (non-null ref type). */
  typedRec(): number {
    const slot = this.slots.get("typedrec");
    // No record type at all: nothing is a typed record (a type nothing subtypes).
    return slot === undefined ? binaryen.getTypeFromHeapType(binaryen.getHeapType(binaryen.nullref), false) : binaryen.getTypeFromHeapType(this.heaps[slot]!, false);
  }
  /** A slot's heap type while its group builds: a temp of this builder, or
   * an already built type of an earlier group. */
  private htIndex(b: binaryen.TypeBuilder, index: number): number {
    return index < this.groupBase ? this.heaps[index]! : b.getTempHeapType(index - this.groupBase);
  }

  /** Register a composite type (and everything it reaches). */
  require(t: IrType): void {
    switch (t.kind) {
      case "f64": case "bool": case "string": case "moduleNs": case "void": case "undefinedT": case "nullT": case "dyn": case "caught": case "jsval": case "regex": case "date": case "symbol": case "bigint": return;
      case "array": return this.array(t.elem);
      case "record": return this.record(t.shapeId);
      case "object": if (t.className === this.simdV128) return; return this.klass(t.className);
      case "union": return this.union(t.unionId);
      case "func": return this.closure(t);
      case "map": return this.mapType(t.key, t.value);
      case "set": return this.mapType(t.elem, null);
      case "promise": this.promiseTypes(); return this.require(t.inner);
      case "generator": this.generatorTypes(); this.require(t.yieldT); this.require(t.retT); this.require(t.nextT); return;
      case "bytes": return this.bytesType();
      case "classval": return this.classObjType(t.className);
      default: this.unsupported(`type ${t.kind}`);
    }
  }

  /** Typed arrays: $Bytes { base, len, owner, cap, buffer, token } over linear memory (bytes.ts). $Bytes is open, and every
   * typed array is one of its final subtypes, one per element kind ($Bytes.<elem>, the same fields): a typed array's own
   * operations read it as $Bytes, and a union of typed arrays of different kinds (`Float32Array | Float64Array`) is a
   * reference union whose arms ref.test tells apart (chooseRep), with no box. */
  bytesType(): void {
    if (this.slots.has("bytes")) return;
    const fields = () => [this.bytesField(binaryen.i32), this.bytesField(binaryen.i32), this.bytesField(binaryen.anyref), this.bytesField(binaryen.i32),
      { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true }];
    this.slot("bytes", (b, i) => { b.setStructType(i, fields()); b.setOpen(i); });
    for (const elem of BYTES_ELEMS) this.slot(`bytes:${elem}`, (b, i) => { b.setStructType(i, fields()); b.setSubType(i, this.htIndex(b, this.slots.get("bytes")!)); });
  }
  private bytesField(type: number) { return { type, packedType: binaryen.notPacked, mutable: false }; }
  /** Whether the module has the typed-array struct ($Bytes). */
  hasBytes(): boolean { return this.slots.has("bytes"); }
  bytesRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("bytes")!]!, true); }
  /** (ref null $Bytes.<elem>): the struct every typed array of that element kind is. */
  bytesElemRef(elem: IrBytesElem): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get(`bytes:${elem}`)!]!, true); }

  /** The resume signature shared by async frames and generators: (frame, value, mode) -> (). */
  resumeSigType(): void {
    this.slot("resumeSig", (b, i) => b.setSignatureType(i, b.getTempTupleType([binaryen.structref, binaryen.anyref, binaryen.i32]), binaryen.none));
  }

  /** The uniform generator object: its function's frame (any frame struct), the resume function, status and the out slot. */
  generatorTypes(): void {
    if (this.slots.has("generator")) return;
    this.resumeSigType();
    this.slot("generator", (b, i) => b.setStructType(i, [
      { type: binaryen.structref, packedType: binaryen.notPacked, mutable: true },
      { type: b.getTempRefType(this.htIndex(b, this.slots.get("resumeSig")!), false), packedType: binaryen.notPacked, mutable: false },
      { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.i32, packedType: binaryen.notPacked, mutable: false },
    ]));
  }
  generatorRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("generator")!]!, true); }
  generatorHeap(): number { return this.heaps[this.slots.get("generator")!]!; }
  hasGenerators(): boolean { return this.slots.has("generator"); }

  /** The async runtime's fixed types: $Promise, $Job and the resume signature. */
  promiseTypes(): void {
    if (this.slots.has("promise")) return;
    this.resumeSigType();
    const ref = (b: binaryen.TypeBuilder, slot: string, nullable: boolean) => b.getTempRefType(this.htIndex(b, this.slots.get(slot)!), nullable);
    const field = (type: number, mutable = true) => ({ type, packedType: binaryen.notPacked, mutable });
    this.slot("job", (b, i) => b.setStructType(i, [field(ref(b, "resumeSig", false), false), field(binaryen.structref, false), field(binaryen.anyref), field(binaryen.i32), field(ref(b, "job", true))]));
    this.slot("promise", (b, i) => b.setStructType(i, [field(binaryen.i32), field(binaryen.anyref), field(ref(b, "job", true)), field(binaryen.i32)]));
    // Promise.all aggregate { result, values, remaining } and per-entry env { agg, index }.
    this.slot("agg", (b, i) => b.setStructType(i, [field(ref(b, "promise", true), false), field(b.getTempRefType(this.htIndex(b, this.slots.get("anyarr")!), true), false), field(binaryen.i32)]));
    this.slot("aggEntry", (b, i) => b.setStructType(i, [field(ref(b, "agg", true), false), field(binaryen.i32, false)]));
    this.slot("unhandled", (b, i) => b.setStructType(i, [field(ref(b, "promise", true), false), field(ref(b, "unhandled", true), false)]));
    // A dyn promise's `then` reaction env { derived promise, onFulfilled, onRejected }; a dyn Promise.all/allSettled/any/race
    // aggregate { result, values (a dyn array), remaining } and its per-entry env { aggregate, index }.
    if (this.nativeDyn) {
      this.slot("preact", (b, i) => b.setStructType(i, [field(ref(b, "promise", true), false), field(binaryen.anyref, false), field(binaryen.anyref, false), field(binaryen.i32, false)]));
      this.slot("pagg", (b, i) => b.setStructType(i, [field(ref(b, "promise", true), false), field(ref(b, "dyn:arr", true), false), field(binaryen.i32)]));
      this.slot("paggEntry", (b, i) => b.setStructType(i, [field(ref(b, "pagg", true), false), field(binaryen.i32, false)]));
    }
  }

  /** The frame of one async function: fixed header then every local. */
  frame(f: IrFunction): void {
    const generator = Boolean(f.generator) && !f.async;
    if (generator) this.generatorTypes(); else this.promiseTypes();
    const fields = [...f.params.filter(p => !f.locals.some(l => l.id === p.localId)).map(p => ({ id: p.localId, type: p.type, boxed: false })),
      ...f.locals.map(l => ({ id: l.id, type: l.type, boxed: Boolean(l.boxed) }))];
    for (const x of fields) { if (x.boxed) this.box(x.type); else this.require(x.type); }
    this.frameLocals.set(f.name, fields.map(x => x.id));
    this.slot(`frame:${f.name}`, (b, i) => b.setStructType(i, [
      { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true },
      { type: b.getTempRefType(this.htIndex(b, this.slots.get(generator ? "generator" : "promise")!), true), packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.structref, packedType: binaryen.notPacked, mutable: true },
      ...fields.map(x => ({ type: x.boxed ? b.getTempRefType(this.htIndex(b, this.slots.get(`box:${GcTypes.typeKey(x.type)}`)!), true) : this.temp(b, x.type), packedType: binaryen.notPacked, mutable: true })),
    ]));
  }

  private mapType(key: IrType, value: IrType | null): void {
    // Scalars hash by value; references by identity (emitter: REF_KEY_KINDS).
    const refKey = ["object", "record", "array", "func", "map", "set", "bytes", "promise"].includes(key.kind) || this.isIdentityUnion(key);
    // Engine values (dyn on the browser target, jsval) hash through the host by SameValueZero.
    const engineKey = key.kind === "jsval" || key.kind === "bigint" || key.kind === "dyn" && this.engineDyn;
    if (key.kind !== "f64" && key.kind !== "string" && key.kind !== "bool" && !refKey && !engineKey && !this.isValueKeyUnion(key)) this.unsupported(`map key of kind ${key.kind}`);
    const mapKey = value ? GcTypes.typeKey({ kind: "map", key, value }) : GcTypes.typeKey({ kind: "set", elem: key });
    if (this.slots.has(mapKey)) return;
    this.array(key);
    if (value) this.array(value);
    this.slot("i8s", (b, i) => b.setArrayType(i, binaryen.i32, binaryen.i8, true));
    this.slot("i32s", (b, i) => b.setArrayType(i, binaryen.i32, binaryen.notPacked, true));
    const keyData = `data:${GcTypes.typeKey({ kind: "array", elem: key })}`, valData = value ? `data:${GcTypes.typeKey({ kind: "array", elem: value })}` : "i32s";
    const ref = (b: binaryen.TypeBuilder, slot: string) => b.getTempRefType(this.htIndex(b, this.slots.get(slot)!), true);
    const field = (type: number) => ({ type, packedType: binaryen.notPacked, mutable: true });
    this.slot(mapKey, (b, i) => b.setStructType(i, [
      field(ref(b, keyData)), field(ref(b, valData)), field(ref(b, "i8s")), field(ref(b, "i32s")), field(ref(b, "i32s")), field(ref(b, "i32s")),
      field(binaryen.i32), field(binaryen.i32), field(binaryen.i32),
    ]));
  }

  /** dyn:obj's fields: {shape, slots, proto, js}; constructor structs repeat them. */
  /** experimentalDynInlineSlots: dyn:obj's inline property slots (anyref fields after its four). Set before any type is built. */
  inlineSlots = 0;
  private objBaseFields(b: binaryen.TypeBuilder) {
    const own = (slot: string) => ({ type: b.getTempRefType(this.htIndex(b, this.slots.get(slot)!), true), packedType: binaryen.notPacked, mutable: true });
    const any = { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true };
    return [own("dyn:shape"), own("anyarr"), any,
      { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true }, ...Array.from({ length: this.inlineSlots }, () => any)];
  }
  /** Constructor structs (experimentalJsConstructorStructs, ctor-structs.ts):
   * a final subtype of dyn:obj per recognized JS constructor, its own
   * properties as fields after dyn:obj's four (anyref, or i32/f64 for
   * number-only fields). Register after collect(), before build(). */
  private readonly ctorKeys: string[] = [];
  ctorStruct(key: string, kinds: readonly ("any" | "i32" | "f64")[]): void {
    const slotKey = `ctor:${key}`;
    if (this.slots.has(slotKey)) return;
    this.ctorKeys.push(key);
    // dyn:obj becomes an open BASE nothing instantiates: plain objects are of its final subtype `dyn:obj!`, so an
    // "is a dynamic object" test is a chain of exact tests (dynObj().heap is the instantiable one).
    if (!this.sharedRuntime) this.slot("dyn:obj!", (b, i) => {
      b.setStructType(i, this.objBaseFields(b));
      b.setSubType(i, this.htIndex(b, this.slots.get("dyn:obj")!));
    });
    const wasm = { any: binaryen.anyref, i32: binaryen.i32, f64: binaryen.f64 };
    this.slot(slotKey, (b, i) => {
      b.setStructType(i, [...this.objBaseFields(b), ...kinds.map(k => ({ type: wasm[k], packedType: binaryen.notPacked, mutable: true }))]);
      b.setSubType(i, this.htIndex(b, this.slots.get("dyn:obj")!));
    });
  }
  ctorStructOf(key: string): { ref: number; heap: number } {
    const heap = this.heaps[this.slots.get(`ctor:${key}`)!]!;
    return { ref: binaryen.getTypeFromHeapType(heap, true), heap };
  }

  /** Native dyn Map and Set (JS sources' `new Map` / `new Set`): the Map/Set
   * runtime layout (emitter mapRuntime) over dyn keys and values, plus
   * DYNCOLL_JS, the page Map/Set it became when it crossed to the page (null
   * until then; every operation then forwards to it). The extra field keeps
   * both distinct from every TypeScript Map/Set layout. */
  private dynCollectionSlots(): void {
    const ref = (b: binaryen.TypeBuilder, slot: string) => b.getTempRefType(this.htIndex(b, this.slots.get(slot)!), true);
    const field = (type: number) => ({ type, packedType: binaryen.notPacked, mutable: true });
    for (const kind of ["map", "set"] as const) this.slot(`dyncoll:${kind}`, (b, i) => b.setStructType(i, [
      field(ref(b, "anyarr")), field(ref(b, kind === "map" ? "anyarr" : "i32s")), field(ref(b, "i8s")), field(ref(b, "i32s")), field(ref(b, "i32s")), field(ref(b, "i32s")),
      field(binaryen.i32), field(binaryen.i32), field(binaryen.i32), field(binaryen.externref), field(binaryen.anyref),
      ...(this.idFields ? [field(binaryen.i32)] : []),
    ]));
  }
  /** Built-in iterator state and the Map/Set change log (see ITER_* / ITERLOG_*). */
  private iterSlots(): void {
    const field = (type: number) => ({ type, packedType: binaryen.notPacked, mutable: true });
    this.slot("iterlog", (b, i) => b.setStructType(i, [field(binaryen.i32), field(b.getTempRefType(this.htIndex(b, this.slots.get("i8s")!), true)), field(binaryen.anyref)]));
    this.slot("iterstate", (b, i) => b.setStructType(i, [field(binaryen.anyref), field(binaryen.i32), field(binaryen.i32), field(binaryen.anyref), field(binaryen.externref), field(binaryen.i32), field(binaryen.i32), field(binaryen.anyref), field(binaryen.i32)]));
  }
  iterState(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("iterstate")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  iterLog(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("iterlog")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  dynCollectionOf(kind: "map" | "set"): MapInfo {
    const cached = this.maps.get(`dyncoll:${kind}`);
    if (cached) return cached;
    const heap = this.heaps[this.slots.get(`dyncoll:${kind}`)!]!, nullable = (slot: string) => binaryen.getTypeFromHeapType(this.heaps[this.slots.get(slot)!]!, true);
    const info: MapInfo = { ref: binaryen.getTypeFromHeapType(heap, true), heap, keys: nullable("anyarr"), vals: nullable(kind === "map" ? "anyarr" : "i32s"),
      key: binaryen.anyref, val: kind === "map" ? binaryen.anyref : binaryen.i32, i8s: nullable("i8s"), i32s: nullable("i32s") };
    this.maps.set(`dyncoll:${kind}`, info);
    return info;
  }

  private slot(key: string, build: (b: binaryen.TypeBuilder, index: number) => void): boolean {
    if (this.sharedRuntime && !this.runtimeDone) this.ensureSharedRuntime();
    if (this.slots.has(key)) return false;
    if (this.built) throw new Error(`wasmgc type ${key} requested after the type group was built`);
    this.slots.set(key, this.defs.length);
    this.defs.push({ key, build });
    return true;
  }

  private array(elem: IrType): void {
    const key = GcTypes.typeKey({ kind: "array", elem });
    // Element types sharing one layout key (every Promise<T> is the one
    // promise struct) still each need their own payload types registered:
    // a page facade converting a Promise<B>[] element casts to B even when
    // Promise<A>[] claimed the slot first.
    if (!this.slot(`data:${key}`, (b, i) => b.setArrayType(i, this.temp(b, elem), binaryen.notPacked, true))) return this.require(elem);
    this.slot(`states:${key}`, (b, i) => b.setArrayType(i, binaryen.i32, binaryen.i8, true));
    this.slot(key, (b, i) => {
      b.setStructType(i, [
        { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true },
        { type: b.getTempRefType(this.htIndex(b, this.slots.get(`data:${key}`)!), true), packedType: binaryen.notPacked, mutable: true },
        { type: b.getTempRefType(this.htIndex(b, this.slots.get(`states:${key}`)!), true), packedType: binaryen.notPacked, mutable: true },
      ]);
      if (this.sharedRuntime) b.setSubType(i, this.htIndex(b, this.slots.get("typedbase")!));
      // Open on the whole browser target (not only with regex): modules linked into one runtime agree on its finality.
      if (this.browser && elem.kind === "string" && (this.sharedRuntime || this.matchArrays)) b.setOpen(i);
    });
    this.require(elem);
  }

  /** Native dyn: every typed record is a subtype of $typedrec, so one
   * ref.test answers "a typed record" ($typed.is) whatever the number of
   * record types (under $typedbase in a shared runtime). Created before the
   * first record so the supertype precedes its subtypes in the group. */
  private ensureTypedRec(): void {
    if (!this.nativeDyn) return;
    this.slot("typedrec", (b, i) => {
      // Browser: the page object a record stands for is every record's first
      // field, so one struct.get reads it whatever the record type.
      // The type index ends the prefix: a dispatcher reads it whatever the record type.
      const tid = { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true };
      b.setStructType(i, this.browser ? [{ type: binaryen.externref, packedType: binaryen.notPacked, mutable: true }, ...(this.idFields ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []), ...(this.frozenBit ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []), tid] : [tid]); b.setOpen(i);
      if (this.sharedRuntime) b.setSubType(i, this.htIndex(b, this.slots.get("typedbase")!));
    });
  }

  private record(id: string): void {
    this.ensureTypedRec();
    const fields = this.recordDefs.get(id);
    if (!fields) this.unsupported(`record shape ${id}`);
    // An index signature adds one trailing field: the overflow Map<string, V>
    // for undeclared keys (null until the first one is stored).
    const indexValue = this.indexValues.get(id);
    // (the overflow keys of an open record cross to untyped code as a string array)
    if (indexValue) { this.mapType({ kind: "string" }, indexValue); this.require({ kind: "array", elem: { kind: "string" } }); }
    const ovfKey = indexValue ? GcTypes.typeKey({ kind: "map", key: { kind: "string" }, value: indexValue }) : null;
    // Browser: the page object this record stands for (null when the record
    // was built in compiled code); field access goes to it when set. First in
    // a native-dyn record (the $typedrec prefix), last otherwise.
    const jsField = { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true };
    const jsFirst = this.recordJsFirst(id);
    if (!this.slot(`rec:${id}`, (b, i) => {
      b.setStructType(i, [
        ...(jsFirst ? [jsField] : []),
        ...(jsFirst && this.idFields ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
        ...(jsFirst && this.frozenBit ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
        ...(this.hasTid(id) ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
        ...fields!.map(f => ({ type: this.fieldTemp(b, f.type, { shape: id }, f.name), packedType: binaryen.notPacked, mutable: true })),
        ...(ovfKey ? [{ type: b.getTempRefType(this.htIndex(b, this.slots.get(ovfKey)!), true), packedType: binaryen.notPacked, mutable: true }] : []),
        ...(this.browser && !jsFirst ? [jsField] : []),
      ]);
      if (this.nativeDyn && !this.isTupleShape(id)) b.setSubType(i, this.htIndex(b, this.slots.get("typedrec")!));
      else if (this.sharedRuntime) b.setSubType(i, this.htIndex(b, this.slots.get("typedbase")!));
      if (this.srcShapes.has(id) && !this.isTupleShape(id) && !indexValue && this.nativeDyn) b.setOpen(i);
    })) return;
    if (this.hasTid(id)) this.recordTids.set(id, this.recordTids.size + 1);
    for (const f of fields!) this.require(f.type);
    if (this.srcShapes.has(id) && !this.isTupleShape(id) && !indexValue && this.nativeDyn) {
      // The extension subtype: the same fields, then the source object. The closed record is its (open) supertype.
      this.slot(`recx:${id}`, (b, i) => {
        b.setStructType(i, [
          ...(jsFirst ? [jsField] : []),
          ...(jsFirst && this.idFields ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
          ...(jsFirst && this.frozenBit ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
          ...(this.hasTid(id) ? [{ type: binaryen.i32, packedType: binaryen.notPacked, mutable: true }] : []),
          ...fields!.map(f => ({ type: this.fieldTemp(b, f.type, { shape: id }, f.name), packedType: binaryen.notPacked, mutable: true })),
          ...(this.browser && !jsFirst ? [jsField] : []),
          { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true },
        ]);
        b.setSubType(i, this.htIndex(b, this.slots.get(`rec:${id}`)!));
      });
    }
  }

  private klass(name: string): void {
    const def = this.classDefs.get(name);
    if (!def) this.unsupported(`class ${name}`);
    this.ensureClassBase();
    // Supertypes must precede subtypes inside the recursion group.
    if (def!.base && !this.slots.has(`cls:${def!.base}`)) { this.klass(def!.base); if (this.slots.has(`cls:${name}`)) return; }
    if (!this.slot(`cls:${name}`, (b, i) => {
      b.setStructType(i, [...this.classPrefix(), ...def!.fields.map(f => ({ type: this.fieldTemp(b, f.type, { cls: name }, f.name), packedType: this.fieldPacked({ cls: name }, f.name), mutable: true }))]);
      // A class nothing extends is FINAL: a test against it is an inlined exact-type compare (a non-final
      // target costs a runtime subtype check). The runtime error classes and a shared runtime stay open.
      if (this.sharedRuntime || name === "%Error" || this.hasSubclass(name)) b.setOpen(i);
      if (def!.base) b.setSubType(i, this.htIndex(b, this.slots.get(`cls:${def!.base}`)!));
      else if (this.slots.has("classbase")) b.setSubType(i, this.htIndex(b, this.slots.get("classbase")!));
      // Shared runtime: a root class is a $typedbase subtype too, so another
      // module recognizes (and refuses) its instances instead of misreading them.
      else if (this.sharedRuntime) b.setSubType(i, this.htIndex(b, this.slots.get("typedbase")!));
    })) return;
    if (this.hasCid) this.classCids.set(name, this.classCids.size + 1);
    // A class others extend is an open BASE nothing instantiates: its instances are of a FINAL subtype
    // `clsf:` (same layout), so "instance of X" is a chain of exact tests on the final types.
    if (this.splitsClass(name)) this.slot(`clsf:${name}`, (b, i) => {
      b.setStructType(i, [...this.classPrefix(), ...def!.fields.map(f => ({ type: this.fieldTemp(b, f.type, { cls: name }, f.name), packedType: this.fieldPacked({ cls: name }, f.name), mutable: true }))]);
      b.setSubType(i, this.htIndex(b, this.slots.get(`cls:${name}`)!));
    });
    if (def!.base) this.klass(def!.base);
    for (const sub of this.subclasses.get(name) ?? []) this.klass(sub);
    for (const f of def!.fields) this.require(f.type);
  }

  /* ── union representations ───────────────────────────────────────── */
  private readonly reps = new Map<string, UnionRep>();
  /** SCRIPTC_WASMGC_UNION_BOX=1: every union boxed, as before reference
   * representations existed (A/B measurement only). */
  /** SCRIPTC_WASMGC_NO_INLINE_SCALAR_FIELDS=1: every scalar-union field boxed, as before inline fields (A/B). A shared
   * runtime boxes them too: a record crossing modules must have one layout. */
  readonly inlineFields = typeof process === "undefined" || process.env?.["SCRIPTC_WASMGC_NO_INLINE_SCALAR_FIELDS"] !== "1";
  private readonly inlineCache = new Map<string, InlineField | null>();
  /** The inline storage of a field of type `t` (null: held as the value itself). `cls`: the owning class (the runtime's
   * own `%` classes keep their fixed layouts); `shape`: the owning record (a tuple keeps its elements as values). */
  inlineField(t: IrType, owner?: { cls?: string; shape?: string }): InlineField | null {
    if (t.kind !== "union" || !this.inlineFields || this.sharedRuntime || this.unionBoxAll) return null;
    if (owner?.shape !== undefined && this.isTupleShape(owner.shape)) return null;
    for (let c = owner?.cls; c !== undefined; c = this.classDefs.get(c)?.base) if (c.startsWith("%")) return null;
    const cached = this.inlineCache.get(t.unionId);
    if (cached !== undefined) return cached;
    let out: InlineField | null = null;
    const arms = this.unionDefs.get(t.unionId);
    if (arms && this.unionRep(t.unionId).kind === "box" && arms.length <= 3) {
      const undefTag = arms.findIndex(a => a.kind === "undefinedT"), nullTag = arms.findIndex(a => a.kind === "nullT");
      const scalars = arms.map((a, i) => [a, i] as const).filter(([a]) => a.kind !== "undefinedT" && a.kind !== "nullT");
      const units = (undefTag >= 0 ? 1 : 0) + (nullTag >= 0 ? 1 : 0);
      if (units >= 1 && scalars.length === 1 && units + 1 === arms.length && (scalars[0]![0].kind === "f64" || scalars[0]![0].kind === "bool"))
        out = { kind: scalars[0]![0].kind === "f64" ? "num" : "bool", unionId: t.unionId, scalarTag: scalars[0]![1], undefTag, nullTag,
          key: undefTag >= 0 ? INLINE_UNDEF_BITS : INLINE_DEFAULT_BITS };
    }
    this.inlineCache.set(t.unionId, out);
    return out;
  }
  /** Atom string fields (SCRIPTC_WASMGC_ATOM_STRINGS, the emitter's computeAtomFields): string fields held as i32 atom
   * ids, keyed `r:<shapeId>.<field>` and `c:<class>.<field>` (every class of a hierarchy that has the field). */
  atomFields: ReadonlySet<string> | null = null;
  isAtomField(owner: { cls?: string; shape?: string }, field: string): boolean {
    return this.atomFields !== null && this.atomFields.has(owner.shape !== undefined ? `r:${owner.shape}.${field}` : `c:${owner.cls}.${field}`);
  }
  /** Fixed-width integer class fields (contracts/check.ts proved every write), keyed `c:<class>.<field>` for every
   * class of a hierarchy that has the field: stored as i32, packed to i8/i16 for the 8- and 16-bit types. */
  narrowFields: ReadonlyMap<string, NarrowKind> | null = null;
  narrowField(owner: { cls?: string; shape?: string }, field: string): NarrowKind | null {
    return this.narrowFields !== null && owner.cls !== undefined ? this.narrowFields.get(`c:${owner.cls}.${field}`) ?? null : null;
  }
  /** A class field's packed storage (binaryen.i8 or binaryen.i16), or notPacked. */
  fieldPacked(owner: { cls?: string; shape?: string }, field: string): number {
    const k = this.narrowField(owner, field);
    return k === "Int8" || k === "Uint8" ? binaryen.i8 : k === "Int16" || k === "Uint16" ? binaryen.i16 : binaryen.notPacked;
  }
  /** A field's storage type while the group builds. */
  private fieldTemp(b: binaryen.TypeBuilder, t: IrType, owner: { cls?: string; shape?: string }, field?: string): number {
    if (field !== undefined && this.isAtomField(owner, field)) return binaryen.i32;
    if (field !== undefined && this.narrowField(owner, field)) return binaryen.i32;
    const s = this.inlineField(t, owner);
    return s ? (s.kind === "num" ? binaryen.i64 : binaryen.i32) : this.temp(b, t);
  }
  /** A field's storage type (after build). */
  fieldValue(t: IrType, owner: { cls?: string; shape?: string }): number {
    const s = this.inlineField(t, owner);
    return s ? (s.kind === "num" ? binaryen.i64 : binaryen.i32) : this.value(t);
  }
  private readonly unionBoxAll = typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_UNION_BOX"] === "1";
  /** SCRIPTC_WASMGC_UNION_AUDIT=1 (compiler testing, never shipped): each
   * reference-represented union's values sit in a wrapper struct of their
   * own, so a value that moves between two unions, or from an arm into a
   * union, without going through the emitter's conversions fails Wasm
   * validation instead of being misread. Allocates per value. */
  readonly unionAudit = typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_UNION_AUDIT"] === "1";
  /** A union of reference arms only (no null/undefined), held as one eqref:
   * keyed by identity like any reference. */
  /** A union Map/Set key compared by value: every arm a scalar, a unit, a reference (by identity) or a
   * host value (the host's SameValueZero). Two values of different arms are never SameValueZero-equal,
   * so equal keys have equal tags and equal payloads (emitter: mapRuntime). */
  isValueKeyUnion(t: IrType): boolean {
    if (t.kind !== "union" || this.isIdentityUnion(t)) return false;
    return this.unionArms(t.unionId).every(a => ["f64", "string", "bool", "nullT", "undefinedT", "void", "jsval", "bigint", "symbol",
      "object", "record", "array", "func", "map", "set", "bytes", "promise"].includes(a.kind) || this.isIdentityUnion(a));
  }
  isIdentityUnion(t: IrType): boolean {
    if (t.kind !== "union") return false;
    const rep = this.unionRep(t.unionId);
    return rep.kind === "refs" && rep.nullTag < 0 && rep.undefTag < 0;
  }
  unionRep(id: string): UnionRep {
    const cached = this.reps.get(id);
    if (cached) return cached;
    const arms = this.unionDefs.get(id) ?? this.unsupported(`union ${id}`);
    const rep = this.chooseRep(arms);
    this.reps.set(id, rep);
    return rep;
  }
  private chooseRep(arms: IrType[]): UnionRep {
    const box: UnionRep = { kind: "box" };
    if (this.unionBoxAll) return box;
    const nullTag = arms.findIndex(a => a.kind === "nullT"), undefTag = arms.findIndex(a => a.kind === "undefinedT");
    // A string is an externref that is never null as a value, so `string |
    // null` and `string | undefined` hold it like a reference arm. It has no
    // eqref form, so it never joins a refs union.
    // A module namespace is held as its id token, a string.
    const strTag = arms.findIndex(a => a.kind === "string" || a.kind === "moduleNs");
    if (strTag >= 0 && arms.length === 2 && (nullTag >= 0 || undefTag >= 0)) return { kind: "ref1", refTag: strTag, unitTag: nullTag >= 0 ? nullTag : undefTag };
    const refTags: number[] = [], heaps = new Set<string>();
    for (let tag = 0; tag < arms.length; tag++) {
      const arm = arms[tag]!;
      if (arm.kind === "nullT" || arm.kind === "undefinedT") continue;
      if (!REF_ARM_KINDS.has(arm.kind) || arm.kind === "object" && arm.className === this.simdV128) return box;
      // ref.test tells arms apart only by their heap types: every promise is
      // one $Promise; typed arrays by element kind ($Bytes.<elem>).
      const heap = arm.kind === "bytes" ? `bytes:${arm.elem}` : arm.kind === "promise" || arm.kind === "func" ? arm.kind : GcTypes.typeKey(arm);
      if (heaps.has(heap)) return box;
      heaps.add(heap);
      refTags.push(tag);
    }
    if (!refTags.length) return box;
    if (refTags.length === 1 && (nullTag < 0) !== (undefTag < 0)) return { kind: "ref1", refTag: refTags[0]!, unitTag: nullTag < 0 ? undefTag : nullTag };
    // A subclass arm is tested before its base: its instances test as both.
    const depth = (tag: number): number => {
      const arm = arms[tag]!;
      let d = 0;
      for (let c = arm.kind === "object" ? this.classDefs.get(arm.className) : undefined; c?.base; c = this.classDefs.get(c.base)) d++;
      return d;
    };
    refTags.sort((x, y) => depth(y) - depth(x) || x - y);
    return { kind: "refs", refTags, nullTag, undefTag };
  }
  /** A reference-represented union's own encoding type (the audit wrapper's field). */
  private repTemp(b: binaryen.TypeBuilder, id: string): number {
    const rep = this.unionRep(id);
    return rep.kind === "ref1" ? this.temp(b, this.unionDefs.get(id)![rep.refTag]!) : binaryen.eqref;
  }
  /** The value type of a reference-represented union's own encoding, after build():
   * the arm's nullable reference (ref1) or eqref (refs); under audit, what the wrapper holds. */
  unionRepType(id: string): number {
    const rep = this.unionRep(id);
    if (rep.kind === "box") return this.unionOf(id);
    return rep.kind === "ref1" ? this.value(this.unionDefs.get(id)![rep.refTag]!) : binaryen.eqref;
  }

  private union(id: string): void {
    const arms = this.unionDefs.get(id);
    if (!arms) this.unsupported(`union ${id}`);
    this.unionIds.add(id);
    if (this.unionRep(id).kind !== "box") {
      if (this.unionAudit) this.slot(`audit:${id}`, (b, i) => b.setStructType(i, [{ type: this.repTemp(b, id), packedType: binaryen.notPacked, mutable: false }]));
      if (!this.unionArmsSeen.has(id)) { this.unionArmsSeen.add(id); for (const arm of arms!) this.require(arm); }
      return;
    }
    // One struct layout serves every boxed union: tags are per union definition,
    // but values of unions sharing tags (V and V | undefined) interoperate.
    if (!this.slot("union", (b, i) => b.setStructType(i, [
      { type: binaryen.i32, packedType: binaryen.notPacked, mutable: false },
      { type: binaryen.f64, packedType: binaryen.notPacked, mutable: false },
      { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: false },
      { type: binaryen.externref, packedType: binaryen.notPacked, mutable: false },
    ]))) { if (!this.unionArmsSeen.has(id)) { this.unionArmsSeen.add(id); for (const arm of arms!) this.require(arm); } return; }
    this.unionArmsSeen.add(id);
    for (const arm of arms!) this.require(arm);
  }

  /** A func type whose closures take the hidden trailing dyn array. */
  static hiddenRest(t: IrType & { kind: "func" }): boolean { return (t.rest === true || t.argumentsAll === true) && t.restAbi === undefined; }

  private closure(t: IrType & { kind: "func" }): void {
    // The checked-dynamic rest ABI: one hidden trailing dyn array (typed and
    // island rest ABIs already spell their array in params).
    if ((t.rest || t.argumentsAll) && !this.engineDyn && !this.browser && t.restAbi === undefined) this.unsupported("rest/arguments function type");
    const key = GcTypes.typeKey(t);
    const hidden: IrType[] = GcTypes.hiddenRest(t) ? [{ kind: "dyn" }] : [];
    if (!this.slot(`sig:${key}`, (b, i) => {
      // A one-element tuple is invalid: a single parameter is passed as itself.
      const params = [binaryen.structref, ...[...t.params, ...hidden].map(p => this.temp(b, p))];
      b.setSignatureType(i, params.length === 1 ? params[0]! : b.getTempTupleType(params), this.temp(b, t.ret));
    })) return;
    // Every closure struct extends the open $fnbase, so `typeof v` on a
    // dynamic value recognises functions with a single ref.test. Native dyn:
    // $fnbase is {code, env, invoke, props, js} — `invoke` is the uniform dynamic
    // entry (dyn-call adapter for this signature, or null), `props` holds
    // `prototype` and expandos, and `js` caches the function's page wrapper;
    // each closure refines `code` to its signature.
    this.fnbaseSlots();
    for (const p of t.params) this.require(p);
    this.require(t.ret);
  }

  /** $fnbase (and, for native dyn, the uniform invoke signature). */
  private fnbaseSlots(): void {
    const imm = (type: number) => ({ type, packedType: binaryen.notPacked, mutable: false });
    const invokeField = (_b: binaryen.TypeBuilder) => imm(binaryen.i32);
    const propsField = (b: binaryen.TypeBuilder) => ({ type: b.getTempRefType(this.htIndex(b, this.slots.get("dyn:obj")!), true), packedType: binaryen.notPacked, mutable: true });
    this.slot("fnmeta", (b, i) => b.setStructType(i, [
      imm(binaryen.getTypeFromHeapType(binaryen.getHeapType(binaryen.externref), false)), imm(binaryen.i32), imm(binaryen.i32)]));
    if (this.nativeDyn) this.slot("sig:dyninvoke", (b, i) => b.setSignatureType(i, b.getTempTupleType([
      binaryen.structref, binaryen.anyref, binaryen.i32, binaryen.anyref, binaryen.anyref, binaryen.anyref, binaryen.anyref,
      b.getTempRefType(this.htIndex(b, this.slots.get("dyn:arr")!), true)]), binaryen.anyref));
    // A bound function's environment (Function.prototype.bind): target, this,
    // the bound-argument count and up to four bound arguments in the struct
    // itself; more than four live in `rest` (a dyn:arr) instead.
    if (this.nativeDyn) this.slot("dyn:bound", (b, i) => b.setStructType(i, [imm(binaryen.anyref), imm(binaryen.anyref), imm(binaryen.i32),
      imm(binaryen.anyref), imm(binaryen.anyref), imm(binaryen.anyref), imm(binaryen.anyref), imm(b.getTempRefType(this.htIndex(b, this.slots.get("dyn:arr")!), true))]));
    this.slot("fnbase", (b, i) => {
      b.setStructType(i, this.nativeDyn ? [imm(binaryen.i32), imm(binaryen.structref), invokeField(b), propsField(b),
        { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true }, imm(b.getTempRefType(this.htIndex(b, this.slots.get("fnmeta")!), true))] : []);
      b.setOpen(i);
    });
    const jsField = { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true };
    // ONE final closure struct serves every signature: `typeof`/is-function tests are exact-type
    // tests (wasmtime inlines those only for final types), and a typed call casts the code field
    // to its signature (also an exact test). The signature lives in the code's function type.
    this.slot("closure", (b, i) => {
      b.setStructType(i, [
        imm(binaryen.i32),
        { type: binaryen.structref, packedType: binaryen.notPacked, mutable: false },
        ...(this.nativeDyn ? [invokeField(b), propsField(b), jsField] : []),
        imm(b.getTempRefType(this.htIndex(b, this.slots.get("fnmeta")!), true)),
        // Native dyn: the function a signature adapter stands for (IR `adapts`), null for any other closure (CLOSURE_ORIGIN).
        ...(this.nativeDyn ? [imm(binaryen.anyref)] : []),
      ]);
      b.setSubType(i, this.htIndex(b, this.slots.get("fnbase")!));
    });
  }

  /** $classval (CLASSOBJ_*): $fnbase's fields, then {cid, proto, caps}. */
  private classObjType(className: string): void {
    // Engine dyn has no class values: collection skips them (a local nothing reads,
    // deadClassvals, needs no slot) and a real use fails in valueType.
    if (!this.nativeDyn) return;
    this.klass(className);
    // $classval extends $fnbase, and a supertype must precede its subtypes in
    // the recursion group: a class value can be required before the base slots.
    this.fnbaseSlots();
    const imm = (type: number) => ({ type, packedType: binaryen.notPacked, mutable: false });
    this.slot("classval", (b, i) => {
      b.setStructType(i, [imm(binaryen.i32), imm(binaryen.structref),
        imm(binaryen.i32),
        { type: b.getTempRefType(this.htIndex(b, this.slots.get("dyn:obj")!), true), packedType: binaryen.notPacked, mutable: true },
        { type: binaryen.externref, packedType: binaryen.notPacked, mutable: true }, imm(b.getTempRefType(this.htIndex(b, this.slots.get("fnmeta")!), true)),
        imm(binaryen.i32), { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true },
        imm(b.getTempRefType(this.htIndex(b, this.slots.get("anyarr")!), true))]);
      b.setSubType(i, this.htIndex(b, this.slots.get("fnbase")!));
    });
  }
  slotsHas(key: string): boolean { return this.slots.has(key); }
  /** (ref null $classval). */
  classObjRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("classval")!]!, true); }

  box(t: IrType): void {
    const key = `box:${GcTypes.typeKey(t)}`;
    // { v, init }: init is the TDZ flag, set once the declaration has run.
    if (this.slot(key, (b, i) => b.setStructType(i, [
      { type: this.temp(b, t), packedType: binaryen.notPacked, mutable: true },
      { type: binaryen.i32, packedType: binaryen.notPacked, mutable: true },
    ]))) this.require(t);
  }

  private env(f: IrFunction): void {
    for (const c of f.captures!) this.box(c.type);
    const layout = this.envLayouts.get(f.name);
    if (layout) {
      for (const c of layout.carriers) if ("box" in c) this.box(c.box);
      if (layout.direct) return;
      this.slot(`env:${f.name}`, (b, i) => b.setStructType(i, layout.carriers.map(c => ({
        type: b.getTempRefType(this.htIndex(b, this.slots.get("box" in c ? `box:${GcTypes.typeKey(c.box)}` : `group:${c.group}`)!), true), packedType: binaryen.notPacked, mutable: false,
      }))));
      return;
    }
    this.slot(`env:${f.name}`, (b, i) => b.setStructType(i, f.captures!.map(c => ({
      type: b.getTempRefType(this.htIndex(b, this.slots.get(`box:${GcTypes.typeKey(c.type)}`)!), true), packedType: binaryen.notPacked, mutable: false,
    }))));
  }

  /** Field/element type while the group is under construction. */
  private temp(b: binaryen.TypeBuilder, t: IrType): number {
    switch (t.kind) {
      case "f64": return binaryen.f64;
      case "bool": return binaryen.i32;
      // A module namespace is its token, the module id (as the native backend holds it).
      case "string": case "moduleNs": case "jsval": case "regex": case "date": case "symbol": case "bigint": return binaryen.externref;
      case "void": return binaryen.none;
      case "dyn": return this.engineDyn ? binaryen.externref : binaryen.anyref;
      case "caught": return binaryen.anyref;
      case "promise": return b.getTempRefType(this.htIndex(b, this.slots.get("promise")!), true);
      case "bytes": return b.getTempRefType(this.htIndex(b, this.slots.get("bytes")!), true);
      default: {
        if (t.kind === "object" && t.className === this.simdV128) return binaryen.v128;
        if (t.kind === "union" && this.unionRep(t.unionId).kind !== "box") {
          if (!this.unionAudit) return this.repTemp(b, t.unionId);
          return b.getTempRefType(this.htIndex(b, this.slots.get(`audit:${t.unionId}`)!), true);
        }
        const index = this.slots.get(t.kind === "union" ? "union" : t.kind === "classval" ? "classval" : t.kind === "func" ? "closure" : GcTypes.typeKey(t));
        if (index === undefined) return this.unsupported(`type ${t.kind}`);
        return b.getTempRefType(this.htIndex(b, index), true);
      }
    }
  }

  /* ── build and lookup ────────────────────────────────────────────── */
  build(): void {
    this.built = true;
    if (!this.defs.length) return;
    // Shared runtime: the runtime group first, then the program group (which
    // refers to the built runtime types); otherwise one group.
    this.heaps = [];
    const groups = this.runtimeCount ? [[0, this.runtimeCount], [this.runtimeCount, this.defs.length]] : [[0, this.defs.length]];
    for (const [lo, hi] of groups) {
      if (hi! <= lo!) continue;
      this.groupBase = lo!;
      const b = new binaryen.TypeBuilder(hi! - lo!);
      for (let i = lo!; i < hi!; i++) this.defs[i]!.build(b, i - lo!);
      b.createRecGroup(0, hi! - lo!);
      this.heaps.push(...b.buildAndDispose());
    }
    const ref = (key: string) => binaryen.getTypeFromHeapType(this.heaps[this.slots.get(key)!]!, true);
    const heap = (key: string) => this.heaps[this.slots.get(key)!]!;
    for (const key of this.slots.keys()) {
      if (key.startsWith("arr<")) this.arrays.set(key, { ref: ref(key), data: ref(`data:${key}`), states: ref(`states:${key}`), elem: 0 });
      else if (key.startsWith("rec:")) {
        const id = key.slice(4), jsFirst = this.recordJsFirst(id), shift = (jsFirst ? 1 + (this.idFields ? 1 : 0) + (this.frozenBit ? 1 : 0) : 0) + (this.hasTid(id) ? 1 : 0);
        const info = this.structInfo(key, this.recordDefs.get(id)!.map(f => f.name), shift);
        if (this.hasTid(id)) { info.tid = this.tidIndex; info.tidValue = this.recordTids.get(id)!; }
        if (this.indexValues.has(id)) info.ovf = this.recordDefs.get(id)!.length + shift;
        if (jsFirst) { info.js = 0; info.jsFirst = true; if (this.idFields) info.id = 1; if (this.frozenBit) info.frozen = this.idFields ? 2 : 1; }
        else if (this.browser) info.js = this.recordDefs.get(id)!.length + (this.indexValues.has(id) ? 1 : 0) + (this.hasTid(id) ? 1 : 0);
        this.records.set(id, info);
      }
      else if (key.startsWith("recx:")) {
        const id = key.slice(5), heap = this.heaps[this.slots.get(key)!]!;
        const jsFirst = this.recordJsFirst(id), shift = (jsFirst ? 1 + (this.idFields ? 1 : 0) + (this.frozenBit ? 1 : 0) : 0) + (this.hasTid(id) ? 1 : 0);
        const base = this.recordDefs.get(id)!.length + shift + (this.browser && !jsFirst ? 1 : 0);
        this.recordExts.set(id, { ref: binaryen.getTypeFromHeapType(heap, true), heap, src: base });
      }
      else if (key.startsWith("cls:")) {
        const info = this.structInfo(key, this.classDefs.get(key.slice(4))!.fields.map(f => f.name), (this.idFields ? 1 : 0) + (this.hasCid ? 1 : 0));
        if (this.idFields) info.id = 0;
        if (this.hasCid) { info.cid = this.cidIndex; info.cidValue = this.classCids.get(key.slice(4)) ?? 0; }
        const fin = this.slots.get(`clsf:${key.slice(4)}`);
        if (fin !== undefined) info.heap = this.heaps[fin]!;
        this.classes.set(key.slice(4), info);
      }
      else if (key === "union") { for (const id of this.unionIds) if (this.unionRep(id).kind === "box") this.unions.set(id, ref(key)); }
      else if (key.startsWith("box:")) this.boxes.set(key.slice(4), ref(key));
      else if (key.startsWith("env:")) this.envs.set(key.slice(4), this.structInfo(key, []));
      else if (key.startsWith("group:")) this.groupInfos.set(key.slice(6), this.structInfo(key, []));
      else if (key.startsWith("dyn:") && key.endsWith("!")) continue;
      else if (key.startsWith("dyn:")) this.dynBoxes.set(key as DynBox, { ref: ref(key), heap: key === "dyn:obj" && this.slots.has("dyn:obj!") ? heap("dyn:obj!") : heap(key) });
      else if (key.startsWith("sig:fn(")) this.closures.set(key.slice(4), { ref: ref("closure"), sig: heap(key), params: [], result: 0 });
    }
    // SCRIPTC_WASMGC_INLINE_FIELD_STATS=1: the fields held inline (stderr).
    if (typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_INLINE_FIELD_STATS"] === "1") {
      const out: string[] = [];
      for (const id of this.records.keys()) for (const f of this.recordDefs.get(id) ?? []) { const s = this.inlineField(f.type, { shape: id }); if (s) out.push(`record ${id}.${f.name} ${s.kind}`); }
      for (const name of this.classes.keys()) for (const f of this.classDefs.get(name)?.fields ?? []) { const s = this.inlineField(f.type, { cls: name }); if (s) out.push(`class ${name}.${f.name} ${s.kind}`); }
      console.error(`inline scalar fields: ${out.length}${out.length ? "\n  " + out.join("\n  ") : ""}`);
    }
  }

  private readonly recordExts = new Map<string, RecordExt>();
  /** The extension subtype of a record shape that can come from untyped data (null: the record is closed). */
  recordExtOf(id: string): RecordExt | null { return this.recordExts.get(id) ?? null; }
  private structInfo(key: string, names: string[], shift = 0): StructInfo {
    const heap = this.heaps[this.slots.get(key)!]!;
    return { ref: binaryen.getTypeFromHeapType(heap, true), heap, fields: new Map(names.map((n, i) => [n, i + shift])), fieldTypes: [] };
  }

  /** The Wasm value type of an IR type, after build(). */
  value(t: IrType): number {
    switch (t.kind) {
      case "f64": return binaryen.f64;
      case "bool": return binaryen.i32;
      // A module namespace is its token, the module id (as the native backend holds it).
      case "string": case "moduleNs": case "jsval": case "regex": case "date": case "symbol": case "bigint": return binaryen.externref;
      case "void": return binaryen.none;
      case "dyn": return this.engineDyn ? binaryen.externref : binaryen.anyref;
      case "caught": return binaryen.anyref;
      case "array": return this.arrayOf(t.elem).ref;
      case "record": return this.recordOf(t.shapeId).ref;
      case "object": return t.className === this.simdV128 ? binaryen.v128 : this.classOf(t.className).ref;
      case "union": return this.unionOf(t.unionId);
      case "func": return this.closureOf(t).ref;
      case "promise": return this.promiseRef();
      case "generator": return this.generatorRef();
      case "bytes": return this.bytesRef();
      case "map": return this.mapOf(t.key, t.value).ref;
      case "set": return this.mapOf(t.elem, null).ref;
      case "classval": return this.slots.has("classval") ? this.classObjRef() : this.unsupported("type classval");
      default: return this.unsupported(`type ${t.kind}`);
    }
  }

  /** Arrays whose element value type is being computed: a union that reaches itself through its own array arm
   * (`type Nest = Nest[] | null`, a ref1 union whose arm is that array) asks for the array's reference again from inside
   * the element's question, and gets it (the reference does not depend on the element). */
  private readonly arrayElemBusy = new Set<ArrayInfo>();
  arrayOf(elem: IrType): ArrayInfo {
    const info = this.arrays.get(GcTypes.typeKey({ kind: "array", elem }));
    if (!info) return this.unsupported(`array of ${elem.kind}`);
    if (this.arrayElemBusy.has(info)) return info;
    this.arrayElemBusy.add(info);
    try { info.elem = this.value(elem); } finally { this.arrayElemBusy.delete(info); }
    return info;
  }
  mapOf(key: IrType, value: IrType | null): MapInfo {
    const mapKey = value ? GcTypes.typeKey({ kind: "map", key, value }) : GcTypes.typeKey({ kind: "set", elem: key });
    const cached = this.maps.get(mapKey);
    if (cached) return cached;
    const index = this.slots.get(mapKey);
    if (index === undefined) return this.unsupported(`map type ${mapKey}`);
    const heap = this.heaps[index]!, nullable = (slot: string) => binaryen.getTypeFromHeapType(this.heaps[this.slots.get(slot)!]!, true);
    // Cached before its key and value types are asked: a union that reaches itself through a Map arm
    // (`type Tags = Map<string, Tags> | undefined`) asks for this map's reference from inside them.
    const info: MapInfo = { ref: binaryen.getTypeFromHeapType(heap, true), heap, keys: 0, vals: 0, key: 0, val: 0, i8s: nullable("i8s"), i32s: nullable("i32s") };
    this.maps.set(mapKey, info);
    info.keys = this.arrayOf(key).data;
    info.vals = value ? this.arrayOf(value).data : nullable("i32s");
    info.key = this.value(key);
    info.val = value ? this.value(value) : binaryen.i32;
    return info;
  }
  /** The record shape has a struct in this module (some reachable code builds it): a type test against it is only valid then. */
  hasRecord(id: string): boolean { return this.records.has(id); }
  recordOf(id: string): StructInfo { return this.records.get(id) ?? this.unsupported(`record ${id}`); }
  /** AggregateError (wasmgc only): a subtype of the runtime %Error class with one more slot, `errors`. Registered before the type group is built. */
  aggregateErrorSlot(): void {
    if (this.slots.has("aggerr") || !this.classDefs.has("%Error")) return;
    const def = this.classDefs.get("%Error")!;
    this.klass("%Error");
    this.slot("aggerr", (b, i) => {
      // The %Error struct's own layout first (with the identity id when classes carry one), then `errors`.
      b.setStructType(i, [...this.classPrefix(), ...def.fields.map(f => ({ type: this.temp(b, f.type), packedType: binaryen.notPacked, mutable: true })), { type: binaryen.anyref, packedType: binaryen.notPacked, mutable: true }]);
      b.setOpen(i);
      b.setSubType(i, this.htIndex(b, this.slots.get("cls:%Error")!));
    });
  }
  hasAggregateError(): boolean { return this.slots.has("aggerr"); }
  aggregateErrorRef(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("aggerr")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  classOf(name: string): StructInfo { return this.classes.get(name) ?? this.unsupported(`class ${name}`); }
  /** A union's value type: the box struct, the arm's nullable reference (ref1),
   * eqref (refs), or under audit the union's own wrapper struct. */
  unionOf(id: string): number {
    const cached = this.unions.get(id);
    if (cached !== undefined) return cached;
    if (!this.built || !this.unionIds.has(id) || this.unionRep(id).kind === "box") return this.unsupported(`union ${id}`);
    const type = this.unionAudit ? binaryen.getTypeFromHeapType(this.heaps[this.slots.get(`audit:${id}`)!]!, true) : this.unionRepType(id);
    this.unions.set(id, type);
    return type;
  }
  unionArms(id: string): IrType[] { return this.unionDefs.get(id) ?? this.unsupported(`union ${id}`); }
  dynBox(kind: DynBox): { ref: number; heap: number } { return this.dynBoxes.get(kind)!; }
  /** The closure supertype, or null when the program creates no closures. */
  aggRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("agg")!]!, true); }
  pReactRef(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("preact")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  pAggRef(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("pagg")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  pAggEntryRef(): { ref: number; heap: number } { const heap = this.heaps[this.slots.get("paggEntry")!]!; return { ref: binaryen.getTypeFromHeapType(heap, true), heap }; }
  aggEntryRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("aggEntry")!]!, true); }
  /** Pending-rejection list node: { promise, next }. */
  unhandledRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("unhandled")!]!, true); }
  promiseRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("promise")!]!, true); }
  /** Whether the program has the async runtime's types (promiseRef is defined). */
  hasPromises(): boolean { return this.slots.has("promise"); }
  jobRef(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("job")!]!, true); }
  resumeSig(): number { return this.heaps[this.slots.get("resumeSig")!]!; }
  frameOf(fn: string): StructInfo {
    const key = `frame:${fn}`, index = this.slots.get(key);
    if (index === undefined) return this.unsupported(`frame of ${fn}`);
    return { ...this.structInfo(key, []), fields: new Map((this.frameLocals.get(fn) ?? []).map((id, n) => [id, n + 5])) };
  }
  /** Nullable array types backing dynamic arrays (anyref) and object keys (externref). */
  anyArray(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("anyarr")!]!, true); }
  strArray(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("strarr")!]!, true); }
  numBoxArray(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("numboxes")!]!, true); }
  strBoxArray(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("strboxes")!]!, true); }
  i32Array(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("i32s")!]!, true); }
  /** Native dyn: the uniform dynamic-entry signature (self, this, argc, a0..a3, rest) → dyn. */
  dynInvokeSig(): number { return this.heaps[this.slots.get("sig:dyninvoke")!]!; }
  i8Array(): number { return binaryen.getTypeFromHeapType(this.heaps[this.slots.get("i8s")!]!, true); }
  /** (ref null $fnmeta), once any closure type exists. */
  fnMeta(): number | null { const i = this.slots.get("fnmeta"); return i === undefined ? null : binaryen.getTypeFromHeapType(this.heaps[i]!, true); }
  /** The one final closure struct type (ref null $closure), or null when the program creates no closures. */
  closureFinal(): number | null { const i = this.slots.get("closure"); return i === undefined ? null : binaryen.getTypeFromHeapType(this.heaps[i]!, false); }
  fnBase(): number | null { const i = this.slots.get("fnbase"); return i === undefined ? null : binaryen.getTypeFromHeapType(this.heaps[i]!, false); }
  boxOf(t: IrType): number { return this.boxes.get(GcTypes.typeKey(t)) ?? this.unsupported(`box of ${t.kind}`); }
  envOf(fn: string): StructInfo { return this.envs.get(fn) ?? this.unsupported(`closure environment ${fn}`); }
  /** A shared scope environment's struct (see scopeGroups). */
  groupOf(key: string): StructInfo { return this.groupInfos.get(key) ?? this.unsupported(`scope group ${key}`); }
  closureOf(t: IrType & { kind: "func" }): ClosureInfo {
    const info = this.closures.get(GcTypes.typeKey(t));
    if (!info) return this.unsupported("function type");
    info.params = [binaryen.structref, ...t.params.map(p => this.value(p)), ...(GcTypes.hiddenRest(t) ? [this.value({ kind: "dyn" })] : [])];
    info.result = this.value(t.ret);
    return info;
  }
  /** A class struct's field count, the identity id included (the index of a subtype's first extra field). */
  classFieldCount(name: string): number { return this.classOf(name).fields.size + (this.idFields ? 1 : 0) + (this.hasCid ? 1 : 0); }
  classField(name: string, field: string): number {
    const index = this.classOf(name).fields.get(field);
    return index ?? this.unsupported(`field ${name}.${field}`);
  }
  recordField(id: string, field: string): number {
    const index = this.recordOf(id).fields.get(field);
    return index ?? this.unsupported(`record field ${field}`);
  }

  /** Add a function whose type is a rec-group signature from the start.
   * Retyping after creation (BinaryenFunctionSetType) leaves state the
   * optimiser asserts on, so the function is built directly with its heap
   * type. Binaryen interns names permanently: a throwaway function supplies
   * the name pointer without leaking emscripten stack. */
  static addFunctionWithHeapType(m: binaryen.Module, name: string, heap: number, vars: number[], body: number): number {
    m.addFunction(name, binaryen.none, binaryen.none, [], m.nop());
    const namePtr = raw["_BinaryenFunctionGetName"]!(m.getFunction(name));
    m.removeFunction(name);
    const fn = raw["_BinaryenAddFunctionWithHeapType"]!((m as unknown as { ptr: number }).ptr, namePtr, heap, 0, 0, body);
    for (const type of vars) raw["_BinaryenFunctionAddVar"]!(fn, type);
    return fn;
  }
}
