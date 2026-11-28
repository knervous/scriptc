/* Intrinsic libraries (docs/intrinsics.md): TypeScript modules with exact
 * plain-JavaScript bodies that a backend may lower to instructions. A module
 * is one when its leading comments include the pragma
 * `@scriptc-intrinsics <library>/<version>`: recognition reads the module's
 * text, so it holds wherever the module is installed. */
import type { IrIntrinsicModule, IrModule } from "./ir.js";

/** The libraries this compiler knows, with the newest version it lowers. A
 * module naming another library or a newer version still compiles, from its
 * own bodies. */
export const INTRINSIC_LIBRARIES: Readonly<Record<string, number>> = {
  int: 1, math: 1, layout: 1, f16: 1, atomics: 1, simd: 1,
};

const PRAGMA = /@scriptc-intrinsics\s+([a-z][a-z0-9-]*)\/(\d+)\b/;

/** The pragma in the leading comments of `text` (before any code), or null. */
export function intrinsicPragma(text: string): { library: string; version: number } | null {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    let end: number;
    if (text.startsWith("//", at)) end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    else if (text.startsWith("/*", at)) end = text.indexOf("*/", at) < 0 ? text.length : text.indexOf("*/", at) + 2;
    else return null;
    const m = PRAGMA.exec(text.slice(at, end));
    if (m) return { library: m[1]!, version: Number(m[2]) };
    at = end;
  }
}

/** The module's intrinsic library `library`, when the program imports it and
 * this compiler lowers its version. */
export function intrinsicModule(mod: IrModule, library: string): IrIntrinsicModule | null {
  const known = INTRINSIC_LIBRARIES[library];
  for (const lib of mod.intrinsics ?? [])
    if (lib.library === library && known !== undefined && lib.version <= known) return lib;
  return null;
}

/** Whether an IR function or callee name is a member of `lib`. */
export const isIntrinsicMember = (lib: IrIntrinsicModule, name: string): boolean =>
  name.startsWith(lib.tag) || name.startsWith(`%${lib.tag}`);

/** A member's name within its library: `popcnt`, `f32x4.static:add`. */
export const intrinsicMemberName = (lib: IrIntrinsicModule, name: string): string =>
  name.startsWith(`%${lib.tag}`) ? name.slice(lib.tag.length + 1) : name.slice(lib.tag.length);

/* ── the int library ── */

export type IntResult = "i32" | "u32" | "count" | "i64" | "u64";
export interface IntOp { args: ("n" | "b")[]; result: IntResult }
/** The members the int library lowers: argument kinds (n: number read as int32; b: bigint read as i64) and how the
 * result is read back. */
export const INT_LOWERED: Readonly<Record<string, IntOp>> = {
  clz: { args: ["n"], result: "count" }, ctz: { args: ["n"], result: "count" }, popcnt: { args: ["n"], result: "count" },
  rotl: { args: ["n", "n"], result: "i32" }, rotr: { args: ["n", "n"], result: "i32" }, bswap: { args: ["n"], result: "i32" },
  mulhi: { args: ["n", "n"], result: "i32" }, mulhiU: { args: ["n", "n"], result: "u32" },
  addWrap: { args: ["n", "n"], result: "i32" }, subWrap: { args: ["n", "n"], result: "i32" }, mulWrap: { args: ["n", "n"], result: "i32" },
  addSat: { args: ["n", "n"], result: "i32" }, subSat: { args: ["n", "n"], result: "i32" }, mulSat: { args: ["n", "n"], result: "i32" },
  addSatU: { args: ["n", "n"], result: "u32" }, subSatU: { args: ["n", "n"], result: "u32" }, mulSatU: { args: ["n", "n"], result: "u32" },
  toInt8: { args: ["n"], result: "i32" }, toUint8: { args: ["n"], result: "i32" }, toInt16: { args: ["n"], result: "i32" },
  toUint16: { args: ["n"], result: "i32" }, toInt32: { args: ["n"], result: "i32" }, toUint32: { args: ["n"], result: "u32" },
  toInt64: { args: ["b"], result: "i64" }, toUint64: { args: ["b"], result: "u64" },
  lo32: { args: ["b"], result: "i32" }, hi32: { args: ["b"], result: "i32" }, join64: { args: ["n", "n"], result: "u64" },
  clz64: { args: ["b"], result: "count" }, ctz64: { args: ["b"], result: "count" }, popcnt64: { args: ["b"], result: "count" },
  rotl64: { args: ["b", "n"], result: "u64" }, rotr64: { args: ["b", "n"], result: "u64" }, bswap64: { args: ["b"], result: "u64" },
  mulhiU64: { args: ["b", "b"], result: "u64" }, mulhi64: { args: ["b", "b"], result: "i64" },
  addWrap64: { args: ["b", "b"], result: "u64" }, subWrap64: { args: ["b", "b"], result: "u64" }, mulWrap64: { args: ["b", "b"], result: "u64" },
  addSat64: { args: ["b", "b"], result: "i64" }, subSat64: { args: ["b", "b"], result: "i64" }, mulSat64: { args: ["b", "b"], result: "i64" },
  addSatU64: { args: ["b", "b"], result: "u64" }, subSatU64: { args: ["b", "b"], result: "u64" }, mulSatU64: { args: ["b", "b"], result: "u64" },
};


/* ── the math library (strict math) ── */

/** Members of the math library each backend may replace: the transcendental functions (generated from the WasmGC
 * in-module math library's source, so its routines compute the same bits) and the word primitives the generated
 * bodies use. */
export const MATH_FUNCTIONS: ReadonlySet<string> = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1", "log",
  "log1p", "log2", "log10", "pow", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt"]);
export const MATH_WORDS: ReadonlySet<string> = new Set(["__hi", "__lo", "__mk"]);
