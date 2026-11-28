/* Intrinsic libraries on the native backend (docs/intrinsics.md): calls into
 * the int library (recognised by its pragma, ir/intrinsic-libraries.ts)
 * become LLVM integer intrinsics. A member without a lowering here compiles
 * from its own (exact) body.
 *
 * 32-bit members read number arguments with ToUint32 (emitToUint32, which
 * reuses an argument's i32 when it has one) and give a double converted from
 * the i32 they compute, carrying that i32 for later integer consumers.
 * 64-bit members read bigint arguments as i64 (a nested lowered call stays
 * in a register, a literal is a constant, any other bigint is read with
 * scr_bigint_to_i64) and give a frame-owned bigint built from the i64. */
import type { IrExpr } from "../../ir/ir.js";
import { INT_LOWERED, MATH_WORDS, intrinsicMemberName, intrinsicModule, isIntrinsicMember } from "../../ir/intrinsic-libraries.js";
import type { LlValue, LlvmEmitterContext } from "./expr-context.js";

type CallExpr = IrExpr & { kind: "call" };

const libs = new WeakMap<object, ReturnType<typeof intrinsicModule>>();
function intLib(host: LlvmEmitterContext) {
  if (!libs.has(host.mod)) libs.set(host.mod, intrinsicModule(host.mod, "int"));
  return libs.get(host.mod) ?? null;
}

function member(host: LlvmEmitterContext, callee: string): string | null {
  const lib = intLib(host);
  if (!lib || !isIntrinsicMember(lib, callee)) return null;
  const name = intrinsicMemberName(lib, callee);
  return Object.hasOwn(INT_LOWERED, name) ? name : null;
}

/** Whether `e` is a call the int library lowers natively. */
export function lowersIntIntrinsic(host: LlvmEmitterContext, e: IrExpr): boolean {
  return e.kind === "call" && member(host, e.callee) !== null;
}

const mathLibs = new WeakMap<object, ReturnType<typeof intrinsicModule>>();
/** The math library's word primitives (`__hi`, `__lo`, `__mk`) as bit casts; its functions compile from their
 * generated bodies, which LLVM keeps unfused. */
function emitMathWord(host: LlvmEmitterContext, e: CallExpr): LlValue | null {
  if (!mathLibs.has(host.mod)) mathLibs.set(host.mod, intrinsicModule(host.mod, "math"));
  const lib = mathLibs.get(host.mod) ?? null;
  if (!lib || !isIntrinsicMember(lib, e.callee)) return null;
  const name = intrinsicMemberName(lib, e.callee);
  if (!MATH_WORDS.has(name)) return null;
  const B = host.B;
  const op = (text: string): string => { const t = B.tmp(); B.line(`${t} = ${text}`); return t; };
  if (name === "__mk") {
    const h = host.emitExpr(e.args[0]!), hi = host.emitToUint32(h.name, e.args[0]!, h.uint32);
    const l = host.emitExpr(e.args[1]!), lo = host.emitToUint32(l.name, e.args[1]!, l.uint32);
    const w = op(`or i64 ${op(`shl i64 ${op(`zext i32 ${hi} to i64`)}, 32`)}, ${op(`zext i32 ${lo} to i64`)}`);
    return { name: op(`bitcast i64 ${w} to double`), type: e.type };
  }
  const x = host.emitExpr(e.args[0]!);
  const bits = op(`bitcast double ${x.name} to i64`);
  const word = op(`trunc i64 ${name === "__hi" ? op(`lshr i64 ${bits}, 32`) : bits} to i32`);
  return { name: op(`sitofp i32 ${word} to double`), type: e.type, uint32: word };
}

const f16Libs = new WeakMap<object, ReturnType<typeof intrinsicModule>>();
/** The f16 library's conversions as the runtime's exact binary16 conversion (scr_bytes.c), NaN stored as 0x7e00. */
function emitF16(host: LlvmEmitterContext, e: CallExpr): LlValue | null {
  if (!f16Libs.has(host.mod)) f16Libs.set(host.mod, intrinsicModule(host.mod, "f16"));
  const lib = f16Libs.get(host.mod) ?? null;
  if (!lib || !isIntrinsicMember(lib, e.callee)) return null;
  const name = intrinsicMemberName(lib, e.callee);
  if (name !== "toF16Bits" && name !== "fromF16Bits") return null;
  const B = host.B;
  const op = (text: string): string => { const t = B.tmp(); B.line(`${t} = ${text}`); return t; };
  if (name === "toF16Bits") {
    const x = host.emitExpr(e.args[0]!);
    host.declare("declare zeroext i16 @scr_f16_from_f64(double)");
    const h = op(`call zeroext i16 @scr_f16_from_f64(double ${x.name})`);
    const nan = op(`fcmp uno double ${x.name}, ${x.name}`);
    const bits = op(`select i1 ${nan}, i32 32256, i32 ${op(`zext i16 ${h} to i32`)}`);
    return { name: op(`uitofp i32 ${bits} to double`), type: e.type, uint32: bits };
  }
  const v = host.emitExpr(e.args[0]!), bits = host.emitToUint32(v.name, e.args[0]!, v.uint32);
  host.declare("declare double @scr_f16_to_f64(i16 zeroext)");
  const r = op(`call double @scr_f16_to_f64(i16 zeroext ${op(`trunc i32 ${bits} to i16`)})`);
  // A NaN pattern reads as the canonical NaN, as the software conversion's does.
  return { name: op(`select i1 ${op(`fcmp uno double ${r}, ${r}`)}, double 0x7FF8000000000000, double ${r}`), type: e.type };
}

