/* Wasm SIMD from TypeScript: lowers calls into `simd.intrinsics.ts`.
 *
 * The library (packages/simd/simd.intrinsics.ts) is plain TypeScript with a
 * lane-exact scalar fallback, so Node and dev builds run it as written. This
 * backend never compiles its bodies: the module's `v128` class becomes the
 * native `v128` value type and each static call becomes its instruction.
 * The library's contract is enforced here at compile time: constant lane
 * indices, no other members, and (by the type mapping) no identity. */
import binaryen from "binaryen";
import type { IrExpr, IrModule, SrcLoc } from "../../ir/ir.js";

export const SIMD_LIBRARY_FILE = "simd.intrinsics.ts";

/** The intrinsics module's IR naming, when the program imports it. */
export interface SimdModule { prefix: string; v128Class: string }

export function findSimdModule(mod: IrModule): SimdModule | null {
  for (const f of mod.functions) {
    const file = f.loc?.file ?? "";
    if (!file.endsWith(`/${SIMD_LIBRARY_FILE}`) && file !== SIMD_LIBRARY_FILE) continue;
    // Module members are named "%%mN.<Class>.<member>" or "%%mN.<function>".
    const match = /^(%%m\d+\.)/.exec(f.name);
    if (match) return { prefix: match[1]!, v128Class: `${match[1]!.slice(1)}v128` };
  }
  return null;
}

export interface SimdContext {
  m: binaryen.Module;
  expr(e: IrExpr): number;
  toInt32(value: number): number;
  /** An f64-typed IR value as f32 (no conversion when it is already f32-exact). */
  f32(e: IrExpr): number;
  /** Bounds-checked byte address of `count` elements at `index` of a typed array. */
  vectorAddress(recv: IrExpr, index: IrExpr, count: number): number;
  unsupported(what: string, loc?: SrcLoc): never;
  /** experimentalRelaxedSimd: `relaxed_*` operations become Relaxed SIMD instructions. */
  relaxed?: boolean;
}

/* binaryen.js has no wrappers for the relaxed ternaries; build them through the C API. */
const relaxedTernary = (m: binaryen.Module, op: "RelaxedMaddVecF32x4" | "RelaxedNmaddVecF32x4", a: number, b: number, c: number): number => {
  const api = binaryen as unknown as Record<string, unknown>;
  return (api["_BinaryenSIMDTernary"] as (...x: number[]) => number)((m as unknown as { ptr: number }).ptr, api[op] as number, a, b, c);
};

