/* Intrinsic libraries on WasmGC (docs/intrinsics.md): calls into a module the
 * frontend recognised by its pragma (ir/intrinsic-libraries.ts) become
 * instructions. A member without a lowering here compiles from its own
 * (exact) body, so this table only ever changes speed.
 *
 * int: 32-bit members take f64 arguments read with ToInt32 (the emitter's
 * toInt32 folds an argument that is already an i32 underneath) and give f64
 * results converted from the i32 or u32 they compute. 64-bit members take
 * bigint arguments as i64 (a nested call stays i64; a literal is a constant;
 * any other bigint crosses with one host call) and give a bigint result from
 * the i64 they compute. */
import binaryen from "binaryen";
import type { IrExpr, IrIntrinsicModule, SrcLoc } from "../../ir/ir.js";
import { INT_LOWERED, MATH_FUNCTIONS, MATH_WORDS, intrinsicMemberName, isIntrinsicMember, loweredIntrinsicCall } from "../../ir/intrinsic-libraries.js";

export { INT_LOWERED };

export interface IntrinsicContext {
  m: binaryen.Module;
  expr(e: IrExpr): number;
  toInt32(value: number): number;
  hostCall(name: string, args: number[], params: number[], result: number): number;
  unsupported(what: string, loc?: SrcLoc): never;
}

const { i32, i64 } = binaryen;
const E = binaryen.externref;
const k64 = (m: binaryen.Module, v: bigint) => m.i64.const(BigInt.asIntN(64, v) as unknown as number);

