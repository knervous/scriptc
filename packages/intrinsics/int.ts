/* @scriptc-intrinsics int/1 */
/* Fixed-width integer and bit operations.
 *
 * Under Node, tests and unbundled builds this module runs as written: every
 * function below is exact plain JavaScript. When scriptc compiles a program
 * that imports it (the module is recognised by the pragma on its first line,
 * not by its file name), the bodies are not compiled: each call becomes its
 * instruction (WasmGC: i32/i64 instructions; native: LLVM integer
 * intrinsics). Results are identical on every target.
 *
 * Conventions:
 * - 32-bit functions take numbers and read them as JavaScript's bitwise
 *   operators do (ToInt32, or ToUint32 for the `U` forms). Results that are
 *   bit patterns are signed int32s, like `x | 0`; `>>> 0` reads one unsigned.
 * - 64-bit functions (suffix `64`) take bigints and read their low 64 bits.
 *   Bit patterns and wrapping results are unsigned 64-bit values (Uint64);
 *   the signed forms (`mulhi64`, `addSat64`, `subSat64`, `mulSat64`) return
 *   signed ones (Int64). Counts are numbers.
 * - Saturating forms clamp to the type's range instead of wrapping.
 *
 * The contract types are the same aliases @scriptc/types declares: TypeScript
 * erases them, and scriptc checks every value stored into a slot of one. */

/** A number that is always a signed 32-bit integer. */
export type Int32 = number;
/** A number that is always an unsigned 32-bit integer. */
export type Uint32 = number;
/** A number in [-128, 127]. As a class field or array element, stored in one byte. */
export type Int8 = number;
/** A number in [0, 255]. As a class field or array element, stored in one byte. */
export type Uint8 = number;
/** A number in [-32768, 32767]. As a class field or array element, stored in two bytes. */
export type Int16 = number;
/** A number in [0, 65535]. As a class field or array element, stored in two bytes. */
export type Uint16 = number;
/** A bigint in [-2^63, 2^63 - 1]. */
export type Int64 = bigint;
/** A bigint in [0, 2^64 - 1]. */
export type Uint64 = bigint;

/* ── 32-bit ───────────────────────────────────────────────────────────── */

/** Leading zero bits of ToUint32(x); 32 for 0. Same as Math.clz32. */
export function clz(x: number): Int32 {
  return Math.clz32(x);
}

/** Trailing zero bits of ToUint32(x); 32 for 0. */
export function ctz(x: number): Int32 {
  const v = x | 0;
  return v === 0 ? 32 : 31 - Math.clz32(v & -v);
}