export function simdLowering(lib: SimdModule, ctx: SimdContext) {
  const { m } = ctx;
  const f32 = (e: IrExpr) => ctx.f32(e);
  const int = (e: IrExpr) => ctx.toInt32(ctx.expr(e));
  const lane = (e: IrExpr | undefined, lanes: number, loc: SrcLoc): number => {
    if (!e || e.kind !== "numLit" || !Number.isInteger(e.value) || e.value < 0 || e.value >= lanes)
      return ctx.unsupported(`SIMD lane index must be an integer literal in [0, ${lanes})`, loc);
    return e.value;
  };
  const bool = (x: number) => x; // i32 0/1 is the IR's bool already

  const isIntrinsic = (name: string) => name.startsWith(lib.prefix);
  /** Calls whose result is an f32 lane: exactly representable in f32. */
  const isF32Lane = (name: string) => name === `${lib.prefix}f32x4.static:extract_lane`;
  /** The raw f32 of an f32x4.extract_lane call (no promote). */
  const f32Lane = (args: IrExpr[], loc: SrcLoc) => m.f32x4.extract_lane(ctx.expr(args[0]!), lane(args[1], 4, loc));

  const call = (name: string, args: IrExpr[], loc: SrcLoc): number => {
    const member = name.slice(lib.prefix.length);
    const [cls, raw] = member.split(".");
    const method = raw?.startsWith("static:") ? raw.slice(7) : null;
    if (!method) return ctx.unsupported(`SIMD library member ${member} (only static operations lower)`, loc);
    const a = () => ctx.expr(args[0]!), b = () => ctx.expr(args[1]!), c = () => ctx.expr(args[2]!);
    switch (`${cls}.${method}`) {
      /* v128 */
      case "v128.zero": return m.v128.const([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      case "v128.load": case "v128.loadI32": return m.v128.load(0, 4, ctx.vectorAddress(args[0]!, args[1]!, 4));
      case "v128.loadU8": return m.v128.load(0, 1, ctx.vectorAddress(args[0]!, args[1]!, 16));
      case "v128.store": case "v128.storeI32": { const at = ctx.vectorAddress(args[0]!, args[1]!, 4); return m.v128.store(0, 4, at, c()); }
      case "v128.storeU8": { const at = ctx.vectorAddress(args[0]!, args[1]!, 16); return m.v128.store(0, 1, at, c()); }
      case "v128.and": return m.v128.and(a(), b());
      case "v128.or": return m.v128.or(a(), b());
      case "v128.xor": return m.v128.xor(a(), b());
      case "v128.andnot": return m.v128.andnot(a(), b());
      case "v128.not": return m.v128.not(a());
      case "v128.bitselect": return m.v128.bitselect(a(), b(), c());
      case "v128.any_true": return bool(m.v128.any_true(a()));

      /* f32x4 */
      case "f32x4.of": return [1, 2, 3].reduce((acc, i) => m.f32x4.replace_lane(acc, i, f32(args[i]!)), m.f32x4.splat(f32(args[0]!)));
      case "f32x4.splat": return m.f32x4.splat(f32(args[0]!));
      case "f32x4.extract_lane": return m.f64.promote(m.f32x4.extract_lane(a(), lane(args[1], 4, loc)));
      case "f32x4.replace_lane": return m.f32x4.replace_lane(a(), lane(args[1], 4, loc), f32(args[2]!));
      case "f32x4.add": return m.f32x4.add(a(), b());
      case "f32x4.sub": return m.f32x4.sub(a(), b());
      case "f32x4.mul": return m.f32x4.mul(a(), b());
      case "f32x4.div": return m.f32x4.div(a(), b());
      case "f32x4.min": return m.f32x4.min(a(), b());
      case "f32x4.max": return m.f32x4.max(a(), b());
      case "f32x4.abs": return m.f32x4.abs(a());
      case "f32x4.neg": return m.f32x4.neg(a());
      case "f32x4.sqrt": return m.f32x4.sqrt(a());
      case "f32x4.ceil": return m.f32x4.ceil(a());
      case "f32x4.floor": return m.f32x4.floor(a());
      case "f32x4.trunc": return m.f32x4.trunc(a());
      case "f32x4.nearest": return m.f32x4.nearest(a());
      // Deterministic lowering (matches the fallback) unless the build opts
      // into Relaxed SIMD: then a fused multiply-add where the hardware has
      // one (V8: arm64, x64 with FMA3), so the low bits may differ.
      case "f32x4.relaxed_madd": return ctx.relaxed ? relaxedTernary(m, "RelaxedMaddVecF32x4", a(), b(), c()) : m.f32x4.add(m.f32x4.mul(a(), b()), c());
      case "f32x4.relaxed_nmadd": return ctx.relaxed ? relaxedTernary(m, "RelaxedNmaddVecF32x4", a(), b(), c()) : m.f32x4.sub(c(), m.f32x4.mul(a(), b()));
      case "f32x4.eq": return m.f32x4.eq(a(), b());
      case "f32x4.ne": return m.f32x4.ne(a(), b());
      case "f32x4.lt": return m.f32x4.lt(a(), b());
      case "f32x4.le": return m.f32x4.le(a(), b());
      case "f32x4.gt": return m.f32x4.gt(a(), b());
      case "f32x4.ge": return m.f32x4.ge(a(), b());
      case "f32x4.convert_i32x4_s": return m.f32x4.convert_i32x4_s(a());
      case "f32x4.convert_i32x4_u": return m.f32x4.convert_i32x4_u(a());

      /* i32x4 */
      case "i32x4.of": return [1, 2, 3].reduce((acc, i) => m.i32x4.replace_lane(acc, i, int(args[i]!)), m.i32x4.splat(int(args[0]!)));
      case "i32x4.splat": return m.i32x4.splat(int(args[0]!));
      case "i32x4.extract_lane": return m.f64.convert_s.i32(m.i32x4.extract_lane(a(), lane(args[1], 4, loc)));
      case "i32x4.replace_lane": return m.i32x4.replace_lane(a(), lane(args[1], 4, loc), int(args[2]!));
      case "i32x4.add": return m.i32x4.add(a(), b());
      case "i32x4.sub": return m.i32x4.sub(a(), b());
      case "i32x4.mul": return m.i32x4.mul(a(), b());
      case "i32x4.min_s": return m.i32x4.min_s(a(), b());
      case "i32x4.max_s": return m.i32x4.max_s(a(), b());
      case "i32x4.shl": return m.i32x4.shl(a(), int(args[1]!));
      case "i32x4.shr_s": return m.i32x4.shr_s(a(), int(args[1]!));
      case "i32x4.shr_u": return m.i32x4.shr_u(a(), int(args[1]!));
      case "i32x4.eq": return m.i32x4.eq(a(), b());
      case "i32x4.lt_s": return m.i32x4.lt_s(a(), b());
      case "i32x4.gt_s": return m.i32x4.gt_s(a(), b());
      case "i32x4.trunc_sat_f32x4_s": return m.i32x4.trunc_sat_f32x4_s(a());
      case "i32x4.all_true": return bool(m.i32x4.all_true(a()));
      case "i32x4.bitmask": return m.f64.convert_u.i32(m.i32x4.bitmask(a()));
      default: return ctx.unsupported(`SIMD operation ${cls}.${method}`, loc);
    }
  };

  return { isIntrinsic, isF32Lane, f32Lane, call };
}