export function intLowering(lib: IrIntrinsicModule, ctx: IntrinsicContext) {
  const { m } = ctx;
  const member = (callee: string): string | null => {
    if (!isIntrinsicMember(lib, callee)) return null;
    const name = intrinsicMemberName(lib, callee);
    return Object.hasOwn(INT_LOWERED, name) ? name : null;
  };
  /** Whether this call lowers: a member with a lowering, called with plain arguments (loweredIntrinsicCall). */
  const lowers = (callee: string, args: readonly IrExpr[]): boolean => loweredIntrinsicCall(lib, callee, args) !== null;

  /* Out-of-line helpers for the members that need a value twice (binaryen inlines them when it pays). */
  const helpers = new Map<string, string>();
  const helper = (name: string, params: number[], result: number, vars: number[], body: () => number): string => {
    const full = `$int.${name}`;
    if (!helpers.has(name)) { helpers.set(name, full); m.addFunction(full, binaryen.createType(params), result, vars, body()); }
    return full;
  };
  const g32 = (i: number) => m.local.get(i, i32), g64 = (i: number) => m.local.get(i, i64);
  /** Clamp an i64 local to [lo, hi] and wrap to i32. */
  const clamp64to32 = (v: () => number, lo: bigint, hi: bigint) =>
    m.i32.wrap(m.select(m.i64.lt_s(v(), k64(m, lo)), k64(m, lo), m.select(m.i64.gt_s(v(), k64(m, hi)), k64(m, hi), v())));
  const sat32 = (name: string, op: (a: number, b: number) => number, signed: boolean) =>
    helper(name, [i32, i32], i32, [i64], () => m.block(null, [
      m.local.set(2, op(signed ? m.i64.extend_s(g32(0)) : m.i64.extend_u(g32(0)), signed ? m.i64.extend_s(g32(1)) : m.i64.extend_u(g32(1)))),
      clamp64to32(() => g64(2), signed ? -0x80000000n : 0n, signed ? 0x7fffffffn : 0xffffffffn),
    ], i32));
  /** Unsigned 64x64 -> high 64 (schoolbook on 32-bit halves). */
  const mulhiU64 = () => helper("mulhiU64", [i64, i64], i64, [i64, i64, i64, i64, i64], () => {
    const a = () => g64(0), b = () => g64(1), M = () => k64(m, 0xffffffffn), s32 = () => k64(m, 32n);
    const lo = (x: number) => m.i64.and(x, M()), hi = (x: number) => m.i64.shr_u(x, s32());
    // 2: a.lo*b.lo  3: a.hi*b.lo + (2 >> 32)  4: a.lo*b.hi + (3 & M)
    return m.block(null, [
      m.local.set(2, m.i64.mul(lo(a()), lo(b()))),
      m.local.set(3, m.i64.add(m.i64.mul(hi(a()), lo(b())), hi(g64(2)))),
      m.local.set(4, m.i64.add(m.i64.mul(lo(a()), hi(b())), lo(g64(3)))),
      m.i64.add(m.i64.add(m.i64.mul(hi(a()), hi(b())), hi(g64(3))), hi(g64(4))),
    ], i64);
  });
  const mulhi64 = () => helper("mulhi64", [i64, i64], i64, [], () => {
    // signed high = unsigned high - (a < 0 ? b : 0) - (b < 0 ? a : 0)
    const a = () => g64(0), b = () => g64(1);
    return m.i64.sub(m.i64.sub(m.call(mulhiU64(), [a(), b()], i64), m.i64.and(m.i64.shr_s(a(), k64(m, 63n)), b())), m.i64.and(m.i64.shr_s(b(), k64(m, 63n)), a()));
  });
  const I64_MAX = 0x7fffffffffffffffn, I64_MIN = -0x8000000000000000n;
  const addSat64 = (sub: boolean) => helper(sub ? "subSat64" : "addSat64", [i64, i64], i64, [i64], () => {
    const a = () => g64(0), b = () => g64(1), r = () => g64(2);
    // Overflow when the operands' signs (b negated for sub) agree and the result's differs.
    const over = sub ? m.i64.and(m.i64.xor(a(), b()), m.i64.xor(a(), r())) : m.i64.and(m.i64.xor(r(), a()), m.i64.xor(r(), b()));
    return m.block(null, [
      m.local.set(2, sub ? m.i64.sub(a(), b()) : m.i64.add(a(), b())),
      m.select(m.i64.lt_s(over, k64(m, 0n)), m.select(m.i64.lt_s(a(), k64(m, 0n)), k64(m, I64_MIN), k64(m, I64_MAX)), r()),
    ], i64);
  });
  const mulSat64 = () => helper("mulSat64", [i64, i64], i64, [i64], () => {
    // Exact when the high half is the sign extension of the low half's top bit.
    const a = () => g64(0), b = () => g64(1), p = () => g64(2);
    return m.block(null, [
      m.local.set(2, m.i64.mul(a(), b())),
      m.select(m.i64.eq(m.call(mulhi64(), [a(), b()], i64), m.i64.shr_s(p(), k64(m, 63n))), p(),
        m.select(m.i64.lt_s(m.i64.xor(a(), b()), k64(m, 0n)), k64(m, I64_MIN), k64(m, I64_MAX))),
    ], i64);
  });
  const satU64 = (name: "addSatU64" | "subSatU64" | "mulSatU64") => helper(name, [i64, i64], i64, [i64], () => {
    const a = () => g64(0), b = () => g64(1), r = () => g64(2);
    if (name === "addSatU64") return m.block(null, [m.local.set(2, m.i64.add(a(), b())), m.select(m.i64.lt_u(r(), a()), k64(m, -1n), r())], i64);
    if (name === "subSatU64") return m.select(m.i64.lt_u(a(), b()), k64(m, 0n), m.i64.sub(a(), b()));
    return m.select(m.i64.eqz(m.call(mulhiU64(), [a(), b()], i64)), m.i64.mul(a(), b()), k64(m, -1n));
  });
  const mulhi32 = (signed: boolean) => m.i32.wrap(m.i64.shr_u(m.i64.mul(...([0, 1].map(i => signed ? m.i64.extend_s(g32(i)) : m.i64.extend_u(g32(i))) as [number, number])), k64(m, 32n)));
  const mulhiHelper = (signed: boolean) => helper(signed ? "mulhi" : "mulhiU", [i32, i32], i32, [], () => mulhi32(signed));
  const mulSat32 = (signed: boolean) => helper(signed ? "mulSat" : "mulSatU", [i32, i32], i32, [i64], () => m.block(null, [
    m.local.set(2, m.i64.mul(signed ? m.i64.extend_s(g32(0)) : m.i64.extend_u(g32(0)), signed ? m.i64.extend_s(g32(1)) : m.i64.extend_u(g32(1)))),
    signed ? clamp64to32(() => g64(2), -0x80000000n, 0x7fffffffn)
      : m.i32.wrap(m.select(m.i64.gt_u(g64(2), k64(m, 0xffffffffn)), k64(m, 0xffffffffn), g64(2))),
  ], i32));

  /** An argument as an i32 (ToInt32). */
  const n = (e: IrExpr): number => ctx.toInt32(ctx.expr(e));
  /** A bigint argument as an i64: a lowered 64-bit call stays i64, a literal is a constant, anything else crosses. */
  const b = (e: IrExpr): number => {
    if (e.kind === "call") {
      const name = member(e.callee), plain = loweredIntrinsicCall(lib, e.callee, e.args);
      if (name !== null && plain !== null && (INT_LOWERED[name]!.result === "i64" || INT_LOWERED[name]!.result === "u64")) return raw(name, plain, e.loc);
    }
    if (e.kind === "libCall" && e.fn === "bigint.parse" && e.args[0]?.kind === "strLit") {
      try { return k64(m, BigInt(e.args[0].value)); } catch { /* not a literal BigInt() accepts: cross below */ }
    }
    return ctx.hostCall("bigint.toI64", [ctx.expr(e)], [E], i64);
  };

  /** The member's raw value: i32 for 32-bit and count results, i64 for 64-bit results. */
  const raw = (name: string, args: IrExpr[], loc: SrcLoc): number => {
    const a = () => n(args[0]!), c = () => n(args[1]!);
    const A = () => b(args[0]!), B = () => b(args[1]!);
    switch (name) {
      case "clz": return m.i32.clz(a());
      case "ctz": return m.i32.ctz(a());
      case "popcnt": return m.i32.popcnt(a());
      case "rotl": return m.i32.rotl(a(), c());
      case "rotr": return m.i32.rotr(a(), c());
      case "bswap": return helperCall("bswap", [a()]);
      case "mulhi": return m.call(mulhiHelper(true), [a(), c()], i32);
      case "mulhiU": return m.call(mulhiHelper(false), [a(), c()], i32);
      case "addWrap": return m.i32.add(a(), c());
      case "subWrap": return m.i32.sub(a(), c());
      case "mulWrap": return m.i32.mul(a(), c());
      case "addSat": return m.call(sat32("addSat", (x, y) => m.i64.add(x, y), true), [a(), c()], i32);
      case "subSat": return m.call(sat32("subSat", (x, y) => m.i64.sub(x, y), true), [a(), c()], i32);
      case "mulSat": return m.call(mulSat32(true), [a(), c()], i32);
      case "addSatU": return m.call(sat32("addSatU", (x, y) => m.i64.add(x, y), false), [a(), c()], i32);
      case "subSatU": return m.call(sat32("subSatU", (x, y) => m.i64.sub(x, y), false), [a(), c()], i32);
      case "mulSatU": return m.call(mulSat32(false), [a(), c()], i32);
      case "toInt8": return m.i32.extend8_s(a());
      case "toUint8": return m.i32.and(a(), m.i32.const(0xff));
      case "toInt16": return m.i32.extend16_s(a());
      case "toUint16": return m.i32.and(a(), m.i32.const(0xffff));
      case "toInt32": case "toUint32": return a();
      case "toInt64": case "toUint64": return A();
      case "lo32": return m.i32.wrap(A());
      case "hi32": return m.i32.wrap(m.i64.shr_u(A(), k64(m, 32n)));
      case "join64": return m.i64.or(m.i64.shl(m.i64.extend_u(a()), k64(m, 32n)), m.i64.extend_u(c()));
      case "clz64": return m.i32.wrap(m.i64.clz(A()));
      case "ctz64": return m.i32.wrap(m.i64.ctz(A()));
      case "popcnt64": return m.i32.wrap(m.i64.popcnt(A()));
      case "rotl64": return m.i64.rotl(A(), m.i64.extend_u(n(args[1]!)));
      case "rotr64": return m.i64.rotr(A(), m.i64.extend_u(n(args[1]!)));
      case "bswap64": return helperCall("bswap64", [A()]);
      case "mulhiU64": return m.call(mulhiU64(), [A(), B()], i64);
      case "mulhi64": return m.call(mulhi64(), [A(), B()], i64);
      case "addWrap64": return m.i64.add(A(), B());
      case "subWrap64": return m.i64.sub(A(), B());
      case "mulWrap64": return m.i64.mul(A(), B());
      case "addSat64": return m.call(addSat64(false), [A(), B()], i64);
      case "subSat64": return m.call(addSat64(true), [A(), B()], i64);
      case "mulSat64": return m.call(mulSat64(), [A(), B()], i64);
      case "addSatU64": case "subSatU64": case "mulSatU64": return m.call(satU64(name), [A(), B()], i64);
      default: return ctx.unsupported(`int intrinsic ${name}`, loc);
    }
  };
  const bswap32 = () => helper("bswap", [i32], i32, [], () => {
    const x = () => g32(0), C = (v: number) => m.i32.const(v);
    return m.i32.or(m.i32.or(m.i32.shl(x(), C(24)), m.i32.shl(m.i32.and(x(), C(0xff00)), C(8))),
      m.i32.or(m.i32.and(m.i32.shr_u(x(), C(8)), C(0xff00)), m.i32.shr_u(x(), C(24))));
  });
  const bswap64 = () => { const sw = bswap32(); return helper("bswap64", [i64], i64, [], () => {
    const x = () => g64(0), s = (v: number) => m.call(sw, [v], i32);
    return m.i64.or(m.i64.shl(m.i64.extend_u(s(m.i32.wrap(x()))), k64(m, 32n)), m.i64.extend_u(s(m.i32.wrap(m.i64.shr_u(x(), k64(m, 32n))))));
  }); };
  const helperCall = (name: "bswap" | "bswap64", args: number[]): number =>
    name === "bswap" ? m.call(bswap32(), args, i32) : m.call(bswap64(), args, i64);

  /** The call's value in the IR's representation: f64 for numbers, a bigint externref for bigints. */
  const call = (callee: string, args: IrExpr[], loc: SrcLoc): number => {
    const name = member(callee)!;
    const v = raw(name, loweredIntrinsicCall(lib, callee, args)!, loc);
    switch (INT_LOWERED[name]!.result) {
      case "i32": case "count": return m.f64.convert_s.i32(v);
      case "u32": return m.f64.convert_u.i32(v);
      case "i64": return ctx.hostCall("bigint.fromI64", [v, m.i32.const(0)], [i64, i32], E);
      case "u64": return ctx.hostCall("bigint.fromI64", [v, m.i32.const(1)], [i64, i32], E);
    }
  };
  return { lowers, call };
}