/** Set bits of ToUint32(x). */
export function popcnt(x: number): Int32 {
  let v = x | 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** x rotated left by n mod 32 bits. */
export function rotl(x: number, n: number): Int32 {
  const s = n & 31;
  return s === 0 ? x | 0 : (x << s) | (x >>> (32 - s));
}

/** x rotated right by n mod 32 bits. */
export function rotr(x: number, n: number): Int32 {
  const s = n & 31;
  return s === 0 ? x | 0 : (x >>> s) | (x << (32 - s));
}

/** The four bytes of x in reverse order. */
export function bswap(x: number): Int32 {
  return ((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | ((x >>> 24) & 0xff);
}

/** The high 32 bits of the unsigned 64-bit product of ToUint32(a) and ToUint32(b). */
export function mulhiU(a: number, b: number): Uint32 {
  const x = a >>> 0, y = b >>> 0;
  const x0 = x & 0xffff, x1 = x >>> 16, y0 = y & 0xffff, y1 = y >>> 16;
  const t = x1 * y0 + Math.floor((x0 * y0) / 65536);
  const w = (t % 65536) + x0 * y1;
  return x1 * y1 + Math.floor(t / 65536) + Math.floor(w / 65536);
}

/** The high 32 bits of the signed 64-bit product of ToInt32(a) and ToInt32(b). */
export function mulhi(a: number, b: number): Int32 {
  const x = a | 0, y = b | 0;
  return (mulhiU(x, y) - (x < 0 ? y >>> 0 : 0) - (y < 0 ? x >>> 0 : 0)) | 0;
}

/** ToInt32(a) + ToInt32(b), wrapping. */
export function addWrap(a: number, b: number): Int32 {
  return ((a | 0) + (b | 0)) | 0;
}
/** ToInt32(a) - ToInt32(b), wrapping. */
export function subWrap(a: number, b: number): Int32 {
  return ((a | 0) - (b | 0)) | 0;
}
/** ToInt32(a) * ToInt32(b), wrapping. Same as Math.imul. */
export function mulWrap(a: number, b: number): Int32 {
  return Math.imul(a, b);
}

const I32_MAX = 2147483647, I32_MIN = -2147483648, U32_MAX = 4294967295;
const clampI32 = (v: number): Int32 => (v > I32_MAX ? I32_MAX : v < I32_MIN ? I32_MIN : v);
const clampU32 = (v: number): Uint32 => (v > U32_MAX ? U32_MAX : v < 0 ? 0 : v);

/** ToInt32(a) + ToInt32(b), clamped to the int32 range. */
export function addSat(a: number, b: number): Int32 {
  return clampI32((a | 0) + (b | 0));
}
/** ToInt32(a) - ToInt32(b), clamped to the int32 range. */
export function subSat(a: number, b: number): Int32 {
  return clampI32((a | 0) - (b | 0));
}
/** ToInt32(a) * ToInt32(b), clamped to the int32 range. */
export function mulSat(a: number, b: number): Int32 {
  return clampI32((a | 0) * (b | 0));
}
/** ToUint32(a) + ToUint32(b), clamped to the uint32 range. */
export function addSatU(a: number, b: number): Uint32 {
  return clampU32((a >>> 0) + (b >>> 0));
}
/** ToUint32(a) - ToUint32(b), clamped at 0. */
export function subSatU(a: number, b: number): Uint32 {
  return clampU32((a >>> 0) - (b >>> 0));
}
/** ToUint32(a) * ToUint32(b), clamped to the uint32 range. */
export function mulSatU(a: number, b: number): Uint32 {
  return clampU32((a >>> 0) * (b >>> 0));
}

/* Narrowing: the value's low bits, as the type reads them. Each result is a
 * value of its contract type by construction. */
export function toInt8(x: number): Int8 {
  return (x << 24) >> 24;
}
export function toUint8(x: number): Uint8 {
  return x & 0xff;
}
export function toInt16(x: number): Int16 {
  return (x << 16) >> 16;
}
export function toUint16(x: number): Uint16 {
  return x & 0xffff;
}
export function toInt32(x: number): Int32 {
  return x | 0;
}
export function toUint32(x: number): Uint32 {
  return x >>> 0;
}

/* ── 64-bit ───────────────────────────────────────────────────────────── */

const MASK64 = 0xffffffffffffffffn;
const lo = (x: bigint): number => Number(x & 0xffffffffn);
const hi = (x: bigint): number => Number((x >> 32n) & 0xffffffffn);

/** BigInt.asIntN(64, x). */
export function toInt64(x: bigint): Int64 {
  return BigInt.asIntN(64, x);
}
/** BigInt.asUintN(64, x). */
export function toUint64(x: bigint): Uint64 {
  return BigInt.asUintN(64, x);
}
/** The low 32 bits of x, as an int32. */
export function lo32(x: bigint): Int32 {
  return lo(x) | 0;
}
/** Bits 32 to 63 of x, as an int32. */
export function hi32(x: bigint): Int32 {
  return hi(x) | 0;
}
/** The 64-bit value whose high and low halves are ToUint32(h) and ToUint32(l). */
export function join64(h: number, l: number): Uint64 {
  return (BigInt(h >>> 0) << 32n) | BigInt(l >>> 0);
}

/** Leading zero bits of the low 64 bits of x; 64 for 0. */
export function clz64(x: bigint): Int32 {
  const h = hi(x);
  return h !== 0 ? Math.clz32(h) : 32 + Math.clz32(lo(x));
}
/** Trailing zero bits of the low 64 bits of x; 64 for 0. */
export function ctz64(x: bigint): Int32 {
  const l = lo(x);
  return l !== 0 ? ctz(l) : 32 + ctz(hi(x));
}
/** Set bits of the low 64 bits of x. */
export function popcnt64(x: bigint): Int32 {
  return popcnt(hi(x)) + popcnt(lo(x));
}
/** The low 64 bits of x rotated left by n mod 64 bits. */
export function rotl64(x: bigint, n: number): Uint64 {
  const v = x & MASK64, s = BigInt(n & 63);
  return s === 0n ? v : ((v << s) | (v >> (64n - s))) & MASK64;
}
/** The low 64 bits of x rotated right by n mod 64 bits. */
export function rotr64(x: bigint, n: number): Uint64 {
  const v = x & MASK64, s = BigInt(n & 63);
  return s === 0n ? v : ((v >> s) | (v << (64n - s))) & MASK64;
}
/** The eight bytes of the low 64 bits of x in reverse order. */
export function bswap64(x: bigint): Uint64 {
  return (BigInt(bswap(lo(x)) >>> 0) << 32n) | BigInt(bswap(hi(x)) >>> 0);
}
/** The high 64 bits of the unsigned 128-bit product of the low 64 bits of a and b. */
export function mulhiU64(a: bigint, b: bigint): Uint64 {
  return ((a & MASK64) * (b & MASK64)) >> 64n;
}
/** The high 64 bits of the signed 128-bit product of BigInt.asIntN(64, a) and BigInt.asIntN(64, b). */
export function mulhi64(a: bigint, b: bigint): Int64 {
  return BigInt.asIntN(64, (BigInt.asIntN(64, a) * BigInt.asIntN(64, b)) >> 64n);
}
/** a + b modulo 2^64. */
export function addWrap64(a: bigint, b: bigint): Uint64 {
  return (a + b) & MASK64;
}
/** a - b modulo 2^64. */
export function subWrap64(a: bigint, b: bigint): Uint64 {
  return (a - b) & MASK64;
}
/** a * b modulo 2^64. */
export function mulWrap64(a: bigint, b: bigint): Uint64 {
  return ((a & MASK64) * (b & MASK64)) & MASK64;
}

const I64_MAX = 0x7fffffffffffffffn, I64_MIN = -0x8000000000000000n;
const clampI64 = (v: bigint): Int64 => (v > I64_MAX ? I64_MAX : v < I64_MIN ? I64_MIN : v);
const clampU64 = (v: bigint): Uint64 => (v > MASK64 ? MASK64 : v < 0n ? 0n : v);

/** asIntN(64, a) + asIntN(64, b), clamped to the int64 range. */
export function addSat64(a: bigint, b: bigint): Int64 {
  return clampI64(BigInt.asIntN(64, a) + BigInt.asIntN(64, b));
}
/** asIntN(64, a) - asIntN(64, b), clamped to the int64 range. */
export function subSat64(a: bigint, b: bigint): Int64 {
  return clampI64(BigInt.asIntN(64, a) - BigInt.asIntN(64, b));
}
/** asIntN(64, a) * asIntN(64, b), clamped to the int64 range. */
export function mulSat64(a: bigint, b: bigint): Int64 {
  return clampI64(BigInt.asIntN(64, a) * BigInt.asIntN(64, b));
}
/** asUintN(64, a) + asUintN(64, b), clamped to the uint64 range. */
export function addSatU64(a: bigint, b: bigint): Uint64 {
  return clampU64((a & MASK64) + (b & MASK64));
}
/** asUintN(64, a) - asUintN(64, b), clamped at 0. */
export function subSatU64(a: bigint, b: bigint): Uint64 {
  return clampU64((a & MASK64) - (b & MASK64));
}
/** asUintN(64, a) * asUintN(64, b), clamped to the uint64 range. */
export function mulSatU64(a: bigint, b: bigint): Uint64 {
  return clampU64((a & MASK64) * (b & MASK64));
}
