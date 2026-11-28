/* Typed arrays over linear memory.
 *
 * Elements live in the module's own memory, not in GC arrays: v128 loads and
 * stores need linear memory, and Rust (after wasm-merge) and WebGPU uploads
 * see the same bytes with no copy. A typed array is an immutable GC struct
 * $Bytes { base, len, owner, cap }: `base` is the absolute byte address of
 * element 0, `len` the element count, `owner` null for a buffer that owns
 * its storage and the owning $Bytes for a view (subarray, DataView), which
 * keeps the storage alive, and `cap` the byte length of the underlying
 * buffer (`x.buffer.byteLength`; the owner's base is the buffer's start). The element kind is static in the IR, so one
 * struct type serves every kind.
 *
 * Storage comes from a size-class allocator in Wasm (power-of-two blocks,
 * 16-byte header, 16-byte-aligned zeroed payloads). GC structs have no
 * finalizers, so each owner is registered with the host's
 * FinalizationRegistry, which calls the exported `bytesFree`. */
import binaryen from "binaryen";
import type { IrBytesElem, IrExpr, IrType, SrcLoc } from "../../ir/ir.js";
import { FORK_BYTES_ELEMENT_NAME, FORK_BYTES_ELEMENT_SIZE } from "../../ir/ir.js";
import { BYTES_BASE, BYTES_BUFFER, BYTES_CAP, BYTES_LEN, BYTES_OWNER, BYTES_TOKEN, type GcTypes } from "./types.js";

/** Linking: typed-array storage in another module's memory, through its allocator. */
export interface BytesLink {
  memory?: { module: string; name: string; shared?: boolean };
  /** alloc(size) -> 16-byte-aligned pointer; free(pointer). */
  allocator?: { module: string; alloc: string; free: string };
}

export interface BytesContext {
  link?: BytesLink;
  /** math=strict (docs/intrinsics.md): a NaN stored into a Float32Array, a Float64Array or through DataView is the
   * canonical quiet NaN, so the bits a program reads back never depend on whether a NaN was folded at compile time
   * (JavaScript's 0x7ff8000000000000) or computed at run time (0xfff8000000000000 on x86, 0x7ff8... on arm64). */
  canonicalNaN?: boolean;
  /** A fixed memory of this many 64 KiB pages (capability views=fixed): declared at its maximum, it never grows, so
   * byte views handed to JavaScript never detach. Absent: one page, growing on demand to 4 GiB. */
  fixedPages?: number;
  anyConvertExtern(v: number): number;
  /** JS's undefined in an f64 slot (an out-of-range or non-index read). */
  undefNaN(): number;
  /** A genuine number from raw bits: the reserved undefined pattern becomes the canonical NaN. */
  canonF64(v: number): number;
  m: binaryen.Module;
  types: GcTypes;
  defineHelper(name: string, define: () => void): string;
  host(name: string, params: number[], result: number): string;
  temp(type: number): number;
  expr(e: IrExpr): number;
  /** Throw a compiled RangeError whose message is the given string value. */
  rangeError(message: number): number;
  rangeErrorText(message: string): number;
  /** Throw a compiled TypeError with a fixed message. */
  typeErrorText(message: string): number;
  /** Native dyn: a compiled ArrayBuffer is a u8 $Bytes held in a dyn slot. */
  nativeDyn: boolean;
  toInt32(value: number): number;
  /** ToInt32 of an IR number expression as an i32, natively when it is int-valued (no f64 round trip). */
  i32Value?(e: IrExpr): number;
  /** An IR number expression rounded to f32 (exact f32 arithmetic stays in f32). */
  f32Value?(e: IrExpr): number;
  /** An integer-valued IR number expression (an int-shadowed induction local, an int32 term) as its exact i64, else null. */
  int64Value?(e: IrExpr): number | null;
  /** i32 element index of an IR index expression (-1 when not a valid index). */
  indexOf(e: IrExpr): number;
  numToString(value: number): number;
  concat(a: number, b: number): number;
  stringConst(value: string): number;
  externConvertAny(value: number): number;
  /** The number[] runtime (toArray). */
  numberArray(): { arr: number; data: number; states: number };
  /** A dyn value's wasm type, its ToNumber, and whether it is undefined. */
  dynType(): number;
  dynToNumber(v: number): number;
  dynIsUndefined(v: number): number;
  unsupported(what: string, loc?: SrcLoc): never;
}

const { i32, f64 } = binaryen;
/** log2 of the element size: the address shift. */
const SHIFT: Record<IrBytesElem, number> = { u8: 0, u8c: 0, i8: 0, u16: 1, i16: 1, u32: 2, i32: 2, f32: 2, f64: 3, f16: 1 };
/** SCRIPTC_WASMGC_BYTES_GET_CALL=1: typed-array element reads call $bytes.get.<kind> (A/B). */
const BYTES_GET_CALL = typeof process !== "undefined" && !!process.env?.SCRIPTC_WASMGC_BYTES_GET_CALL;
/** Free-list heads, one i32 per size class, live in the first 128 bytes. */
const HEAP_START = 1024;