/* math: the exported functions call the in-module fdlibm routines (fdlibm.ts), which are built from the source the
 * library was generated from, and give the canonical NaN for a NaN result; the word primitives are bit operations. */
export function mathLowering(lib: IrIntrinsicModule, ctx: IntrinsicContext & { routine(name: string): string }) {
  const { m } = ctx;
  const member = (callee: string): string | null => {
    if (!isIntrinsicMember(lib, callee)) return null;
    const name = intrinsicMemberName(lib, callee);
    return MATH_FUNCTIONS.has(name) || MATH_WORDS.has(name) ? name : null;
  };
  /** Whether this call lowers: a member with a lowering, called with plain arguments (loweredIntrinsicCall). */
  const lowers = (callee: string, args: readonly IrExpr[]): boolean => loweredIntrinsicCall(lib, callee, args) !== null;
  const f64 = binaryen.f64;
  const k32 = () => k64(m, 32n);
  const call = (callee: string, args: IrExpr[]): number => {
    const name = member(callee)!;
    const a = loweredIntrinsicCall(lib, callee, args)!.map(x => ctx.expr(x));
    switch (name) {
      case "__hi": return m.f64.convert_s.i32(m.i32.wrap(m.i64.shr_u(m.i64.reinterpret(a[0]!), k32())));
      case "__lo": return m.f64.convert_s.i32(m.i32.wrap(m.i64.reinterpret(a[0]!)));
      case "__mk": return m.f64.reinterpret(m.i64.or(m.i64.shl(m.i64.extend_u(ctx.toInt32(a[0]!)), k32()), m.i64.extend_u(ctx.toInt32(a[1]!))));
    }
    const canonical = `$math.canonical`;
    if (!canonicalDefined.has(m)) {
      canonicalDefined.add(m);
      m.addFunction(canonical, f64, f64, [], m.select(m.f64.ne(m.local.get(0, f64), m.local.get(0, f64)), m.f64.const(NaN), m.local.get(0, f64)));
    }
    return m.call(canonical, [m.call(ctx.routine(name), a, f64)], f64);
  };
  return { lowers, call };
}
const canonicalDefined = new WeakSet<binaryen.Module>();