/** The call's value (a double or a bigint), or null when it is not a lowered intrinsic. */
export function emitIntIntrinsic(host: LlvmEmitterContext, e: CallExpr): LlValue | null {
  const word = emitMathWord(host, e) ?? emitF16(host, e);
  if (word) return word;
  const name = member(host, e.callee);
  if (name === null) return null;
  const B = host.B;
  const v = raw(host, name, e.args);
  const result = INT_LOWERED[name]!.result;
  if (result === "i64" || result === "u64") {
    const ctor = result === "i64" ? "scr_bigint_from_i64" : "scr_bigint_from_u64";
    host.declare(`declare ptr @${ctor}(i64)`);
    const made = B.tmp();
    B.line(`${made} = call ptr @${ctor}(i64 ${v})`);
    return host.own({ name: made, type: e.type });
  }
  const t = B.tmp();
  B.line(`${t} = ${result === "u32" || result === "count" ? "uitofp" : "sitofp"} i32 ${v} to double`);
  return { name: t, type: e.type, uint32: v };
}

/** The member's raw register: i32 for 32-bit and count results, i64 for 64-bit results. */
function raw(host: LlvmEmitterContext, name: string, args: IrExpr[]): string {
  const B = host.B;
  const op = (text: string): string => { const t = B.tmp(); B.line(`${t} = ${text}`); return t; };
  const intrinsic = (fn: string, ret: string, params: string[], values: string[]): string => {
    host.declare(`declare ${ret} @${fn}(${params.join(", ")})`);
    return op(`call ${ret} @${fn}(${params.map((p, i) => `${p} ${values[i]}`).join(", ")})`);
  };
  const n = (e: IrExpr): string => {
    const v = host.emitExpr(e);
    return host.emitToUint32(v.name, e, v.uint32);
  };
  const b = (e: IrExpr): string => {
    if (e.kind === "call") {
      const inner = member(host, e.callee);
      if (inner !== null && (INT_LOWERED[inner]!.result === "i64" || INT_LOWERED[inner]!.result === "u64")) return raw(host, inner, e.args);
    }
    if (e.kind === "libCall" && e.fn === "bigint.parse" && e.args[0]?.kind === "strLit") {
      try { return BigInt.asIntN(64, BigInt(e.args[0].value)).toString(); } catch { /* read below */ }
    }
    const v = host.emitExpr(e);
    host.declare("declare i64 @scr_bigint_to_i64(ptr)");
    return op(`call i64 @scr_bigint_to_i64(ptr ${v.name})`);
  };
  const a32 = () => n(args[0]!), b32 = () => n(args[1]!);
  const pair32 = (): [string, string] => { const x = a32(); return [x, b32()]; };
  const pair64 = (): [string, string] => { const x = b(args[0]!); return [x, b(args[1]!)]; };
  const i32x2 = ["i32", "i32"], i64x2 = ["i64", "i64"];
  const hi32 = (signed: boolean): string => {
    const [x, y] = pair32();
    const ext = signed ? "sext" : "zext";
    const p = op(`mul i64 ${op(`${ext} i32 ${x} to i64`)}, ${op(`${ext} i32 ${y} to i64`)}`);
    return op(`trunc i64 ${op(`lshr i64 ${p}, 32`)} to i32`);
  };
  const hi64 = (signed: boolean): string => {
    const [x, y] = pair64();
    const ext = signed ? "sext" : "zext";
    const p = op(`mul i128 ${op(`${ext} i64 ${x} to i128`)}, ${op(`${ext} i64 ${y} to i128`)}`);
    return op(`trunc i128 ${op(`${signed ? "ashr" : "lshr"} i128 ${p}, 64`)} to i64`);
  };
  switch (name) {
    case "clz": return intrinsic("llvm.ctlz.i32", "i32", ["i32", "i1"], [a32(), "false"]);
    case "ctz": return intrinsic("llvm.cttz.i32", "i32", ["i32", "i1"], [a32(), "false"]);
    case "popcnt": return intrinsic("llvm.ctpop.i32", "i32", ["i32"], [a32()]);
    case "rotl": case "rotr": { const [x, s] = pair32(); return intrinsic(`llvm.${name === "rotl" ? "fshl" : "fshr"}.i32`, "i32", ["i32", "i32", "i32"], [x, x, s]); }
    case "bswap": return intrinsic("llvm.bswap.i32", "i32", ["i32"], [a32()]);
    case "mulhi": return hi32(true);
    case "mulhiU": return hi32(false);
    case "addWrap": { const [x, y] = pair32(); return op(`add i32 ${x}, ${y}`); }
    case "subWrap": { const [x, y] = pair32(); return op(`sub i32 ${x}, ${y}`); }
    case "mulWrap": { const [x, y] = pair32(); return op(`mul i32 ${x}, ${y}`); }
    case "addSat": return intrinsic("llvm.sadd.sat.i32", "i32", i32x2, pair32());
    case "subSat": return intrinsic("llvm.ssub.sat.i32", "i32", i32x2, pair32());
    case "addSatU": return intrinsic("llvm.uadd.sat.i32", "i32", i32x2, pair32());
    case "subSatU": return intrinsic("llvm.usub.sat.i32", "i32", i32x2, pair32());
    // Fixed-point saturating multiplication with scale 0 is saturating integer multiplication.
    case "mulSat": return intrinsic("llvm.smul.fix.sat.i32", "i32", ["i32", "i32", "i32"], [...pair32(), "0"]);
    case "mulSatU": return intrinsic("llvm.umul.fix.sat.i32", "i32", ["i32", "i32", "i32"], [...pair32(), "0"]);
    case "toInt8": return op(`sext i8 ${op(`trunc i32 ${a32()} to i8`)} to i32`);
    case "toUint8": return op(`and i32 ${a32()}, 255`);
    case "toInt16": return op(`sext i16 ${op(`trunc i32 ${a32()} to i16`)} to i32`);
    case "toUint16": return op(`and i32 ${a32()}, 65535`);
    case "toInt32": case "toUint32": return a32();
    case "toInt64": case "toUint64": return b(args[0]!);
    case "lo32": return op(`trunc i64 ${b(args[0]!)} to i32`);
    case "hi32": return op(`trunc i64 ${op(`lshr i64 ${b(args[0]!)}, 32`)} to i32`);
    case "join64": { const [h, l] = pair32(); return op(`or i64 ${op(`shl i64 ${op(`zext i32 ${h} to i64`)}, 32`)}, ${op(`zext i32 ${l} to i64`)}`); }
    case "clz64": return op(`trunc i64 ${intrinsic("llvm.ctlz.i64", "i64", ["i64", "i1"], [b(args[0]!), "false"])} to i32`);
    case "ctz64": return op(`trunc i64 ${intrinsic("llvm.cttz.i64", "i64", ["i64", "i1"], [b(args[0]!), "false"])} to i32`);
    case "popcnt64": return op(`trunc i64 ${intrinsic("llvm.ctpop.i64", "i64", ["i64"], [b(args[0]!)])} to i32`);
    case "rotl64": case "rotr64": {
      const x = b(args[0]!), s = op(`zext i32 ${n(args[1]!)} to i64`);
      return intrinsic(`llvm.${name === "rotl64" ? "fshl" : "fshr"}.i64`, "i64", ["i64", "i64", "i64"], [x, x, s]);
    }
    case "bswap64": return intrinsic("llvm.bswap.i64", "i64", ["i64"], [b(args[0]!)]);
    case "mulhiU64": return hi64(false);
    case "mulhi64": return hi64(true);
    case "addWrap64": { const [x, y] = pair64(); return op(`add i64 ${x}, ${y}`); }
    case "subWrap64": { const [x, y] = pair64(); return op(`sub i64 ${x}, ${y}`); }
    case "mulWrap64": { const [x, y] = pair64(); return op(`mul i64 ${x}, ${y}`); }
    case "addSat64": return intrinsic("llvm.sadd.sat.i64", "i64", i64x2, pair64());
    case "subSat64": return intrinsic("llvm.ssub.sat.i64", "i64", i64x2, pair64());
    case "addSatU64": return intrinsic("llvm.uadd.sat.i64", "i64", i64x2, pair64());
    case "subSatU64": return intrinsic("llvm.usub.sat.i64", "i64", i64x2, pair64());
    case "mulSat64": return intrinsic("llvm.smul.fix.sat.i64", "i64", ["i64", "i64", "i32"], [...pair64(), "0"]);
    case "mulSatU64": return intrinsic("llvm.umul.fix.sat.i64", "i64", ["i64", "i64", "i32"], [...pair64(), "0"]);
    default: throw new Error(`int intrinsic ${name} has no native lowering`);
  }
}