export function bytesRuntime(ctx: BytesContext) {
  const { m, types, defineHelper } = ctx;
  const canon = (t: "f32" | "f64", v: number): number => {
    if (!ctx.canonicalNaN) return v;
    const vt = t === "f64" ? f64 : binaryen.f32, name = `$canon.nan.${t}`;
    defineHelper(name, () => {
      const x = () => m.local.get(0, vt);
      m.addFunction(name, vt, vt, [], m.select(t === "f64" ? m.f64.ne(x(), x()) : m.f32.ne(x(), x()), t === "f64" ? m.f64.const(NaN) : m.f32.const(NaN), x()));
    });
    return m.call(name, [v], vt);
  };
  const B = () => types.bytesRef();
  /** The struct a new typed array of element kind `elem` is ($Bytes.<elem>, types.ts bytesType). */
  const BE = (elem: IrBytesElem) => binaryen.getHeapType(types.bytesElemRef(elem));
  const heapOf = (t: number) => binaryen.getHeapType(t);
  const base = (b: number) => m.struct.get(BYTES_BASE, b, i32, false);
  const len = (b: number) => m.struct.get(BYTES_LEN, b, i32, false);

  let memoryReady = false;
  const memory = () => {
    if (memoryReady) return;
    memoryReady = true;
    const imported = ctx.link?.memory;
    if (imported) {
      // The owner's memory (one memory: byte pointers mean the same thing on both sides).
      // A shared memory (owner direction: COI is required) carries the same
      // declared maximum; byte views over it never detach.
      (m.setMemory as unknown as (...a: unknown[]) => void)(1, 65536, null, [], !!imported.shared, false, "0");
      m.addMemoryImport("0", imported.module, imported.name);
    } else if (ctx.fixedPages !== undefined) m.setMemory(ctx.fixedPages, ctx.fixedPages, "memory");
    else m.setMemory(1, 65536, "memory");
    if (!sharedHeap) m.addGlobal("$heap.top", i32, true, m.i32.const(HEAP_START));
  };
  const foreignAlloc = ctx.link?.allocator;
  /** A shared link memory without a linked allocator: every instance on the memory (one per worker) runs this
   * allocator, so its state lives in the memory, not in instance globals. The heap top is the word at HEAP_TOP (0
   * until the first allocation: HEAP_START), and a spin lock at HEAP_LOCK (i32 compare-exchange) guards alloc and
   * free. */
  const sharedHeap = !!ctx.link?.memory?.shared && !foreignAlloc;
  const HEAP_TOP = 128, HEAP_LOCK = 132;

  /** alloc(bytes) → zeroed, 16-byte-aligned payload address. */
  const alloc = () => defineHelper("$mem.alloc", () => {
    memory();
    if (foreignAlloc) {
      // The owner's allocator (zeroed here, as the native allocator does).
      const fa = ctx.host(`${foreignAlloc.module}\u0000${foreignAlloc.alloc}`, [i32], i32);
      m.addFunction("$mem.alloc", binaryen.createType([i32]), i32, [i32], m.block(null, [
        m.local.set(1, m.call(fa, [m.local.get(0, i32)], i32)),
        m.memory.fill(m.local.get(1, i32), m.i32.const(0), m.local.get(0, i32)),
        m.local.get(1, i32)], i32));
      return;
    }
    const n = () => m.local.get(0, i32), cls = () => m.local.get(1, i32), block = () => m.local.get(2, i32);
    const top = () => sharedHeap ? m.i32.load(HEAP_TOP, 4, m.i32.const(0)) : m.global.get("$heap.top", i32);
    const setTop = (v: number) => sharedHeap ? m.i32.store(HEAP_TOP, 4, m.i32.const(0), v) : m.global.set("$heap.top", v);
    const unlock = sharedHeap ? [m.i32.atomic.store(HEAP_LOCK, m.i32.const(0), m.i32.const(0))] : [];
    m.addFunction("$mem.alloc", binaryen.createType([i32]), i32, [i32, i32], m.block(null, [
      // class = ceil(log2(n + 16)), at least 32-byte blocks
      m.local.set(1, m.i32.sub(m.i32.const(32), m.i32.clz(m.i32.add(n(), m.i32.const(15))))),
      m.if(m.i32.lt_u(cls(), m.i32.const(5)), m.local.set(1, m.i32.const(5))),
      ...(sharedHeap ? [
        m.loop("$heap.lock", m.br("$heap.lock", m.i32.atomic.rmw.cmpxchg(HEAP_LOCK, m.i32.const(0), m.i32.const(0), m.i32.const(1)))),
        m.if(m.i32.eqz(top()), setTop(m.i32.const(HEAP_START))),
      ] : []),
      m.local.set(2, m.i32.load(0, 4, m.i32.shl(cls(), m.i32.const(2)))),
      m.if(block(),
        m.i32.store(0, 4, m.i32.shl(cls(), m.i32.const(2)), m.i32.load(4, 4, block())),
        m.block(null, [
          m.local.set(2, top()),
          setTop(m.i32.add(top(), m.i32.shl(m.i32.const(1), cls()))),
          m.if(m.i32.gt_u(top(), m.i32.shl(m.memory.size(), m.i32.const(16))),
            m.if(m.i32.eq(m.memory.grow(m.i32.shr_u(m.i32.add(m.i32.sub(top(), m.i32.shl(m.memory.size(), m.i32.const(16))), m.i32.const(65535)), m.i32.const(16))), m.i32.const(-1)),
              m.unreachable())),
        ])),
      m.i32.store(0, 4, block(), cls()),
      ...unlock,
      m.memory.fill(m.i32.add(block(), m.i32.const(16)), m.i32.const(0), n()),
      m.i32.add(block(), m.i32.const(16)),
    ], i32));
  });
  const free = () => defineHelper("$mem.free", () => {
    memory();
    if (foreignAlloc) {
      const ff = ctx.host(`${foreignAlloc.module}\u0000${foreignAlloc.free}`, [i32], binaryen.none);
      m.addFunction("$mem.free", binaryen.createType([i32]), binaryen.none, [], m.call(ff, [m.local.get(0, i32)], binaryen.none));
      m.addFunctionExport("$mem.free", "bytesFree");
      return;
    }
    const block = () => m.i32.sub(m.local.get(0, i32), m.i32.const(16)), head = () => m.i32.shl(m.i32.load(0, 4, block()), m.i32.const(2));
    m.addFunction("$mem.free", binaryen.createType([i32]), binaryen.none, [], m.block(null, [
      ...(sharedHeap ? [m.loop("$heap.lock", m.br("$heap.lock", m.i32.atomic.rmw.cmpxchg(HEAP_LOCK, m.i32.const(0), m.i32.const(0), m.i32.const(1))))] : []),
      m.i32.store(4, 4, block(), m.i32.load(0, 4, head())),
      m.i32.store(0, 4, head(), block()),
      ...(sharedHeap ? [m.i32.atomic.store(HEAP_LOCK, m.i32.const(0), m.i32.const(0))] : []),
    ]));
    m.addFunctionExport("$mem.free", "bytesFree");
  });

  /** $bytes.bufferOf(owner) → the owner's whole-buffer value, or null (the web host's `bytes.bufferOf` signature:
   * externref in and out, so call sites read as before). A field of the owner, not a host table (BYTES_BUFFER). */
  const bufferOf = () => defineHelper("$bytes.bufferOf", () => {
    const E = binaryen.externref;
    m.addFunction("$bytes.bufferOf", binaryen.createType([E]), E, [], ctx.externConvertAny(
      m.struct.get(BYTES_BUFFER, m.ref.cast(ctx.anyConvertExtern(m.local.get(0, E)), B()), binaryen.anyref, false)));
  });
  /** $bytes.keepBuffer(owner, buffer): records the owner's whole-buffer value in its buffer field. */
  const keepBuffer = () => defineHelper("$bytes.keepBuffer", () => {
    const E = binaryen.externref;
    m.addFunction("$bytes.keepBuffer", binaryen.createType([E, E]), binaryen.none, [], m.struct.set(BYTES_BUFFER,
      m.ref.cast(ctx.anyConvertExtern(m.local.get(0, E)), B()), ctx.anyConvertExtern(m.local.get(1, E))));
  });

  /** $bytes.own.<elem>(len, elemShift) → a fresh zeroed owner of that element kind registered for freeing. */
  const own = (elem: IrBytesElem) => defineHelper(`$bytes.own.${elem}`, () => {
    roots();
    // bytes.track -> the owner's finalization token (§7): kept in the owner, so the host sees it dropped with the owner.
    const track = ctx.host("bytes.track", [binaryen.externref, i32], binaryen.externref);
    m.addFunction(`$bytes.own.${elem}`, binaryen.createType([i32, i32]), B(), [i32, B()], m.block(null, [
      m.local.set(2, m.call(alloc(), [m.i32.shl(m.local.get(0, i32), m.local.get(1, i32))], i32)),
      m.local.set(3, m.struct.new([m.local.get(2, i32), m.local.get(0, i32), m.ref.null(binaryen.anyref), m.i32.shl(m.local.get(0, i32), m.local.get(1, i32)), m.ref.null(binaryen.anyref), m.ref.null(binaryen.externref)], BE(elem))),
      m.struct.set(BYTES_TOKEN, m.local.get(3, B()), m.call(track, [ctx.externConvertAny(m.local.get(3, B())), m.local.get(2, i32)], binaryen.externref)),
      m.local.get(3, B()),
    ], B()));
  });
  const roots = () => defineHelper("$bytes.roots", () => {
    free();
    // The fields that only keep things alive: the token (its storage's lifetime) and a view's owner (the storage's). No
    // compiled code needs to read the token, and a program may never read an owner, so a closed-world optimizer
    // (wasm-opt --gto) would remove them as unread fields: the token would be dropped as soon as track answered it and
    // live storage freed on the next turn (native release builds, 10-25). This export reads both, so they stay.
    // (`which` 0: the token; 1: the owner.) The host never needs to call it.
    m.addFunction("$bytes.roots", binaryen.createType([binaryen.anyref, i32]), binaryen.externref, [], m.if(m.local.get(1, i32),
      ctx.externConvertAny(m.struct.get(BYTES_OWNER, m.ref.cast(m.local.get(0, binaryen.anyref), B()), binaryen.anyref, false)),
      m.struct.get(BYTES_TOKEN, m.ref.cast(m.local.get(0, binaryen.anyref), B()), binaryen.externref, false)));
    m.addFunctionExport("$bytes.roots", "bytesRoots");
  });
  const newOwned = (count: number, elem: IrBytesElem) => m.call(own(elem), [count, m.i32.const(SHIFT[elem])], B());

  /** Element address with the bounds check: out-of-range access traps (the IR contract). */
  const addr = (elem: IrBytesElem, b: number, i: number) => m.i32.add(base(b), m.i32.shl(i, m.i32.const(SHIFT[elem])));
  /** `align`: the alignment hint when the address may be unaligned (a DataView's 1), else the element's own. */
  const load = (elem: IrBytesElem, at: number, align?: number): number => {
    const a = (natural: number) => align ?? natural;
    switch (elem) {
      case "u8": case "u8c": return m.f64.convert_u.i32(m.i32.load8_u(0, 1, at));
      case "i8": return m.f64.convert_s.i32(m.i32.load8_s(0, 1, at));
      case "u16": return m.f64.convert_u.i32(m.i32.load16_u(0, a(2), at));
      case "i16": return m.f64.convert_s.i32(m.i32.load16_s(0, a(2), at));
      case "u32": return m.f64.convert_u.i32(m.i32.load(0, a(4), at));
      case "i32": return m.f64.convert_s.i32(m.i32.load(0, a(4), at));
      case "f32": return m.f64.promote(m.f32.load(0, a(4), at));
      case "f64": return ctx.canonF64(m.f64.load(0, a(8), at));
      // Float16Array is an upstream IR kind this backend never receives.
      case "f16": return ctx.unsupported("Float16Array");
    }
  };
  /** Store an f64 with JS's element coercion (ToInt32 wrap, clamp, f32 rounding). */
  const store = (elem: IrBytesElem, at: number, v: () => number, align?: number): number => {
    const a = (natural: number) => align ?? natural;
    switch (elem) {
      case "u8": case "i8": return m.i32.store8(0, 1, at, ctx.toInt32(v()));
      case "u16": case "i16": return m.i32.store16(0, a(2), at, ctx.toInt32(v()));
      case "u32": case "i32": return m.i32.store(0, a(4), at, ctx.toInt32(v()));
      case "u8c": return m.i32.store8(0, 1, at, m.if(m.i32.eqz(m.f64.gt(v(), m.f64.const(0))), m.i32.const(0),
        m.if(m.f64.ge(v(), m.f64.const(255)), m.i32.const(255), m.i32.trunc_u.f64(m.f64.nearest(v())))));
      case "f32": return m.f32.store(0, a(4), at, canon("f32", m.f32.demote(v())));
      case "f64": return m.f64.store(0, a(8), at, canon("f64", v()));
      case "f16": return ctx.unsupported("Float16Array");
    }
  };
  const getter = (elem: IrBytesElem) => defineHelper(`$bytes.get.${elem}`, () => {
    const b = () => m.local.get(0, B()), i = () => m.local.get(1, i32);
    // Out of range or not an index (i is -1 then): JS reads undefined.
    m.addFunction(`$bytes.get.${elem}`, binaryen.createType([B(), i32]), f64, [], m.block(null, [
      m.if(m.i32.ge_u(i(), len(b())), m.return(ctx.undefNaN())),
      load(elem, addr(elem, b(), i())),
    ], f64));
  });
  const setter = (elem: IrBytesElem) => defineHelper(`$bytes.set.${elem}`, () => {
    const b = () => m.local.get(0, B()), i = () => m.local.get(1, i32), v = () => m.local.get(2, f64);
    // An out-of-range write is ignored, as in JS (same branch a trap would cost).
    m.addFunction(`$bytes.set.${elem}`, binaryen.createType([B(), i32, f64]), binaryen.none, [], m.block(null, [
      m.if(m.i32.ge_u(i(), len(b())), m.return()),
      store(elem, addr(elem, b(), i()), v),
    ]));
  });
  /** Relative index (slice/subarray): ToIntegerOrInfinity, negative from the end, clamped to [0, len]. */
  const relative = () => defineHelper("$bytes.rel", () => {
    const x = () => m.local.get(0, f64), n = () => m.f64.convert_u.i32(m.local.get(1, i32)), t = () => m.local.get(2, f64);
    m.addFunction("$bytes.rel", binaryen.createType([f64, i32]), i32, [f64], m.block(null, [
      m.local.set(2, m.f64.trunc(x())),
      m.if(m.f64.ne(t(), t()), m.local.set(2, m.f64.const(0))),
      m.if(m.f64.lt(t(), m.f64.const(0)), m.local.set(2, m.f64.max(m.f64.add(n(), t()), m.f64.const(0))), m.local.set(2, m.f64.min(t(), n()))),
      m.i32.trunc_u.f64(t()),
    ], i32));
  });
  const elemOf = (t: IrType): IrBytesElem => {
    if (t.kind !== "bytes") return ctx.unsupported(`bytes operation on ${t.kind}`);
    memory(); // every typed-array operation touches linear memory
    return t.elem;
  };
  /** Copy `count` elements src[from..] → dst[to..], coercing across kinds. */
  const copyInto = (de: IrBytesElem, dst: number, to: number, se: IrBytesElem, src: number, from: number, count: number): number => {
    // Same kind, or same-width wrapping integers (bit patterns survive ToInt32): a raw memmove.
    const wraps = (e: IrBytesElem) => e !== "f32" && e !== "f64" && e !== "u8c";
    if (de === se || (FORK_BYTES_ELEMENT_SIZE[de] === FORK_BYTES_ELEMENT_SIZE[se] && wraps(de) && wraps(se)))
      return m.memory.copy(m.i32.add(base(m.local.get(dst, B())), m.i32.shl(m.local.get(to, i32), m.i32.const(SHIFT[de]))),
        m.i32.add(base(m.local.get(src, B())), m.i32.shl(m.local.get(from, i32), m.i32.const(SHIFT[se]))),
        m.i32.shl(m.local.get(count, i32), m.i32.const(SHIFT[se])));
    return m.call(convert(se, de), [addr(se, m.local.get(src, B()), m.local.get(from, i32)), addr(de, m.local.get(dst, B()), m.local.get(to, i32)), m.local.get(count, i32)], binaryen.none);
  };
  /** $bytes.conv.<se>.<de>(src, dst, count): element-wise coercing copy
   * between kinds. Overlapping ranges (one buffer viewed as two kinds) read
   * a staged copy of the source, as JS's set clones the source buffer. The
   * vector kernels compute exactly what the scalar loop computes; the scalar
   * loop finishes the last count % lanes elements. */
  const convert = (se: IrBytesElem, de: IrBytesElem) => defineHelper(`$bytes.conv.${se}.${de}`, () => {
    const V = binaryen.v128, src = () => m.local.get(0, i32), dst = () => m.local.get(1, i32), n = () => m.local.get(2, i32);
    const k = () => m.local.get(3, i32), staged = () => m.local.get(4, i32), v = () => m.local.get(5, f64);
    const p = () => m.local.get(9, i32), q = () => m.local.get(10, i32), pend = () => m.local.get(11, i32);
    const ss = SHIFT[se], ds = SHIFT[de], kern = convKernel(se, de, [6, 7, 8]);
    const at = (base: () => number, shift: number) => m.i32.add(base(), m.i32.shl(k(), m.i32.const(shift)));
    const srcBytes = () => m.i32.shl(n(), m.i32.const(ss)), dstBytes = () => m.i32.shl(n(), m.i32.const(ds));
    const vtop = `cvn${seq++}`, done = `cvs${seq++}`, next = `cvsn${seq++}`;
    m.addFunction(`$bytes.conv.${se}.${de}`, binaryen.createType([i32, i32, i32]), binaryen.none, [i32, i32, f64, V, V, V, i32, i32, i32], m.block(null, [
      m.if(m.i32.and(m.i32.lt_u(src(), m.i32.add(dst(), dstBytes())), m.i32.lt_u(dst(), m.i32.add(src(), srcBytes()))), m.block(null, [
        m.local.set(4, m.call(alloc(), [srcBytes()], i32)),
        m.memory.copy(staged(), src(), srcBytes()),
        m.local.set(0, staged())])),
      m.local.set(3, m.i32.const(0)),
      ...(kern ? [
        // k = count rounded down to whole vector steps; p/q walk them.
        m.local.set(3, m.i32.and(n(), m.i32.const(-kern.lanes))),
        m.local.set(9, src()), m.local.set(10, dst()), m.local.set(11, m.i32.add(src(), m.i32.shl(k(), m.i32.const(ss)))),
        m.if(k(), m.loop(vtop, m.block(null, [
          ...kern.body(p, q),
          m.local.set(9, m.i32.add(p(), m.i32.const(kern.lanes << ss))), m.local.set(10, m.i32.add(q(), m.i32.const(kern.lanes << ds))),
          m.br(vtop, m.i32.ne(p(), pend()))])))] : []),
      m.block(done, [m.loop(next, m.block(null, [
        m.br(done, m.i32.ge_u(k(), n())),
        m.local.set(5, load(se, at(src, ss))),
        store(de, at(dst, ds), v),
        m.local.set(3, m.i32.add(k(), m.i32.const(1))), m.br(next)]))]),
      m.if(staged(), m.call(free(), [staged()], binaryen.none)),
    ]));
  });
  /** A vector step converting `lanes` elements from p to q (byte pointers),
   * or null: scalar only for float → integer (ToInt32's modular wrap) and
   * u8c destinations (a rounding clamp). `t` names three v128 scratch locals. */
  const convKernel = (se: IrBytesElem, de: IrBytesElem, t: number[]): { lanes: number; body: (p: () => number, q: () => number) => number[] } | null => {
    if (de === "u8c") return null;
    const V = binaryen.v128, T = (i: number) => m.local.get(t[i]!, V);
    const ld = (p: () => number, off = 0) => m.v128.load(off, 1, p()), st = (q: () => number, off: number, x: number) => m.v128.store(off, 1, q(), x);
    const HI = [8, 9, 10, 11, 12, 13, 14, 15, 8, 9, 10, 11, 12, 13, 14, 15];
    const hiHalf = (x: () => number) => m.i8x16.shuffle(x(), x(), HI);
    if (se === "f32" && de === "f64") return { lanes: 4, body: (p, q) => [m.local.set(t[0]!, ld(p)),
      st(q, 0, m.f64x2.promote_low_f32x4(T(0))), st(q, 16, m.f64x2.promote_low_f32x4(hiHalf(() => T(0))))] };
    if (se === "f64" && de === "f32") return { lanes: 4, body: (p, q) => [
      st(q, 0, m.i8x16.shuffle(m.f32x4.demote_f64x2_zero(ld(p, 0)), m.f32x4.demote_f64x2_zero(ld(p, 16)), [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]))] };
    if (se === "f32" || se === "f64") return null;
    const ssz = FORK_BYTES_ELEMENT_SIZE[se], dsz = FORK_BYTES_ELEMENT_SIZE[de], signed = se === "i8" || se === "i16" || se === "i32", uns = se === "u32";
    // Integer → narrower integer: the low bytes of each lane (ToInt8/16 of an integer).
    if (dsz < ssz) {
      const lanes = 16 / ssz, pick: number[] = [];
      for (let e = 0; e < lanes; e++) for (let b = 0; b < dsz; b++) pick.push(e * ssz + b);
      while (pick.length < 16) pick.push(0);
      return { lanes, body: (p, q) => { const x = m.i8x16.shuffle(ld(p), ld(p), pick);
        return [lanes * dsz === 8 ? m.v128.store64_lane(0, 1, 0, q(), x) : m.v128.store32_lane(0, 1, 0, q(), x)]; } };
    }
    // Widening by the source's signedness (an integer's wrap to a wider kind keeps its sign-extended bits).
    const ext16 = (x: number, high: boolean) => signed ? (high ? m.i16x8.extend_high_i8x16_s(x) : m.i16x8.extend_low_i8x16_s(x)) : (high ? m.i16x8.extend_high_i8x16_u(x) : m.i16x8.extend_low_i8x16_u(x));
    const ext32 = (x: number, high: boolean) => signed ? (high ? m.i32x4.extend_high_i16x8_s(x) : m.i32x4.extend_low_i16x8_s(x)) : (high ? m.i32x4.extend_high_i16x8_u(x) : m.i32x4.extend_low_i16x8_u(x));
    const fin = (x: number) => de === "f32" ? (uns ? m.f32x4.convert_i32x4_u(x) : m.f32x4.convert_i32x4_s(x)) : x;
    if (dsz === ssz) return null; // same-width integers are a memmove (copyInto)
    if (ssz === 1 && dsz === 2) return { lanes: 16, body: (p, q) => [m.local.set(t[0]!, ld(p)), st(q, 0, ext16(T(0), false)), st(q, 16, ext16(T(0), true))] };
    if (ssz === 1 && dsz === 4) return { lanes: 16, body: (p, q) => [m.local.set(t[0]!, ld(p)), m.local.set(t[1]!, ext16(T(0), false)), m.local.set(t[2]!, ext16(T(0), true)),
      st(q, 0, fin(ext32(T(1), false))), st(q, 16, fin(ext32(T(1), true))), st(q, 32, fin(ext32(T(2), false))), st(q, 48, fin(ext32(T(2), true)))] };
    if (ssz === 2 && dsz === 4) return { lanes: 8, body: (p, q) => [m.local.set(t[0]!, ld(p)), st(q, 0, fin(ext32(T(0), false))), st(q, 16, fin(ext32(T(0), true)))] };
    if (ssz === 4 && de === "f32") return { lanes: 4, body: (p, q) => [st(q, 0, fin(ld(p)))] };
    if (de === "f64") {
      // Four source lanes as i32x4, converted two at a time.
      const wide = (p: () => number): number =>
        ssz === 1 ? ext32(ext16(m.v128.load32_zero(0, 1, p()), false), false)
        : ssz === 2 ? (signed ? m.v128.load16x4_s(0, 1, p()) : m.v128.load16x4_u(0, 1, p())) : ld(p);
      const conv = (x: number) => uns ? m.f64x2.convert_low_i32x4_u(x) : m.f64x2.convert_low_i32x4_s(x);
      return { lanes: 4, body: (p, q) => [m.local.set(t[0]!, wide(p)), st(q, 0, conv(T(0))), st(q, 16, conv(hiHalf(() => T(0))))] };
    }
    return null;
  };
  let seq = 0;
  /** $bytes.fill.v128(at, bytes, pattern): repeat a splatted element over
   * [at, at + bytes), bytes a multiple of the element size (2, 4 or 8). A
   * final overlapping store covers the remainder: it starts a multiple of 16
   * bytes before the end, so on an element boundary. */
  const fillV128 = () => defineHelper("$bytes.fill.v128", () => {
    const V = binaryen.v128, p = () => m.local.get(0, i32), n = () => m.local.get(1, i32), pat = () => m.local.get(2, V), end = () => m.local.get(3, i32);
    const room = (bytes: number) => m.i32.lt_u(m.i32.sub(end(), p()), m.i32.const(bytes));
    const adv = (bytes: number) => m.local.set(0, m.i32.add(p(), m.i32.const(bytes)));
    m.addFunction("$bytes.fill.v128", binaryen.createType([i32, i32, V]), binaryen.none, [i32], m.block(null, [
      m.local.set(3, m.i32.add(p(), n())),
      m.if(m.i32.ge_u(n(), m.i32.const(16)), m.block(null, [
        m.block("f64.done", [m.loop("f64.top", m.block(null, [m.br("f64.done", room(64)),
          m.v128.store(0, 1, p(), pat()), m.v128.store(16, 1, p(), pat()), m.v128.store(32, 1, p(), pat()), m.v128.store(48, 1, p(), pat()),
          adv(64), m.br("f64.top")]))]),
        m.block("f16.done", [m.loop("f16.top", m.block(null, [m.br("f16.done", room(16)), m.v128.store(0, 1, p(), pat()), adv(16), m.br("f16.top")]))]),
        m.if(m.i32.ne(p(), end()), m.v128.store(0, 1, m.i32.sub(end(), m.i32.const(16)), pat())),
      ]), m.block(null, [
        m.if(m.i32.and(n(), m.i32.const(8)), m.block(null, [m.i64.store(0, 1, p(), m.i64x2.extract_lane(pat(), 0)), adv(8)])),
        m.if(m.i32.and(n(), m.i32.const(4)), m.block(null, [m.i32.store(0, 1, p(), m.i32x4.extract_lane(pat(), 0)), adv(4)])),
        m.if(m.i32.and(n(), m.i32.const(2)), m.i32.store16(0, 1, p(), m.i32x4.extract_lane(pat(), 0))),
      ])),
    ]));
  });

  const cap = (b: number) => m.struct.get(BYTES_CAP, b, i32, false);
  const ownerField = (b: number) => m.struct.get(BYTES_OWNER, b, binaryen.anyref, false);
  /** The buffer's start: the owner's base (an owner's own base for owners). */
  const bufBase = (b: number) => m.if(m.ref.is_null(ownerField(b)), base(b), base(m.ref.cast(ownerField(b), B())));
  const ownerOf = (b: number) => m.if(m.ref.is_null(ownerField(b)), b, ownerField(b));
  /** Copy one element's bytes (no coercion). */
  const rawCopy = (elem: IrBytesElem, to: number, from: number): number => {
    switch (FORK_BYTES_ELEMENT_SIZE[elem]) {
      case 1: return m.i32.store8(0, 1, to, m.i32.load8_u(0, 1, from));
      case 2: return m.i32.store16(0, 2, to, m.i32.load16_u(0, 2, from));
      case 4: return m.i32.store(0, 4, to, m.i32.load(0, 4, from));
      default: return m.i64.store(0, 8, to, m.i64.load(0, 8, from));
    }
  };
  /* DataView accessors: unaligned little-endian loads/stores, byte-swapped
   * for big-endian (the JS default); a bad offset is Node's RangeError. */
  const bswap16 = (v: number) => m.i32.or(m.i32.shl(m.i32.and(v, m.i32.const(255)), m.i32.const(8)), m.i32.and(m.i32.shr_u(v, m.i32.const(8)), m.i32.const(255)));
  const bswap32 = (v: () => number) => m.i32.or(m.i32.and(m.i32.rotl(v(), m.i32.const(8)), m.i32.const(0x00ff00ff)), m.i32.and(m.i32.rotr(v(), m.i32.const(8)), m.i32.const(0xff00ff00 | 0)));
  const DV: Record<string, { size: number; kind: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32" | "f64" | "u64" | "i64" }> = {
    Uint8: { size: 1, kind: "u8" }, Int8: { size: 1, kind: "i8" }, Uint16: { size: 2, kind: "u16" }, Int16: { size: 2, kind: "i16" },
    Uint32: { size: 4, kind: "u32" }, Int32: { size: 4, kind: "i32" }, Float32: { size: 4, kind: "f32" }, Float64: { size: 8, kind: "f64" },
    BigUint64Number: { size: 8, kind: "u64" }, BigInt64Number: { size: 8, kind: "i64" },
  };
  const dvHelper = (getter: boolean, kind: string, size: number) => defineHelper(`$dv.${getter ? "get" : "set"}.${kind}`, () => {
    // (view, offset f64, [value f64,] littleEndian i32)
    const b = () => m.local.get(0, B()), off = () => m.local.get(1, f64), le = () => m.local.get(getter ? 2 : 3, i32), v = () => m.local.get(2, f64);
    const at = () => m.i32.add(base(b()), m.i32.trunc_u.f64(off()));
    const check = m.if(m.i32.or(m.f64.lt(off(), m.f64.const(0)), m.f64.gt(m.f64.add(off(), m.f64.const(size)), m.f64.convert_u.i32(len(b())))),
      ctx.rangeErrorText("Offset is outside the bounds of the DataView"));
    const t32 = getter ? 3 : 4, t64 = getter ? 4 : 5;
    const w32 = () => m.local.get(t32, i32), w64 = () => m.local.get(t64, binaryen.i64);
    const swap64 = () => m.i64.or(m.i64.shl(m.i64.extend_u(bswap32(() => m.i32.wrap(w64()))), c64(32)),
      m.i64.extend_u(bswap32(() => m.i32.wrap(m.i64.shr_u(w64(), c64(32))))));
    let body: number;
    if (getter) {
      const read32 = (raw: number, swap: (x: () => number) => number) => [m.local.set(t32, raw), m.if(m.i32.eqz(le()), m.local.set(t32, swap(w32)))];
      switch (kind) {
        case "u8": body = m.f64.convert_u.i32(m.i32.load8_u(0, 1, at())); break;
        case "i8": body = m.f64.convert_s.i32(m.i32.load8_s(0, 1, at())); break;
        case "u16": case "i16": body = m.block(null, [...read32(m.i32.load16_u(0, 1, at()), x => bswap16(x())),
          kind === "u16" ? m.f64.convert_u.i32(w32()) : m.f64.convert_s.i32(m.i32.extend16_s(w32()))], f64); break;
        case "u32": case "i32": case "f32": body = m.block(null, [...read32(m.i32.load(0, 1, at()), bswap32),
          kind === "u32" ? m.f64.convert_u.i32(w32()) : kind === "i32" ? m.f64.convert_s.i32(w32()) : m.f64.promote(m.f32.reinterpret(w32()))], f64); break;
        default: body = m.block(null, [m.local.set(t64, m.i64.load(0, 1, at())), m.if(m.i32.eqz(le()), m.local.set(t64, swap64())),
          kind === "f64" ? ctx.canonF64(m.f64.reinterpret(w64())) : kind === "u64" ? m.f64.convert_u.i64(w64()) : m.f64.convert_s.i64(w64())], f64);
      }
      m.addFunction(`$dv.get.${kind}`, binaryen.createType([B(), f64, i32]), f64, [i32, binaryen.i64], m.block(null, [check, body], f64));
    } else {
      switch (kind) {
        case "u8": case "i8": body = m.i32.store8(0, 1, at(), ctx.toInt32(v())); break;
        case "u16": case "i16": body = m.block(null, [m.local.set(t32, ctx.toInt32(v())), m.if(m.i32.eqz(le()), m.local.set(t32, bswap16(w32()))), m.i32.store16(0, 1, at(), w32())]); break;
        case "u32": case "i32": case "f32": body = m.block(null, [m.local.set(t32, kind === "f32" ? m.i32.reinterpret(m.f32.demote(v())) : ctx.toInt32(v())),
          m.if(m.i32.eqz(le()), m.local.set(t32, bswap32(w32))), m.i32.store(0, 1, at(), w32())]); break;
        default: body = m.block(null, [m.local.set(t64, m.i64.reinterpret(v())), m.if(m.i32.eqz(le()), m.local.set(t64, swap64())), m.i64.store(0, 1, at(), w64())]);
      }
      m.addFunction(`$dv.set.${kind}`, binaryen.createType([B(), f64, f64, i32]), binaryen.none, [i32, binaryen.i64], m.block(null, [check, body]));
    }
  });
  const c64 = (v: number) => (m.i64.const as unknown as (x: bigint) => number)(BigInt(v));
  const dataView = (name: string, recv: IrExpr, args: IrExpr[], loc: SrcLoc): number => {
    const getter = name.startsWith("dvGet"), spec = DV[name.slice(5)];
    if (!spec) return ctx.unsupported(`DataView method ${name}`, loc);
    memory();
    const b = ctx.temp(B()), off = ctx.temp(f64);
    // ToIndex on the offset: truncate, NaN → 0.
    const pre = [m.local.set(b, ctx.expr(recv)), m.local.set(off, m.f64.trunc(ctx.expr(args[0]!))),
      m.if(m.f64.ne(m.local.get(off, f64), m.local.get(off, f64)), m.local.set(off, m.f64.const(0)))];
    const leArg = args[getter ? 1 : 2];
    // A byte, or a literal `true` order (every generated record view's), reads and writes inline: no helper call and
    // no byte-order branch. Release builds optimise at -O1, which inlines nothing, so the helper would stay a call at
    // every field read.
    if ((spec.size === 1 || (leArg?.kind === "boolLit" && leArg.value)) && spec.kind !== "u64" && spec.kind !== "i64") {
      // An integer offset (`o` of `for (let o = 0; o < n; o += 4)`, held exactly in its i64 shadow) is its own
      // ToIndex: the bounds test and the address are integer arithmetic, with no truncation, NaN test or f64 compare.
      const exact = ctx.int64Value?.(args[0]!) ?? null;
      if (exact !== null) {
        const o64 = ctx.temp(binaryen.i64), o = () => m.local.get(o64, binaryen.i64);
        const preInt = [m.local.set(b, ctx.expr(recv)), m.local.set(o64, exact)];
        const check = m.if(m.i32.or(m.i64.lt_s(o(), c64(0)), m.i64.gt_s(m.i64.add(o(), c64(spec.size)), m.i64.extend_u(len(m.local.get(b, B()))))),
          ctx.rangeErrorText("Offset is outside the bounds of the DataView"));
        const at = () => m.i32.add(base(m.local.get(b, B())), m.i32.wrap(o()));
        if (getter) return m.block(null, [...preInt, check, load(spec.kind, at(), 1)], f64);
        const v = ctx.temp(f64);
        return m.block(null, [...preInt, m.local.set(v, ctx.expr(args[1]!)), check, store(spec.kind, at(), () => m.local.get(v, f64), 1)]);
      }
      const o = () => m.local.get(off, f64);
      const at = () => m.i32.add(base(m.local.get(b, B())), m.i32.trunc_u.f64(o()));
      const check = m.if(m.i32.or(m.f64.lt(o(), m.f64.const(0)), m.f64.gt(m.f64.add(o(), m.f64.const(spec.size)), m.f64.convert_u.i32(len(m.local.get(b, B()))))),
        ctx.rangeErrorText("Offset is outside the bounds of the DataView"));
      // An offset that is an in-bounds int32 (a record view's `i * 20 + 4` over an integer index held as a double, a
      // method parameter the i32 ABI does not narrow) is its own ToIndex: an integer bounds test and address, with no
      // truncation, NaN test or double compare. Any other double takes the exact path below.
      const raw = ctx.temp(f64), oi = ctx.temp(i32), rawV = () => m.local.get(raw, f64), oiV = () => m.local.get(oi, i32);
      const inBounds = m.i32.and(m.i32.and(
        m.f64.eq(m.f64.convert_s.i32(m.local.tee(oi, m.i32.trunc_s_sat.f64(rawV()), i32)), rawV()),
        m.i32.ge_s(oiV(), m.i32.const(0))),
        m.i32.le_u(m.i32.add(oiV(), m.i32.const(spec.size)), len(m.local.get(b, B()))));
      const fastAt = () => m.i32.add(base(m.local.get(b, B())), oiV());
      const exactPath = [m.local.set(off, m.f64.trunc(rawV())), m.if(m.f64.ne(o(), o()), m.local.set(off, m.f64.const(0))), check];
      const head = [m.local.set(b, ctx.expr(recv)), m.local.set(raw, ctx.expr(args[0]!))];
      if (getter) return m.block(null, [...head, m.if(inBounds, load(spec.kind, fastAt(), 1), m.block(null, [...exactPath, load(spec.kind, at(), 1)], f64))], f64);
      const v = ctx.temp(f64), value = () => m.local.get(v, f64);
      return m.block(null, [...head, m.local.set(v, ctx.expr(args[1]!)),
        m.if(inBounds, store(spec.kind, fastAt(), value, 1), m.block(null, [...exactPath, store(spec.kind, at(), value, 1)]))]);
    }
    if (getter) {
      const le = leArg ? ctx.expr(leArg) : m.i32.const(0);
      return m.block(null, [...pre, m.call(dvHelper(true, spec.kind, spec.size), [m.local.get(b, B()), m.local.get(off, f64), le], f64)], f64);
    }
    const v = ctx.temp(f64);
    return m.block(null, [...pre, m.local.set(v, ctx.expr(args[1]!)),
      m.call(dvHelper(false, spec.kind, spec.size), [m.local.get(b, B()), m.local.get(off, f64), m.local.get(v, f64), leArg ? ctx.expr(leArg) : m.i32.const(0)], binaryen.none)]);
  };

  /** new TypedArray(source) — the forms of the bytesNew contract. */
  /** new TypedArray(n) over an f64 value: ToIndex (NaN is 0, truncate; negative or too large throws Node's RangeError). */
  const fromLength = (value: number, elem: IrBytesElem): number => {
    const n = ctx.temp(f64), t = ctx.temp(f64);
    return m.block(null, [
      m.local.set(n, value),
      m.local.set(t, m.f64.trunc(m.local.get(n, f64))),
      m.if(m.f64.ne(m.local.get(t, f64), m.local.get(t, f64)), m.local.set(t, m.f64.const(0))),
      m.if(m.i32.or(m.f64.lt(m.local.get(t, f64), m.f64.const(0)), m.f64.gt(m.f64.mul(m.local.get(t, f64), m.f64.const(FORK_BYTES_ELEMENT_SIZE[elem])), m.f64.const(2 ** 31 - 16))),
        ctx.rangeError(ctx.concat(ctx.stringConst("Invalid typed array length: "), ctx.numToString(m.local.get(n, f64))))),
      newOwned(m.i32.trunc_u.f64(m.local.get(t, f64)), elem),
    ], B());
  };
  const construct = (source: IrExpr | null, type: IrType, loc: SrcLoc, arrayRt: (elem: IrType) => { arr: number; len(a: number): number; buf(a: number): number; el: number }): number => {
    const elem = elemOf(type);
    if (!source) return newOwned(m.i32.const(0), elem);
    if (source.type.kind === "f64") return fromLength(ctx.expr(source), elem);
    if (source.type.kind === "bytes") {
      const src = ctx.temp(B()), dst = ctx.temp(B()), zero = ctx.temp(i32), count = ctx.temp(i32);
      return m.block(null, [
        m.local.set(src, ctx.expr(source)), m.local.set(count, len(m.local.get(src, B()))), m.local.set(zero, m.i32.const(0)),
        m.local.set(dst, newOwned(m.local.get(count, i32), elem)),
        copyInto(elem, dst, zero, source.type.elem, src, zero, count),
        m.local.get(dst, B()),
      ], B());
    }
    if (source.type.kind === "array" && source.type.elem.kind === "f64") {
      const rt = arrayRt(source.type.elem), a = ctx.temp(rt.arr), dst = ctx.temp(B()), k = ctx.temp(i32), v = ctx.temp(f64);
      const done = `bnew${seq++}`, next = `bnewn${seq++}`;
      return m.block(null, [
        m.local.set(a, ctx.expr(source)), m.local.set(dst, newOwned(rt.len(m.local.get(a, rt.arr)), elem)), m.local.set(k, m.i32.const(0)),
        m.block(done, [m.loop(next, m.block(null, [
          m.br(done, m.i32.ge_u(m.local.get(k, i32), len(m.local.get(dst, B())))),
          m.local.set(v, m.array.get(rt.buf(m.local.get(a, rt.arr)), m.local.get(k, i32), f64, false)),
          store(elem, addr(elem, m.local.get(dst, B()), m.local.get(k, i32)), () => m.local.get(v, f64)),
          m.local.set(k, m.i32.add(m.local.get(k, i32), m.i32.const(1))), m.br(next)]))]),
        m.local.get(dst, B()),
      ], B());
    }
    // new Int32Array(x.buffer): a view over the whole buffer.
    if (source.kind === "bytesIntrinsic" && (source as { method: string }).method === "buffer") {
      const fn = Object.entries(VIEWS).find(([, k]) => k === elem)![0];
      return view(`arrayBuffer.${fn}`, [source], loc)!;
    }
    return ctx.unsupported(`typed array from ${source.type.kind}`, loc);
  };

  /** Native-typed element read for narrowed contexts: i32 for integer kinds
   * (u32 as its bit pattern), f32 for Float32Array; null otherwise. */
  const rawGetter = (elem: IrBytesElem) => defineHelper(`$bytes.raw.${elem}`, () => {
    const b = () => m.local.get(0, B()), i = () => m.local.get(1, i32);
    const at = addr(elem, b(), i());
    const value = elem === "f32" ? m.f32.load(0, 4, at) : elem === "u8" || elem === "u8c" ? m.i32.load8_u(0, 1, at) : elem === "i8" ? m.i32.load8_s(0, 1, at)
      : elem === "u16" ? m.i32.load16_u(0, 2, at) : elem === "i16" ? m.i32.load16_s(0, 2, at) : m.i32.load(0, 4, at);
    m.addFunction(`$bytes.raw.${elem}`, binaryen.createType([B(), i32]), elem === "f32" ? binaryen.f32 : i32, [], m.block(null, [
      m.if(m.i32.ge_u(i(), len(b())), m.unreachable()), value], elem === "f32" ? binaryen.f32 : i32));
  });
  const rawGet = (recv: IrExpr, index: IrExpr): number | null => {
    const elem = elemOf(recv.type);
    if (elem === "f64") return null;
    return m.call(rawGetter(elem), [ctx.expr(recv), ctx.indexOf(index)], elem === "f32" ? binaryen.f32 : i32);
  };
  /* In-bounds accesses (ir/typed-array-bounds.ts proved the index in range): `at` is the exact i32 index, and the
   * access is the plain load or store, with no compare and no undefined arm. */
  /** The element as a number. */
  const getAt = (recv: IrExpr, at: () => number): number => {
    const elem = elemOf(recv.type), b = ctx.temp(B());
    return m.block(null, [m.local.set(b, ctx.expr(recv)), load(elem, addr(elem, m.local.get(b, B()), at()))], f64);
  };
  /** The element's raw form, as rawGet: f32, or an integer kind's i32 (null for f64). */
  const rawAt = (recv: IrExpr, at: () => number): number | null => {
    const elem = elemOf(recv.type);
    if (elem === "f64") return null;
    const b = ctx.temp(B());
    const where = () => addr(elem, m.local.get(b, B()), at());
    const value = elem === "f32" ? m.f32.load(0, 4, where()) : elem === "u8" || elem === "u8c" ? m.i32.load8_u(0, 1, where()) : elem === "i8" ? m.i32.load8_s(0, 1, where())
      : elem === "u16" ? m.i32.load16_u(0, 2, where()) : elem === "i16" ? m.i32.load16_s(0, 2, where()) : m.i32.load(0, 4, where());
    return m.block(null, [m.local.set(b, ctx.expr(recv)), value], elem === "f32" ? binaryen.f32 : i32);
  };
  /** ToInt32 of an integer-kind element read (any index): the element's
   * bits as i32, or 0 out of range (ToInt32(undefined)). `index` is an i32
   * expression, -1 (or any value >= length unsigned) for a non-index. */
  const int32Getter = (elem: IrBytesElem) => defineHelper(`$bytes.int32.${elem}`, () => {
    const b = () => m.local.get(0, B()), i = () => m.local.get(1, i32);
    const at = addr(elem, b(), i());
    const value = elem === "u8" || elem === "u8c" ? m.i32.load8_u(0, 1, at) : elem === "i8" ? m.i32.load8_s(0, 1, at)
      : elem === "u16" ? m.i32.load16_u(0, 2, at) : elem === "i16" ? m.i32.load16_s(0, 2, at) : m.i32.load(0, 4, at);
    m.addFunction(`$bytes.int32.${elem}`, binaryen.createType([B(), i32]), i32, [], m.block(null, [
      m.if(m.i32.ge_u(i(), len(b())), m.return(m.i32.const(0))), value], i32));
  });
  const int32Get = (recv: IrExpr, index: () => number): number | null => {
    const elem = elemOf(recv.type);
    if (elem === "f32" || elem === "f64") return null;
    const r = ctx.expr(recv);
    return m.call(int32Getter(elem), [r, index()], i32);
  };
  // Inline at the site: the helper's bounds check, load and canonicalization
  // exceed wasm-opt's flexible inline size, and the call dominated numeric
  // kernels (the BVH walkers). SCRIPTC_WASMGC_BYTES_GET_CALL=1 keeps the call (A/B).
  const get = (recv: IrExpr, index: IrExpr) => {
    const elem = elemOf(recv.type);
    if (BYTES_GET_CALL) return m.call(getter(elem), [ctx.expr(recv), ctx.indexOf(index)], f64);
    const b = ctx.temp(B()), i = ctx.temp(i32);
    return m.block(null, [m.local.set(b, ctx.expr(recv)), m.local.set(i, ctx.indexOf(index)),
      m.if(m.i32.ge_u(m.local.get(i, i32), len(m.local.get(b, B()))), ctx.undefNaN(), load(elem, addr(elem, m.local.get(b, B()), m.local.get(i, i32))))], f64);
  };
  // Inline at the site, as `get`: through the helper, a release at -O1 (no wasm-opt inlining) paid two calls per store
  // ($bytes.set.<kind>, then $toInt32 on an f64 the site had just widened from an i32). An integer kind stores the value's
  // ToInt32 computed natively (an int-valued expression never round-trips through f64); f32 stores the f32 rounding.
  const set = (recv: IrExpr, index: IrExpr, value: IrExpr, provenAt?: () => number) => {
    // Receiver, index, then value: JS evaluation order; an out-of-range write is ignored, as in JS. `provenAt`: the exact
    // i32 index of a write proved in bounds (getAt), stored with no compare.
    const elem = elemOf(recv.type);
    const b = ctx.temp(B()), i = ctx.temp(i32);
    const head = [m.local.set(b, ctx.expr(recv)), m.local.set(i, provenAt ? provenAt() : ctx.indexOf(index))];
    if (BYTES_GET_CALL || elem === "u8c" || !ctx.i32Value || !ctx.f32Value) {
      return m.block(null, [...head, m.call(setter(elem), [m.local.get(b, B()), m.local.get(i, i32), ctx.expr(value)], binaryen.none)]);
    }
    const vt = elem === "f64" ? f64 : elem === "f32" ? binaryen.f32 : i32;
    const v = ctx.temp(vt);
    const computed = elem === "f64" ? canon("f64", ctx.expr(value)) : elem === "f32" ? canon("f32", ctx.f32Value(value)) : ctx.i32Value(value);
    const at = addr(elem, m.local.get(b, B()), m.local.get(i, i32)), got = m.local.get(v, vt);
    const write = elem === "u8" || elem === "i8" ? m.i32.store8(0, 1, at, got) : elem === "u16" || elem === "i16" ? m.i32.store16(0, 2, at, got)
      : elem === "u32" || elem === "i32" ? m.i32.store(0, 4, at, got) : elem === "f32" ? m.f32.store(0, 4, at, got) : m.f64.store(0, 8, at, got);
    return m.block(null, [...head, m.local.set(v, computed), provenAt ? write : m.if(m.i32.lt_u(m.local.get(i, i32), len(m.local.get(b, B()))), write)]);
  };

  /** bytesIntrinsic methods (typed-array surface; DataView pending). */
  /** new DataView(buffer, byteOffset?, byteLength?) over a compiled buffer value, with Node's RangeErrors. */
  const dataViewNew = (bufValue: number, args: IrExpr[]): number => {

    const b = ctx.temp(B()), o = ctx.temp(f64), l = ctx.temp(f64), c = () => m.f64.convert_u.i32(cap(m.local.get(b, B())));
    const toIndex = (target: number, arg: IrExpr) => [m.local.set(target, m.f64.trunc(ctx.expr(arg))), m.if(m.f64.ne(m.local.get(target, f64), m.local.get(target, f64)), m.local.set(target, m.f64.const(0)))];
    return m.block(null, [
      m.local.set(b, bufValue),
      ...(args[0] ? toIndex(o, args[0]) : [m.local.set(o, m.f64.const(0))]),
      m.if(m.i32.or(m.f64.lt(m.local.get(o, f64), m.f64.const(0)), m.f64.gt(m.local.get(o, f64), c())),
        ctx.rangeError(ctx.concat(ctx.concat(ctx.stringConst("Start offset "), ctx.numToString(m.local.get(o, f64))), ctx.stringConst(" is outside the bounds of the buffer")))),
      ...(args[1] ? toIndex(l, args[1]) : [m.local.set(l, m.f64.sub(c(), m.local.get(o, f64)))]),
      m.if(m.i32.or(m.f64.lt(m.local.get(l, f64), m.f64.const(0)), m.f64.gt(m.f64.add(m.local.get(o, f64), m.local.get(l, f64)), c())),
        ctx.rangeError(ctx.concat(ctx.stringConst("Invalid DataView length "), ctx.numToString(m.local.get(l, f64))))),
      m.struct.new([m.i32.add(bufBase(m.local.get(b, B())), m.i32.trunc_u.f64(m.local.get(o, f64))), m.i32.trunc_u.f64(m.local.get(l, f64)), ownerOf(m.local.get(b, B())), cap(m.local.get(b, B())), m.ref.null(binaryen.anyref), m.ref.null(binaryen.externref)], BE("u8")),
    ], B());
  };
  const method = (name: string, recv: IrExpr, args: IrExpr[], loc: SrcLoc): number => {
    const elem = elemOf(recv.type);
    switch (name) {
      case "length": return m.f64.convert_u.i32(len(ctx.expr(recv)));
      case "byteLength": return m.f64.convert_u.i32(m.i32.shl(len(ctx.expr(recv)), m.i32.const(SHIFT[elem])));
      case "byteOffset": {
        const b = ctx.temp(B());
        return m.block(null, [m.local.set(b, ctx.expr(recv)), m.f64.convert_u.i32(m.if(m.ref.is_null(m.struct.get(BYTES_OWNER, m.local.get(b, B()), binaryen.anyref, false)), m.i32.const(0),
          m.i32.sub(base(m.local.get(b, B())), base(m.ref.cast(m.struct.get(BYTES_OWNER, m.local.get(b, B()), binaryen.anyref, false), B())))))], f64);
      }
      case "get": return get(recv, args[0]!);
      case "slice": case "subarray": {
        const b = ctx.temp(B()), start = ctx.temp(i32), end = ctx.temp(i32), count = ctx.temp(i32);
        const rel = (arg: IrExpr | undefined, fallback: number) => arg ? m.call(relative(), [ctx.expr(arg), len(m.local.get(b, B()))], i32) : fallback;
        const parts = [m.local.set(b, ctx.expr(recv)), m.local.set(start, rel(args[0], m.i32.const(0))), m.local.set(end, rel(args[1], len(m.local.get(b, B())))),
          m.local.set(count, m.select(m.i32.gt_u(m.local.get(end, i32), m.local.get(start, i32)), m.i32.sub(m.local.get(end, i32), m.local.get(start, i32)), m.i32.const(0)))];
        if (name === "subarray") {
          const owner = m.if(m.ref.is_null(m.struct.get(BYTES_OWNER, m.local.get(b, B()), binaryen.anyref, false)), m.local.get(b, B()), m.struct.get(BYTES_OWNER, m.local.get(b, B()), binaryen.anyref, false));
          return m.block(null, [...parts, m.struct.new([addr(elem, m.local.get(b, B()), m.local.get(start, i32)), m.local.get(count, i32), owner, m.struct.get(BYTES_CAP, m.local.get(b, B()), i32, false), m.ref.null(binaryen.anyref), m.ref.null(binaryen.externref)], BE(elem))], B());
        }
        const dst = ctx.temp(B()), zero = ctx.temp(i32);
        return m.block(null, [...parts, m.local.set(dst, newOwned(m.local.get(count, i32), elem)), m.local.set(zero, m.i32.const(0)),
          copyInto(elem, dst, zero, elem, b, start, count), m.local.get(dst, B())], B());
      }
      case "setFrom": {
        const dst = ctx.temp(B()), src = ctx.temp(B()), off = ctx.temp(i32), zero = ctx.temp(i32), count = ctx.temp(i32), o = ctx.temp(f64);
        const se = elemOf(args[0]!.type);
        return m.block(null, [
          m.local.set(dst, ctx.expr(recv)), m.local.set(src, ctx.expr(args[0]!)),
          m.local.set(o, args[1] ? m.f64.trunc(ctx.expr(args[1])) : m.f64.const(0)),
          m.if(m.f64.ne(m.local.get(o, f64), m.local.get(o, f64)), m.local.set(o, m.f64.const(0))),
          m.local.set(count, len(m.local.get(src, B()))),
          m.if(m.i32.or(m.f64.lt(m.local.get(o, f64), m.f64.const(0)),
            m.f64.gt(m.f64.add(m.local.get(o, f64), m.f64.convert_u.i32(m.local.get(count, i32))), m.f64.convert_u.i32(len(m.local.get(dst, B()))))),
            ctx.rangeErrorText("offset is out of bounds")),
          m.local.set(off, m.i32.trunc_u.f64(m.local.get(o, f64))), m.local.set(zero, m.i32.const(0)),
          copyInto(elem, dst, off, se, src, zero, count),
        ]);
      }
      case "buffer": {
        // x.buffer: a u8 view of the whole underlying buffer, one per storage owner
        // (kept in the owner's buffer field), so every view of that storage answers the same buffer.
        const b = ctx.temp(B()), o = ctx.temp(binaryen.anyref), c = ctx.temp(binaryen.externref), nb = ctx.temp(B()), E = binaryen.externref;
        const cached = bufferOf(), keep = keepBuffer();
        return m.block(null, [m.local.set(b, ctx.expr(recv)), m.local.set(o, ownerOf(m.local.get(b, B()))),
          m.local.set(c, m.call(cached, [ctx.externConvertAny(m.local.get(o, binaryen.anyref))], E)),
          m.if(m.ref.is_null(m.local.get(c, E)), m.block(null, [
            m.local.set(nb, m.struct.new([bufBase(m.local.get(b, B())), cap(m.local.get(b, B())), m.local.get(o, binaryen.anyref), cap(m.local.get(b, B())), m.ref.null(binaryen.anyref), m.ref.null(binaryen.externref)], BE("u8"))),
            m.call(keep, [ctx.externConvertAny(m.local.get(o, binaryen.anyref)), ctx.externConvertAny(m.local.get(nb, B()))], binaryen.none),
            m.local.get(nb, B())], B()),
            m.ref.cast(ctx.anyConvertExtern(m.local.get(c, E)), B()))], B());
      }
      case "copyWithin": {
        const b = ctx.temp(B()), to = ctx.temp(i32), from = ctx.temp(i32), end = ctx.temp(i32), count = ctx.temp(i32);
        const rel = (arg: IrExpr | undefined, fallback: () => number) => arg ? m.call(relative(), [ctx.expr(arg), len(m.local.get(b, B()))], i32) : fallback();
        return m.block(null, [
          m.local.set(b, ctx.expr(recv)),
          m.local.set(to, rel(args[0], () => m.i32.const(0))), m.local.set(from, rel(args[1], () => m.i32.const(0))), m.local.set(end, rel(args[2], () => len(m.local.get(b, B())))),
          m.local.set(count, m.i32.sub(m.local.get(end, i32), m.local.get(from, i32))),
          m.if(m.i32.gt_s(m.local.get(count, i32), m.i32.sub(len(m.local.get(b, B())), m.local.get(to, i32))), m.local.set(count, m.i32.sub(len(m.local.get(b, B())), m.local.get(to, i32)))),
          m.if(m.i32.gt_s(m.local.get(count, i32), m.i32.const(0)), m.memory.copy(addr(elem, m.local.get(b, B()), m.local.get(to, i32)), addr(elem, m.local.get(b, B()), m.local.get(from, i32)),
            m.i32.shl(m.local.get(count, i32), m.i32.const(SHIFT[elem])))),
          m.local.get(b, B())], B());
      }
      case "toReversed": case "with": {
        const b = ctx.temp(B()), dst = ctx.temp(B()), zero = ctx.temp(i32), n = ctx.temp(i32);
        const parts = [m.local.set(b, ctx.expr(recv)), m.local.set(n, len(m.local.get(b, B()))), m.local.set(dst, newOwned(m.local.get(n, i32), elem)), m.local.set(zero, m.i32.const(0))];
        if (name === "with") {
          // Relative index; out of range is Node's RangeError, then copy and replace.
          const t = ctx.temp(f64), v = ctx.temp(f64);
          return m.block(null, [...parts,
            m.local.set(t, m.f64.trunc(ctx.expr(args[0]!))), m.if(m.f64.ne(m.local.get(t, f64), m.local.get(t, f64)), m.local.set(t, m.f64.const(0))),
            m.local.set(v, ctx.expr(args[1]!)),
            m.if(m.f64.lt(m.local.get(t, f64), m.f64.const(0)), m.local.set(t, m.f64.add(m.local.get(t, f64), m.f64.convert_u.i32(m.local.get(n, i32))))),
            m.if(m.i32.or(m.f64.lt(m.local.get(t, f64), m.f64.const(0)), m.f64.ge(m.local.get(t, f64), m.f64.convert_u.i32(m.local.get(n, i32)))), ctx.rangeErrorText("Invalid typed array index")),
            copyInto(elem, dst, zero, elem, b, zero, n),
            store(elem, addr(elem, m.local.get(dst, B()), m.i32.trunc_u.f64(m.local.get(t, f64))), () => m.local.get(v, f64)),
            m.local.get(dst, B())], B());
        }
        const k = ctx.temp(i32), done = `brev${seq++}`, next = `brevn${seq++}`;
        return m.block(null, [...parts, m.local.set(k, m.i32.const(0)), m.block(done, [m.loop(next, m.block(null, [
          m.br(done, m.i32.ge_u(m.local.get(k, i32), m.local.get(n, i32))),
          rawCopy(elem, addr(elem, m.local.get(dst, B()), m.local.get(k, i32)), addr(elem, m.local.get(b, B()), m.i32.sub(m.i32.sub(m.local.get(n, i32), m.i32.const(1)), m.local.get(k, i32)))),
          m.local.set(k, m.i32.add(m.local.get(k, i32), m.i32.const(1))), m.br(next)]))]), m.local.get(dst, B())], B());
      }
      case "toArray": {
        const na = ctx.numberArray(), b = ctx.temp(B()), data = ctx.temp(na.data), k = ctx.temp(i32), done = `barr${seq++}`, next = `barrn${seq++}`;
        return m.block(null, [m.local.set(b, ctx.expr(recv)), m.local.set(data, m.array.new_default(heapOf(na.data), len(m.local.get(b, B())))), m.local.set(k, m.i32.const(0)),
          m.block(done, [m.loop(next, m.block(null, [
            m.br(done, m.i32.ge_u(m.local.get(k, i32), len(m.local.get(b, B())))),
            m.array.set(m.local.get(data, na.data), m.local.get(k, i32), load(elem, addr(elem, m.local.get(b, B()), m.local.get(k, i32)))),
            m.local.set(k, m.i32.add(m.local.get(k, i32), m.i32.const(1))), m.br(next)]))]),
          m.struct.new([len(m.local.get(b, B())), m.local.get(data, na.data), m.ref.null(na.states)], heapOf(na.arr))], na.arr);
      }
      case "fillElem": case "fillNum": {
        // Value coerced once per element kind; indices clamp like slice. The
        // element's bytes are computed once and repeated: memory.fill for
        // 1-byte kinds, 16-byte vector stores of the splatted element otherwise.
        const b = ctx.temp(B()), v = ctx.temp(f64), k = ctx.temp(i32), end = ctx.temp(i32);
        const rel = (arg: IrExpr | undefined, fallback: () => number) => arg ? m.call(relative(), [ctx.expr(arg), len(m.local.get(b, B()))], i32) : fallback();
        const at = addr(elem, m.local.get(b, B()), m.local.get(k, i32)), bytes = m.i32.shl(m.i32.sub(m.local.get(end, i32), m.local.get(k, i32)), m.i32.const(SHIFT[elem]));
        const vv = () => m.local.get(v, f64);
        const pattern = FORK_BYTES_ELEMENT_SIZE[elem] === 1 ? null
          : elem === "f32" ? m.f32x4.splat(m.f32.demote(vv())) : elem === "f64" ? m.f64x2.splat(vv())
          : elem === "u16" || elem === "i16" ? m.i16x8.splat(ctx.toInt32(vv())) : m.i32x4.splat(ctx.toInt32(vv()));
        const byte = elem === "u8c" ? m.if(m.i32.eqz(m.f64.gt(vv(), m.f64.const(0))), m.i32.const(0),
          m.if(m.f64.ge(vv(), m.f64.const(255)), m.i32.const(255), m.i32.trunc_u.f64(m.f64.nearest(vv())))) : ctx.toInt32(vv());
        return m.block(null, [m.local.set(b, ctx.expr(recv)), m.local.set(v, ctx.expr(args[0]!)),
          m.local.set(k, rel(args[1], () => m.i32.const(0))), m.local.set(end, rel(args[2], () => len(m.local.get(b, B())))),
          m.if(m.i32.lt_s(m.local.get(k, i32), m.local.get(end, i32)),
            pattern === null ? m.memory.fill(at, byte, bytes) : m.call(fillV128(), [at, bytes, pattern], binaryen.none)),
          m.local.get(b, B())], B());
      }
      case "indexOfNum": case "includesNum": case "lastIndexOfNum": {
        // u8 receivers: the value wraps & 0xFF; byteOffset relative, Node's defaults.
        const b = ctx.temp(B()), v = ctx.temp(i32), k = ctx.temp(i32), found = ctx.temp(i32), o = ctx.temp(f64), n = () => len(m.local.get(b, B()));
        const back = name === "lastIndexOfNum", done = `bfind${seq++}`, next = `bfindn${seq++}`;
        const start: number[] = !args[1]
          ? [m.local.set(k, back ? m.i32.sub(n(), m.i32.const(1)) : m.i32.const(0))]
          : [m.local.set(o, m.f64.trunc(ctx.expr(args[1]))),
             m.if(m.f64.ne(m.local.get(o, f64), m.local.get(o, f64)), m.local.set(o, back ? m.f64.convert_u.i32(n()) : m.f64.const(0))),
             m.if(m.f64.lt(m.local.get(o, f64), m.f64.const(0)), m.local.set(o, m.f64.add(m.local.get(o, f64), m.f64.convert_u.i32(n())))),
             back ? m.local.set(k, m.if(m.f64.lt(m.local.get(o, f64), m.f64.const(0)), m.i32.const(-1),
                      m.if(m.f64.ge(m.local.get(o, f64), m.f64.convert_u.i32(n())), m.i32.sub(n(), m.i32.const(1)), m.i32.trunc_u.f64(m.local.get(o, f64)))))
                  : m.local.set(k, m.if(m.f64.lt(m.local.get(o, f64), m.f64.const(0)), m.i32.const(0),
                      m.if(m.f64.ge(m.local.get(o, f64), m.f64.convert_u.i32(n())), n(), m.i32.trunc_u.f64(m.local.get(o, f64)))))];
        const body = m.block(null, [m.local.set(b, ctx.expr(recv)), m.local.set(v, m.i32.and(ctx.toInt32(ctx.expr(args[0]!)), m.i32.const(255))), ...start,
          m.local.set(found, m.i32.const(-1)),
          m.block(done, [m.loop(next, m.block(null, [
            m.br(done, back ? m.i32.lt_s(m.local.get(k, i32), m.i32.const(0)) : m.i32.ge_s(m.local.get(k, i32), n())),
            m.if(m.i32.eq(m.i32.load8_u(0, 1, m.i32.add(base(m.local.get(b, B())), m.local.get(k, i32))), m.local.get(v, i32)), m.block(null, [m.local.set(found, m.local.get(k, i32)), m.br(done)])),
            m.local.set(k, back ? m.i32.sub(m.local.get(k, i32), m.i32.const(1)) : m.i32.add(m.local.get(k, i32), m.i32.const(1))), m.br(next)]))]),
        ]);
        return name === "includesNum" ? m.block(null, [body, m.i32.ge_s(m.local.get(found, i32), m.i32.const(0))], i32)
          : m.block(null, [body, m.f64.convert_s.i32(m.local.get(found, i32))], f64);
      }
      case "dataViewNew": return dataViewNew(ctx.expr(recv), args);
      case "join": {
        // Elements print as numbers (Number.prototype.toString), joined by the separator (default ",").
        const b = ctx.temp(B()), k = ctx.temp(i32), out = ctx.temp(binaryen.externref), sep = ctx.temp(binaryen.externref);
        const done = `bjoin${seq++}`, next = `bjoinn${seq++}`;
        return m.block(null, [
          m.local.set(b, ctx.expr(recv)), m.local.set(sep, args[0] ? ctx.expr(args[0]) : ctx.stringConst(",")),
          m.local.set(out, ctx.stringConst("")), m.local.set(k, m.i32.const(0)),
          m.block(done, [m.loop(next, m.block(null, [
            m.br(done, m.i32.ge_u(m.local.get(k, i32), len(m.local.get(b, B())))),
            m.if(m.local.get(k, i32), m.local.set(out, ctx.concat(m.local.get(out, binaryen.externref), m.local.get(sep, binaryen.externref)))),
            m.local.set(out, ctx.concat(m.local.get(out, binaryen.externref), ctx.numToString(load(elem, addr(elem, m.local.get(b, B()), m.local.get(k, i32)))))),
            m.local.set(k, m.i32.add(m.local.get(k, i32), m.i32.const(1))), m.br(next)]))]),
          m.local.get(out, binaryen.externref)], binaryen.externref);
      }
      default:
        if (name.startsWith("dvGet") || name.startsWith("dvSet")) return dataView(name, recv, args, loc);
        return ctx.unsupported(`typed array method ${name}`, loc);
    }
  };

  /** console.log of a typed array: the host formats a copy of the elements. */
  const print = (value: number, t: IrType): number => {
    const elem = elemOf(t), b = ctx.temp(B());
    memory();
    return m.block(null, [m.local.set(b, value),
      m.call(ctx.host("print.bytes", [i32, i32, i32], binaryen.none), [m.i32.const(Object.keys(FORK_BYTES_ELEMENT_NAME).indexOf(elem)), base(m.local.get(b, B())), len(m.local.get(b, B()))], binaryen.none)]);
  };

  /** SIMD: byte address of `count` elements at element `index`; out of range traps. */
  const vectorAddress = (recv: IrExpr, index: IrExpr, count: number): number => {
    const elem = elemOf(recv.type), b = ctx.temp(B()), i = ctx.temp(i32);
    return m.block(null, [
      m.local.set(b, ctx.expr(recv)), m.local.set(i, ctx.indexOf(index)),
      m.if(m.i32.or(m.i32.lt_u(len(m.local.get(b, B())), m.i32.const(count)), m.i32.gt_u(m.local.get(i, i32), m.i32.sub(len(m.local.get(b, B())), m.i32.const(count)))), m.unreachable()),
      addr(elem, m.local.get(b, B()), m.local.get(i, i32)),
    ], i32);
  };

  /* `new DataView(buf, …)` / `new Float32Array(buf, …)` arrive as dynamic
   * arrayBuffer.view* calls; they lower when the buffer is statically a
   * typed array's `.buffer` and the offsets are numbers or omitted. */
  const VIEWS: Record<string, IrBytesElem | "dv"> = {
    viewDV: "dv", viewU8: "u8", viewU8C: "u8c", viewI8: "i8", viewU16: "u16", viewI16: "i16", viewU32: "u32", viewI32: "i32", viewF32: "f32", viewF64: "f64",
  };
  const peel = (e: IrExpr): IrExpr | null => e.kind === "dynFrom" ? (e as IrExpr & { value: IrExpr }).value : null;
  const view = (fn: string, args: IrExpr[], loc: SrcLoc, wholeBuffer?: () => number): number | null => {
    const kind = VIEWS[fn.replace("arrayBuffer.", "")];
    if (!kind) return null;
    // `x.buffer` (typed dyn): the receiver's bufBase/cap already describe the whole buffer.
    const a0 = (args[0] ?? { kind: "unitLit", type: { kind: "dyn" } }) as IrExpr & { method?: string; receiver?: IrExpr };
    // `new ArrayBuffer(n)` viewed directly: fresh zeroed bytes owned by the view.
    const fresh = a0.kind === "libCall" && (a0 as IrExpr & { fn: string }).fn === "arrayBuffer.new" ? peel((a0 as IrExpr & { args: IrExpr[] }).args[0]!) : null;
    const buf = fresh && fresh.type.kind === "f64" ? ({ kind: "bytesNew", source: fresh, type: { kind: "bytes", elem: "u8" }, loc } as unknown as IrExpr)
      : a0.kind === "bytesIntrinsic" && a0.method === "buffer" ? a0.receiver! : peel(a0);
    // A compiled ArrayBuffer VALUE in a native dyn slot (`const b = new
    // ArrayBuffer(n)`, a stored `x.buffer`): a $Bytes at run time; a page
    // ArrayBuffer cannot be aliased by compiled storage — TypeError.
    const dynBuffer = wholeBuffer === undefined && (!buf || buf.type.kind !== "bytes") && ctx.nativeDyn && a0.type.kind === "dyn";
    if (wholeBuffer === undefined && !dynBuffer && (!buf || buf.type.kind !== "bytes")) return ctx.unsupported(`${fn} over a dynamic buffer`, loc);
    const bufValue = (): number => {
      if (wholeBuffer) return wholeBuffer();
      if (!dynBuffer) return ctx.expr(buf!);
      const x = ctx.temp(binaryen.anyref);
      return m.block(null, [m.local.set(x, ctx.expr(a0)),
        m.if(m.ref.test(m.local.get(x, binaryen.anyref), heapOf(B())), m.ref.cast(m.local.get(x, binaryen.anyref), B()),
          ctx.typeErrorText("a compiled typed array cannot view a page ArrayBuffer; copy it first (buffer.slice(0))"))], B());
    };
    // An untyped offset or length (parsed glTF JSON, gltf-interleave.ts resolveStrided) stays dyn: ToNumber at run
    // time, and an undefined length is an omitted one. Typed arrays only; DataView keeps static forms.
    const untyped = (e: IrExpr | undefined): IrExpr | undefined => e && !peel(e) && e.type.kind === "dyn" && kind !== "dv" ? e : undefined;
    const dynOff = untyped(args[1]), dynLen = untyped(args[2]);
    const opt = (e: IrExpr | undefined): IrExpr | undefined => {
      if (!e || e === dynOff || e === dynLen) return undefined;
      const v = peel(e);
      if (!v) return ctx.unsupported(`${fn} with a dynamic offset`, loc);
      if (v.kind === "unitLit") return undefined;
      if (v.type.kind !== "f64") return ctx.unsupported(`${fn} offset of type ${v.type.kind}`, loc);
      return v;
    };
    const off = opt(args[1]), length = opt(args[2]);
    if (kind === "dv" && dynBuffer) return dataViewNew(bufValue(), [off ?? ({ kind: "numLit", value: 0, type: { kind: "f64" }, loc } as IrExpr), ...(length ? [length] : [])]);
    if (kind === "dv") return method("dataViewNew", buf!, [off, length].filter((x): x is IrExpr => x !== undefined).length === 2 || !length ? [off, length].filter((x): x is IrExpr => x !== undefined) : [off ?? ({ kind: "numLit", value: 0, type: { kind: "f64" }, loc } as IrExpr), length], loc);
    // InitializeTypedArrayFromArrayBuffer, with V8's messages.
    memory();
    const size = FORK_BYTES_ELEMENT_SIZE[kind], typeName = FORK_BYTES_ELEMENT_NAME[kind];
    const b = ctx.temp(B()), o = ctx.temp(f64), n = ctx.temp(f64), bytesLen = ctx.temp(f64), c = () => m.f64.convert_u.i32(cap(m.local.get(b, B())));
    const startOutside = () => ctx.rangeError(ctx.concat(ctx.concat(ctx.stringConst("Start offset "), ctx.numToString(m.local.get(o, f64))), ctx.stringConst(" is outside the bounds of the buffer")));
    const notMultiple = (what: string) => (cond: number) => m.if(cond, ctx.rangeErrorText(`${what} of ${typeName} should be a multiple of ${size}`));
    const lenDyn = dynLen ? ctx.temp(ctx.dynType()) : -1;
    const parts: number[] = [m.local.set(b, bufValue()),
      m.local.set(o, off ? m.f64.trunc(ctx.expr(off)) : dynOff ? m.f64.trunc(ctx.dynToNumber(ctx.expr(dynOff))) : m.f64.const(0)),
      ...(dynLen ? [m.local.set(lenDyn, ctx.expr(dynLen))] : []),
      m.if(m.f64.ne(m.local.get(o, f64), m.local.get(o, f64)), m.local.set(o, m.f64.const(0))),
      m.if(m.f64.lt(m.local.get(o, f64), m.f64.const(0)), startOutside())];
    if (size > 1) parts.push(notMultiple("start offset")(m.f64.ne(m.f64.trunc(m.f64.div(m.local.get(o, f64), m.f64.const(size))), m.f64.div(m.local.get(o, f64), m.f64.const(size)))));
    const omitted = (): number[] => [
      ...(size > 1 ? [notMultiple("byte length")(m.i32.and(cap(m.local.get(b, B())), m.i32.const(size - 1)))] : []),
      m.local.set(bytesLen, m.f64.sub(c(), m.local.get(o, f64))), m.if(m.f64.lt(m.local.get(bytesLen, f64), m.f64.const(0)), startOutside()),
      m.local.set(n, m.f64.div(m.local.get(bytesLen, f64), m.f64.const(size)))];
    const explicit = (value: number): number[] => [m.local.set(n, m.f64.trunc(value)), m.if(m.f64.ne(m.local.get(n, f64), m.local.get(n, f64)), m.local.set(n, m.f64.const(0))),
      m.if(m.i32.or(m.f64.lt(m.local.get(n, f64), m.f64.const(0)), m.f64.gt(m.f64.add(m.local.get(o, f64), m.f64.mul(m.local.get(n, f64), m.f64.const(size))), c())),
        ctx.rangeError(ctx.concat(ctx.stringConst("Invalid typed array length: "), ctx.numToString(m.local.get(n, f64)))))];
    if (dynLen) parts.push(m.if(ctx.dynIsUndefined(m.local.get(lenDyn, ctx.dynType())), m.block(null, omitted()),
      m.block(null, explicit(ctx.dynToNumber(m.local.get(lenDyn, ctx.dynType()))))));
    else if (!length) parts.push(...omitted());
    else parts.push(...explicit(ctx.expr(length)));
    return m.block(null, [...parts,
      m.struct.new([m.i32.add(bufBase(m.local.get(b, B())), m.i32.trunc_u.f64(m.local.get(o, f64))), m.i32.trunc_u.f64(m.local.get(n, f64)), ownerOf(m.local.get(b, B())), cap(m.local.get(b, B())), m.ref.null(binaryen.anyref), m.ref.null(binaryen.externref)], BE(kind))], B());
  };

  /** `new ArrayBuffer(n)` under native dyn: fresh zeroed u8 storage whose
   * whole-buffer $Bytes is registered as its owner's buffer, so every view
   * over it answers the same `.buffer` (identity) and aliases its bytes. */
  const freshBuffer = (n: IrExpr, loc: SrcLoc): number => {
    const b = ctx.temp(B()), E = binaryen.externref;
    const keep = keepBuffer();
    return m.block(null, [
      m.local.set(b, ctx.expr({ kind: "bytesNew", source: n, type: { kind: "bytes", elem: "u8" }, loc } as unknown as IrExpr)),
      m.call(keep, [ctx.externConvertAny(ownerOf(m.local.get(b, B()))), ctx.externConvertAny(m.local.get(b, B()))], binaryen.none),
      m.local.get(b, B())], B());
  };

  /* Engine views: a compiled typed array as a real JS typed array over the
   * module's (resizable) memory, and back. `kind` is the host's element index. */
  const kindIndex = (elem: IrBytesElem) => Object.keys(FORK_BYTES_ELEMENT_NAME).indexOf(elem);
  // (Helpers with their own locals: a conversion may be needed inside another helper's body.)
  const toJs = (v: number, elem: IrBytesElem): number => {
    memory();
    const name = `$bytes.toJs.${elem}`, E = binaryen.externref;
    defineHelper(name, () => {
      const b = () => m.local.get(0, B()), view = () => m.local.get(1, E), owner = () => m.struct.get(BYTES_OWNER, b(), binaryen.anyref, false);
      // A subarray's view reports its offset within the shared buffer (the host defaults to 0).
      m.addFunction(name, B(), E, [E], m.block(null, [
        m.local.set(1, m.call(ctx.host("bytes.toJs", [E, i32, i32, i32], E), [ctx.externConvertAny(b()), m.i32.const(kindIndex(elem)), base(b()), len(b())], E)),
        m.if(m.i32.eqz(m.ref.is_null(owner())), m.call(ctx.host("bytes.viewOffset", [E, i32], binaryen.none),
          [view(), m.i32.sub(base(b()), base(m.ref.cast(owner(), B())))], binaryen.none)),
        view()], E));
    });
    return m.call(name, [v], E);
  };
  /** A JS value to compiled bytes: our own view unwraps to its array; a JS
   * typed array of the same kind is copied into fresh owned storage (an
   * explicit data crossing); anything else is a TypeError (host-side). */
  const fromJs = (v: number, elem: IrBytesElem): number => {
    memory();
    const name = `$bytes.fromJs.${elem}`, E = binaryen.externref;
    defineHelper(name, () => {
      const x = () => m.local.get(0, E), a = () => m.local.get(1, binaryen.anyref), out = () => m.local.get(2, B()), n = () => m.local.get(3, i32);
      const nn = binaryen.getTypeFromHeapType(binaryen.getHeapType(B()), false);
      m.addFunction(name, E, B(), [binaryen.anyref, B(), i32], m.block(null, [
        m.local.set(1, ctx.anyConvertExtern(m.call(ctx.host("bytes.unwrap", [E, i32], E), [x(), m.i32.const(kindIndex(elem))], E))),
        m.if(m.ref.test(a(), nn), m.ref.cast(a(), nn), m.block(null, [
          m.local.set(3, m.call(ctx.host("bytes.lengthOf", [E, i32], i32), [x(), m.i32.const(kindIndex(elem))], i32)),
          m.local.set(2, newOwned(n(), elem)),
          m.call(ctx.host("bytes.copyIn", [E, i32, i32], binaryen.none), [x(), base(out()), m.i32.const(SHIFT[elem])], binaryen.none),
          out()], B())),
      ], B()));
    });
    return m.call(name, [v], B());
  };

  /** Pin a typed array's storage (a retained FFI span): its owner is
   * dropped from the finalization registry, so the block is never freed. */
  const pin = (b: number): number => {
    memory();
    return m.call(ctx.host("bytes.pin", [binaryen.externref], binaryen.none), [ctx.externConvertAny(ownerOf(b))], binaryen.none);
  };

  /** Atomics.<op>(intArray, index, ...values) as wasm atomic memory
   * instructions on the array's storage: sequentially consistent, exactly
   * JS's integer-typed-array surface. The index is ToIndex'd and range
   * checked (RangeError), values are ToIntegerOrInfinity'd then wrapped to
   * the element, and results read back as the element type. */
  const ATOMIC_SIZE: Partial<Record<IrBytesElem, 1 | 2 | 4>> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 };
  const atomics = (op: string, args: IrExpr[], loc: SrcLoc): number => {
    const elem = elemOf(args[0]!.type), size = ATOMIC_SIZE[elem];
    if (!size) return ctx.unsupported(`Atomics.${op} on a ${elem} typed array`, loc);
    if (op === "notify" && elem !== "i32") return ctx.unsupported("Atomics.notify on a non-Int32Array", loc);
    const name = `$atomics.${op}.${elem}`, values = op === "compareExchange" ? 2 : op === "load" ? 0 : 1;
    defineHelper(name, () => {
      const b = () => m.local.get(0, B()), x = () => m.local.get(1, f64), v = (k: number) => m.local.get(2 + k, f64);
      const at = 2 + values; // i32 address local
      const word = (k: number) => ctx.toInt32(m.f64.trunc(v(k)));
      const sized = (r: { [k: string]: any }, s: number) => s === 4 ? r.rmw : s === 2 ? r.rmw16_u : r.rmw8_u;
      const A = m.i32.atomic as unknown as Record<string, any>;
      const ptr = () => m.local.get(at, i32);
      // The raw element (zero-extended for narrow loads) back to the element's value.
      const back = (raw: number): number => {
        switch (elem) {
          case "i8": return m.f64.convert_s.i32(m.i32.extend8_s(raw));
          case "i16": return m.f64.convert_s.i32(m.i32.extend16_s(raw));
          case "i32": return m.f64.convert_s.i32(raw);
          default: return m.f64.convert_u.i32(raw);
        }
      };
      let body: number;
      const load = size === 4 ? A.load : size === 2 ? A.load16_u : A.load8_u;
      const store = size === 4 ? A.store : size === 2 ? A.store16 : A.store8;
      switch (op) {
        case "load": body = back(load(0, ptr())); break;
        case "store": {
          // Returns ToIntegerOrInfinity(v): NaN and -0 become +0.
          body = m.block(null, [store(0, ptr(), word(0)), m.if(m.f64.ne(v(0), v(0)), m.f64.const(0), m.f64.add(m.f64.trunc(v(0)), m.f64.const(0)))], f64);
          break;
        }
        case "add": case "sub": case "and": case "or": case "xor": body = back(sized(A, size)[op](0, ptr(), word(0))); break;
        case "exchange": body = back(sized(A, size).xchg(0, ptr(), word(0))); break;
        case "compareExchange": {
          // The expected value compares in the element's width.
          const mask = size === 4 ? (e: number) => e : (e: number) => m.i32.and(e, m.i32.const(size === 2 ? 0xffff : 0xff));
          body = back(sized(A, size).cmpxchg(0, ptr(), mask(word(0)), word(1)));
          break;
        }
        case "notify": {
          // notify(arr, i[, count]): an omitted count is +Infinity; NaN is 0; clamp to [0, 2^31).
          const c = () => v(0);
          const count = m.if(m.f64.ne(c(), c()), m.i32.const(0),
            m.if(m.f64.le(c(), m.f64.const(0)), m.i32.const(0), m.if(m.f64.ge(c(), m.f64.const(2147483647)), m.i32.const(-1), m.i32.trunc_u.f64(c()))));
          body = m.f64.convert_u.i32(m.memory.atomic.notify(ptr(), count));
          break;
        }
        default: return ctx.unsupported(`Atomics.${op}`, loc);
      }
      const idx = 2 + values + 1; // f64 truncated index local
      m.addFunction(name, binaryen.createType([B(), f64, ...Array(values).fill(f64)]), f64, [i32, f64], m.block(null, [
        // ToIndex: NaN -> 0; truncate; outside [0, length) is a RangeError.
        m.local.set(idx, m.f64.trunc(x())),
        m.if(m.f64.ne(m.local.get(idx, f64), m.local.get(idx, f64)), m.local.set(idx, m.f64.const(0))),
        m.if(m.i32.or(m.f64.lt(m.local.get(idx, f64), m.f64.const(0)), m.f64.ge(m.local.get(idx, f64), m.f64.convert_u.i32(len(b())))),
          m.drop(ctx.rangeErrorText("Invalid atomic access index"))),
        m.local.set(at, m.i32.add(base(b()), m.i32.shl(m.i32.trunc_u.f64(m.local.get(idx, f64)), m.i32.const(SHIFT[elem])))),
        body,
      ], f64));
    });
    // Receiver, index, then values: JS evaluation order. notify's count defaults to +Infinity.
    const ops = args.map((a) => ctx.expr(a));
    while (op === "notify" && ops.length < 3) ops.push(m.f64.const(Infinity));
    return m.call(name, ops, f64);
  };

  /** DataView.getBig(U)Int64's raw 64 bits (view, offset f64, littleEndian i32) -> i64, with the getters' bounds RangeError. */
  const dataViewGetI64 = (view: number, off: number, le: number): number => {
    memory();
    const name = "$dv.get.raw64";
    defineHelper(name, () => {
      const b = () => m.local.get(0, B()), o = () => m.local.get(1, f64), l = () => m.local.get(2, i32), w64 = () => m.local.get(3, binaryen.i64);
      const at = () => m.i32.add(base(b()), m.i32.trunc_u.f64(o()));
      const swap64 = () => m.i64.or(m.i64.shl(m.i64.extend_u(bswap32(() => m.i32.wrap(w64()))), c64(32)), m.i64.extend_u(bswap32(() => m.i32.wrap(m.i64.shr_u(w64(), c64(32))))));
      m.addFunction(name, binaryen.createType([B(), f64, i32]), binaryen.i64, [binaryen.i64], m.block(null, [
        m.if(m.f64.ne(o(), o()), m.local.set(1, m.f64.const(0))),
        m.if(m.i32.or(m.f64.lt(o(), m.f64.const(0)), m.f64.gt(m.f64.add(o(), m.f64.const(8)), m.f64.convert_u.i32(len(b())))), ctx.rangeErrorText("Offset is outside the bounds of the DataView")),
        m.local.set(3, m.i64.load(0, 1, at())), m.if(m.i32.eqz(l()), m.local.set(3, swap64())), w64()], binaryen.i64));
    });
    return m.call(name, [view, m.f64.trunc(off), le], binaryen.i64);
  };
  /** DataView.setBig(U)Int64's raw 64 bits (view, offset f64, value i64, littleEndian i32), with the setters' bounds RangeError. */
  const dataViewSetI64 = (view: number, off: number, value: number, le: number): number => {
    memory();
    const name = "$dv.set.raw64";
    defineHelper(name, () => {
      const b = () => m.local.get(0, B()), o = () => m.local.get(1, f64), w64 = () => m.local.get(2, binaryen.i64), l = () => m.local.get(3, i32);
      const at = () => m.i32.add(base(b()), m.i32.trunc_u.f64(o()));
      const swap64 = () => m.i64.or(m.i64.shl(m.i64.extend_u(bswap32(() => m.i32.wrap(w64()))), c64(32)), m.i64.extend_u(bswap32(() => m.i32.wrap(m.i64.shr_u(w64(), c64(32))))));
      m.addFunction(name, binaryen.createType([B(), f64, binaryen.i64, i32]), binaryen.none, [], m.block(null, [
        m.if(m.f64.ne(o(), o()), m.local.set(1, m.f64.const(0))),
        m.if(m.i32.or(m.f64.lt(o(), m.f64.const(0)), m.f64.gt(m.f64.add(o(), m.f64.const(8)), m.f64.convert_u.i32(len(b())))), ctx.rangeErrorText("Offset is outside the bounds of the DataView")),
        m.if(m.i32.eqz(l()), m.local.set(2, swap64())),
        m.i64.store(0, 1, at(), w64())], binaryen.none));
    });
    return m.call(name, [view, m.f64.trunc(off), value, le], binaryen.none);
  };
  /** Fresh owned storage of `count` (i32) elements, and a store of a number (the element type's conversion). */
  const newOwnedOf = (count: number, elem: IrBytesElem): number => { memory(); return newOwned(count, elem); };
  const storeNumber = (elem: IrBytesElem, b: number, i: number, v: () => number): number => store(elem, addr(elem, b, i), v);
  const loadNumber = (elem: IrBytesElem, b: number, i: number): number => load(elem, addr(elem, b, i));
  return { bufferOf, keepBuffer, construct, fromLength, get, rawGet, getAt, rawAt, int32Get, set, method, print, vectorAddress, view, freshBuffer, B, toJs, fromJs, pin, atomics, newOwnedOf, storeNumber, loadNumber, dataViewGetI64, dataViewSetI64 };
}

/** The host's view of element kinds, by the index print.bytes passes. */
export const BYTES_KINDS = Object.values(FORK_BYTES_ELEMENT_NAME);