/* f16: toF16Bits and fromF16Bits on the double's bits (i64.reinterpret), the algorithm of the runtime's
 * scr_f16_from_f64 / scr_f16_to_f64: round to nearest even straight from the double, NaN as 0x7e00 (and read back as
 * the canonical NaN). The library's other members compile from their bodies around these two. */
export function f16Lowering(lib: IrIntrinsicModule, ctx: IntrinsicContext) {
  const { m } = ctx;
  const member = (callee: string): string | null => {
    if (!isIntrinsicMember(lib, callee)) return null;
    const name = intrinsicMemberName(lib, callee);
    return name === "toF16Bits" || name === "fromF16Bits" ? name : null;
  };
  /** Whether this call lowers: a member with a lowering, called with plain arguments (loweredIntrinsicCall). */
  const lowers = (callee: string, args: readonly IrExpr[]): boolean => loweredIntrinsicCall(lib, callee, args) !== null;
  const I = (v: number) => m.i32.const(v), L = (v: bigint) => k64(m, v);
  const defined = new Set<string>();
  const toBits = (): string => {
    const name = "$f16.from_f64";
    if (defined.has(name)) return name;
    defined.add(name);
    // locals: 0 x:f64 | 1 mag:i64 2 sig:i64 3 rest:i64 4 half:i64 5 q:i64 | 6 sign:i32 7 e:i32 8 biased:i32 9 shift:i32
    const g64 = (i: number) => m.local.get(i, binaryen.i64), g32 = (i: number) => m.local.get(i, binaryen.i32);
    const ret = (v: number) => m.return(v);
    const body = m.block(null, [
      m.local.set(1, m.i64.and(m.i64.reinterpret(m.local.get(0, binaryen.f64)), L(0x7fffffffffffffffn))),
      m.local.set(6, m.i32.and(m.i32.wrap(m.i64.shr_u(m.i64.reinterpret(m.local.get(0, binaryen.f64)), L(48n))), I(0x8000))),
      m.if(m.i64.ge_u(g64(1), L(0x7ff0000000000000n)), ret(m.select(m.i64.eq(g64(1), L(0x7ff0000000000000n)), m.i32.or(g32(6), I(0x7c00)), I(0x7e00)))),
      m.local.set(7, m.i32.sub(m.i32.wrap(m.i64.shr_u(g64(1), L(52n))), I(1023))),
      m.if(m.i32.gt_s(g32(7), I(15)), ret(m.i32.or(g32(6), I(0x7c00)))),
      m.local.set(2, m.i64.and(g64(1), L((1n << 52n) - 1n))),
      m.if(m.i32.eq(g32(7), I(-1023)), m.local.set(7, I(-1022)), m.local.set(2, m.i64.or(g64(2), L(1n << 52n)))),
      m.local.set(8, m.i32.add(g32(7), I(15))),
      m.local.set(9, m.select(m.i32.ge_s(g32(8), I(1)), I(42), m.i32.add(I(43), m.i32.sub(I(0), g32(8))))),
      m.if(m.i32.ge_s(g32(9), I(54)), ret(g32(6))),
      m.local.set(5, m.i64.shr_u(g64(2), m.i64.extend_u(g32(9)))),
      m.local.set(3, m.i64.and(g64(2), m.i64.sub(m.i64.shl(L(1n), m.i64.extend_u(g32(9))), L(1n)))),
      m.local.set(4, m.i64.shl(L(1n), m.i64.extend_u(m.i32.sub(g32(9), I(1))))),
      m.if(m.i32.or(m.i64.gt_u(g64(3), g64(4)), m.i32.and(m.i64.eq(g64(3), g64(4)), m.i32.wrap(m.i64.and(g64(5), L(1n))))),
        m.local.set(5, m.i64.add(g64(5), L(1n)))),
      m.if(m.i32.lt_s(g32(8), I(1)), ret(m.i32.or(g32(6), m.i32.wrap(g64(5))))),
      m.if(m.i64.eq(g64(5), L(2048n)), m.block(null, [m.local.set(5, L(1024n)), m.local.set(8, m.i32.add(g32(8), I(1)))])),
      m.if(m.i32.ge_s(g32(8), I(31)), ret(m.i32.or(g32(6), I(0x7c00)))),
      ret(m.i32.or(m.i32.or(g32(6), m.i32.shl(g32(8), I(10))), m.i32.and(m.i32.wrap(g64(5)), I(0x3ff)))),
    ], binaryen.none);
    m.addFunction(name, binaryen.f64, binaryen.i32, [binaryen.i64, binaryen.i64, binaryen.i64, binaryen.i64, binaryen.i64, binaryen.i32, binaryen.i32, binaryen.i32, binaryen.i32],
      m.block(null, [body, m.unreachable()], binaryen.i32));
    return name;
  };
  const fromBits = (): string => {
    const name = "$f16.to_f64";
    if (defined.has(name)) return name;
    defined.add(name);
    // locals: 0 h:i32 | 1 e:i32 2 f:i32
    const g = (i: number) => m.local.get(i, binaryen.i32);
    const signBit = () => m.i64.shl(m.i64.extend_u(m.i32.shr_u(m.i32.and(g(0), I(0x8000)), I(15))), L(63n));
    const withSign = (v: number) => m.f64.reinterpret(m.i64.or(m.i64.reinterpret(v), signBit()));
    m.addFunction(name, binaryen.i32, binaryen.f64, [binaryen.i32, binaryen.i32], m.block(null, [
      m.local.set(1, m.i32.and(m.i32.shr_u(g(0), I(10)), I(0x1f))),
      m.local.set(2, m.i32.and(g(0), I(0x3ff))),
      m.if(m.i32.eqz(g(1)), m.return(withSign(m.f64.mul(m.f64.convert_u.i32(g(2)), m.f64.const(5.9604644775390625e-8))))),
      m.if(m.i32.eq(g(1), I(31)), m.return(m.select(m.i32.eqz(g(2)), withSign(m.f64.const(Infinity)), m.f64.const(NaN)))),
      m.f64.reinterpret(m.i64.or(signBit(), m.i64.or(m.i64.shl(m.i64.extend_u(m.i32.add(g(1), I(1023 - 15))), L(52n)), m.i64.shl(m.i64.extend_u(g(2)), L(42n))))),
    ], binaryen.f64));
    return name;
  };
  const call = (callee: string, given: IrExpr[]): number => {
    const name = member(callee)!;
    const args = loweredIntrinsicCall(lib, callee, given)!;
    if (name === "toF16Bits") return m.f64.convert_u.i32(m.call(toBits(), [ctx.expr(args[0]!)], binaryen.i32));
    return m.call(fromBits(), [m.i32.and(ctx.toInt32(ctx.expr(args[0]!)), I(0xffff))], binaryen.f64);
  };
  return { lowers, call };
}
