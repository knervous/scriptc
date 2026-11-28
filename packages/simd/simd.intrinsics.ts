/* @scriptc-intrinsics simd/1 */
/* Wasm SIMD for TypeScript: AssemblyScript's names over a scalar fallback.
 *
 * Under Node, tests and unbundled dev builds this file runs as written: a
 * v128 is 16 little-endian bytes and every operation is computed lane by
 * lane with the exact IEEE single/integer semantics of the Wasm instruction.
 * When the WasmGC backend compiles a program that imports it (recognised by
 * the file name `simd.intrinsics.ts`), the bodies below are never compiled:
 * v128 becomes the native Wasm `v128` value type and each method becomes its
 * SIMD instruction.
 *
 * Contract (enforced by the backend at compile time):
 * - v128 values are immutable and have no identity: no `===`, no fields.
 * - Lane indices and shift-free shuffle/swizzle patterns are constant
 *   integer literals.
 * - `relaxed_*` operations lower to their deterministic non-relaxed form
 *   unless a build opts into Relaxed SIMD, so results match this fallback.
 * - NaN payloads/signs are not specified (the Wasm rule): observe NaN with
 *   `x !== x`, not by bit pattern.
 */

const F32_LANES = 4;

export class v128 {
  private readonly lanes: Uint8Array;
  private constructor(lanes: Uint8Array) { this.lanes = lanes; }
  /** @internal fallback storage. */
  static fromBytes(bytes: Uint8Array): v128 { return new v128(bytes); }
  /** @internal fallback storage. */
  raw(): Uint8Array { return this.lanes; }

  static zero(): v128 { return new v128(new Uint8Array(16)); }
  /** Four f32 elements starting at element `index`. */
  static load(src: Float32Array, index: number): v128 {
    const out = new Uint8Array(16), view = new DataView(out.buffer);
    for (let i = 0; i < F32_LANES; i++) view.setFloat32(i * 4, src[index + i], true);
    return new v128(out);
  }
  static store(dst: Float32Array, index: number, value: v128): void {
    const view = new DataView(value.lanes.buffer);
    for (let i = 0; i < F32_LANES; i++) dst[index + i] = view.getFloat32(i * 4, true);
  }
  /** Four i32 elements starting at element `index`. */
  static loadI32(src: Int32Array, index: number): v128 {
    const out = new Uint8Array(16), view = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) view.setInt32(i * 4, src[index + i], true);
    return new v128(out);
  }
  static storeI32(dst: Int32Array, index: number, value: v128): void {
    const view = new DataView(value.lanes.buffer);
    for (let i = 0; i < 4; i++) dst[index + i] = view.getInt32(i * 4, true);
  }
  /** Sixteen bytes starting at `byteOffset`. */
  static loadU8(src: Uint8Array, byteOffset: number): v128 {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = src[byteOffset + i];
    return new v128(out);
  }
  static storeU8(dst: Uint8Array, byteOffset: number, value: v128): void {
    for (let i = 0; i < 16; i++) dst[byteOffset + i] = value.lanes[i];
  }

  static and(a: v128, b: v128): v128 { const o = new Uint8Array(16); for (let i = 0; i < 16; i++) o[i] = a.lanes[i] & b.lanes[i]; return new v128(o); }
  static or(a: v128, b: v128): v128 { const o = new Uint8Array(16); for (let i = 0; i < 16; i++) o[i] = a.lanes[i] | b.lanes[i]; return new v128(o); }
  static xor(a: v128, b: v128): v128 { const o = new Uint8Array(16); for (let i = 0; i < 16; i++) o[i] = a.lanes[i] ^ b.lanes[i]; return new v128(o); }
  static andnot(a: v128, b: v128): v128 { const o = new Uint8Array(16); for (let i = 0; i < 16; i++) o[i] = a.lanes[i] & ~b.lanes[i]; return new v128(o); }
  static not(a: v128): v128 { const o = new Uint8Array(16); for (let i = 0; i < 16; i++) o[i] = ~a.lanes[i]; return new v128(o); }
  /** Bits of `a` where `mask` is set, of `b` elsewhere. */
  static bitselect(a: v128, b: v128, mask: v128): v128 {
    const o = new Uint8Array(16);
    for (let i = 0; i < 16; i++) o[i] = (a.lanes[i] & mask.lanes[i]) | (b.lanes[i] & ~mask.lanes[i]);
    return new v128(o);
  }
  static any_true(a: v128): boolean { for (let i = 0; i < 16; i++) if (a.lanes[i] !== 0) return true; return false; }
}

/* Lane access on the fallback's bytes. */
function f32(v: v128, lane: number): number { return new DataView(v.raw().buffer).getFloat32(lane * 4, true); }
function i32(v: v128, lane: number): number { return new DataView(v.raw().buffer).getInt32(lane * 4, true); }
function u32(v: v128, lane: number): number { return new DataView(v.raw().buffer).getUint32(lane * 4, true); }
function fromF32(a: number, b: number, c: number, d: number): v128 {
  const out = new Uint8Array(16), view = new DataView(out.buffer);
  view.setFloat32(0, a, true); view.setFloat32(4, b, true); view.setFloat32(8, c, true); view.setFloat32(12, d, true);
  return v128.fromBytes(out);
}
function fromI32(a: number, b: number, c: number, d: number): v128 {
  const out = new Uint8Array(16), view = new DataView(out.buffer);
  view.setInt32(0, a, true); view.setInt32(4, b, true); view.setInt32(8, c, true); view.setInt32(12, d, true);
  return v128.fromBytes(out);
}
const MASK = -1;
/** IEEE roundTiesToEven on a float (f32x4.nearest). */
function nearest(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return x;
  const r = Math.round(x);
  const fixed = r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
  return fixed === 0 ? (x < 0 || Object.is(x, -0) ? -0 : 0) : fixed;
}
/** Saturating f32 → i32 truncation (i32x4.trunc_sat_f32x4_s). */
function truncSat(x: number): number {
  if (x !== x) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return Math.trunc(x) | 0;
}

export class f32x4 {
  static of(a: number, b: number, c: number, d: number): v128 { return fromF32(a, b, c, d); }
  static splat(x: number): v128 { return fromF32(x, x, x, x); }
  static extract_lane(v: v128, lane: number): number { return f32(v, lane); }
  static replace_lane(v: v128, lane: number, x: number): v128 {
    return fromF32(lane === 0 ? x : f32(v, 0), lane === 1 ? x : f32(v, 1), lane === 2 ? x : f32(v, 2), lane === 3 ? x : f32(v, 3));
  }
  static add(a: v128, b: v128): v128 { return fromF32(f32(a, 0) + f32(b, 0), f32(a, 1) + f32(b, 1), f32(a, 2) + f32(b, 2), f32(a, 3) + f32(b, 3)); }
  static sub(a: v128, b: v128): v128 { return fromF32(f32(a, 0) - f32(b, 0), f32(a, 1) - f32(b, 1), f32(a, 2) - f32(b, 2), f32(a, 3) - f32(b, 3)); }
  static mul(a: v128, b: v128): v128 { return fromF32(f32(a, 0) * f32(b, 0), f32(a, 1) * f32(b, 1), f32(a, 2) * f32(b, 2), f32(a, 3) * f32(b, 3)); }
  static div(a: v128, b: v128): v128 { return fromF32(f32(a, 0) / f32(b, 0), f32(a, 1) / f32(b, 1), f32(a, 2) / f32(b, 2), f32(a, 3) / f32(b, 3)); }
  static min(a: v128, b: v128): v128 { return fromF32(Math.min(f32(a, 0), f32(b, 0)), Math.min(f32(a, 1), f32(b, 1)), Math.min(f32(a, 2), f32(b, 2)), Math.min(f32(a, 3), f32(b, 3))); }
  static max(a: v128, b: v128): v128 { return fromF32(Math.max(f32(a, 0), f32(b, 0)), Math.max(f32(a, 1), f32(b, 1)), Math.max(f32(a, 2), f32(b, 2)), Math.max(f32(a, 3), f32(b, 3))); }
  static abs(a: v128): v128 { return fromF32(Math.abs(f32(a, 0)), Math.abs(f32(a, 1)), Math.abs(f32(a, 2)), Math.abs(f32(a, 3))); }
  static neg(a: v128): v128 { return fromF32(-f32(a, 0), -f32(a, 1), -f32(a, 2), -f32(a, 3)); }
  static sqrt(a: v128): v128 { return fromF32(Math.sqrt(f32(a, 0)), Math.sqrt(f32(a, 1)), Math.sqrt(f32(a, 2)), Math.sqrt(f32(a, 3))); }
  static ceil(a: v128): v128 { return fromF32(Math.ceil(f32(a, 0)), Math.ceil(f32(a, 1)), Math.ceil(f32(a, 2)), Math.ceil(f32(a, 3))); }
  static floor(a: v128): v128 { return fromF32(Math.floor(f32(a, 0)), Math.floor(f32(a, 1)), Math.floor(f32(a, 2)), Math.floor(f32(a, 3))); }
  static trunc(a: v128): v128 { return fromF32(Math.trunc(f32(a, 0)), Math.trunc(f32(a, 1)), Math.trunc(f32(a, 2)), Math.trunc(f32(a, 3))); }
  static nearest(a: v128): v128 { return fromF32(nearest(f32(a, 0)), nearest(f32(a, 1)), nearest(f32(a, 2)), nearest(f32(a, 3))); }
  /** a * b + c. Deterministic (unfused) unless the build opts into Relaxed SIMD. */
  static relaxed_madd(a: v128, b: v128, c: v128): v128 { return f32x4.add(f32x4.mul(a, b), c); }
  static relaxed_nmadd(a: v128, b: v128, c: v128): v128 { return f32x4.sub(c, f32x4.mul(a, b)); }
  static eq(a: v128, b: v128): v128 { return fromI32(f32(a, 0) === f32(b, 0) ? MASK : 0, f32(a, 1) === f32(b, 1) ? MASK : 0, f32(a, 2) === f32(b, 2) ? MASK : 0, f32(a, 3) === f32(b, 3) ? MASK : 0); }
  static ne(a: v128, b: v128): v128 { return fromI32(f32(a, 0) !== f32(b, 0) ? MASK : 0, f32(a, 1) !== f32(b, 1) ? MASK : 0, f32(a, 2) !== f32(b, 2) ? MASK : 0, f32(a, 3) !== f32(b, 3) ? MASK : 0); }
  static lt(a: v128, b: v128): v128 { return fromI32(f32(a, 0) < f32(b, 0) ? MASK : 0, f32(a, 1) < f32(b, 1) ? MASK : 0, f32(a, 2) < f32(b, 2) ? MASK : 0, f32(a, 3) < f32(b, 3) ? MASK : 0); }
  static le(a: v128, b: v128): v128 { return fromI32(f32(a, 0) <= f32(b, 0) ? MASK : 0, f32(a, 1) <= f32(b, 1) ? MASK : 0, f32(a, 2) <= f32(b, 2) ? MASK : 0, f32(a, 3) <= f32(b, 3) ? MASK : 0); }
  static gt(a: v128, b: v128): v128 { return fromI32(f32(a, 0) > f32(b, 0) ? MASK : 0, f32(a, 1) > f32(b, 1) ? MASK : 0, f32(a, 2) > f32(b, 2) ? MASK : 0, f32(a, 3) > f32(b, 3) ? MASK : 0); }
  static ge(a: v128, b: v128): v128 { return fromI32(f32(a, 0) >= f32(b, 0) ? MASK : 0, f32(a, 1) >= f32(b, 1) ? MASK : 0, f32(a, 2) >= f32(b, 2) ? MASK : 0, f32(a, 3) >= f32(b, 3) ? MASK : 0); }
  static convert_i32x4_s(a: v128): v128 { return fromF32(i32(a, 0), i32(a, 1), i32(a, 2), i32(a, 3)); }
  static convert_i32x4_u(a: v128): v128 { return fromF32(u32(a, 0), u32(a, 1), u32(a, 2), u32(a, 3)); }
}

export class i32x4 {
  static of(a: number, b: number, c: number, d: number): v128 { return fromI32(a, b, c, d); }
  static splat(x: number): v128 { return fromI32(x, x, x, x); }
  static extract_lane(v: v128, lane: number): number { return i32(v, lane); }
  static replace_lane(v: v128, lane: number, x: number): v128 {
    return fromI32(lane === 0 ? x : i32(v, 0), lane === 1 ? x : i32(v, 1), lane === 2 ? x : i32(v, 2), lane === 3 ? x : i32(v, 3));
  }
  static add(a: v128, b: v128): v128 { return fromI32(i32(a, 0) + i32(b, 0), i32(a, 1) + i32(b, 1), i32(a, 2) + i32(b, 2), i32(a, 3) + i32(b, 3)); }
  static sub(a: v128, b: v128): v128 { return fromI32(i32(a, 0) - i32(b, 0), i32(a, 1) - i32(b, 1), i32(a, 2) - i32(b, 2), i32(a, 3) - i32(b, 3)); }
  static mul(a: v128, b: v128): v128 { return fromI32(Math.imul(i32(a, 0), i32(b, 0)), Math.imul(i32(a, 1), i32(b, 1)), Math.imul(i32(a, 2), i32(b, 2)), Math.imul(i32(a, 3), i32(b, 3))); }
  static min_s(a: v128, b: v128): v128 { return fromI32(Math.min(i32(a, 0), i32(b, 0)), Math.min(i32(a, 1), i32(b, 1)), Math.min(i32(a, 2), i32(b, 2)), Math.min(i32(a, 3), i32(b, 3))); }
  static max_s(a: v128, b: v128): v128 { return fromI32(Math.max(i32(a, 0), i32(b, 0)), Math.max(i32(a, 1), i32(b, 1)), Math.max(i32(a, 2), i32(b, 2)), Math.max(i32(a, 3), i32(b, 3))); }
  static shl(a: v128, count: number): v128 { const n = count & 31; return fromI32(i32(a, 0) << n, i32(a, 1) << n, i32(a, 2) << n, i32(a, 3) << n); }
  static shr_s(a: v128, count: number): v128 { const n = count & 31; return fromI32(i32(a, 0) >> n, i32(a, 1) >> n, i32(a, 2) >> n, i32(a, 3) >> n); }
  static shr_u(a: v128, count: number): v128 { const n = count & 31; return fromI32(u32(a, 0) >>> n, u32(a, 1) >>> n, u32(a, 2) >>> n, u32(a, 3) >>> n); }
  static eq(a: v128, b: v128): v128 { return fromI32(i32(a, 0) === i32(b, 0) ? MASK : 0, i32(a, 1) === i32(b, 1) ? MASK : 0, i32(a, 2) === i32(b, 2) ? MASK : 0, i32(a, 3) === i32(b, 3) ? MASK : 0); }
  static lt_s(a: v128, b: v128): v128 { return fromI32(i32(a, 0) < i32(b, 0) ? MASK : 0, i32(a, 1) < i32(b, 1) ? MASK : 0, i32(a, 2) < i32(b, 2) ? MASK : 0, i32(a, 3) < i32(b, 3) ? MASK : 0); }
  static gt_s(a: v128, b: v128): v128 { return fromI32(i32(a, 0) > i32(b, 0) ? MASK : 0, i32(a, 1) > i32(b, 1) ? MASK : 0, i32(a, 2) > i32(b, 2) ? MASK : 0, i32(a, 3) > i32(b, 3) ? MASK : 0); }
  static trunc_sat_f32x4_s(a: v128): v128 { return fromI32(truncSat(f32(a, 0)), truncSat(f32(a, 1)), truncSat(f32(a, 2)), truncSat(f32(a, 3))); }
  static all_true(a: v128): boolean { return i32(a, 0) !== 0 && i32(a, 1) !== 0 && i32(a, 2) !== 0 && i32(a, 3) !== 0; }
  static bitmask(a: v128): number { return (i32(a, 0) < 0 ? 1 : 0) | (i32(a, 1) < 0 ? 2 : 0) | (i32(a, 2) < 0 ? 4 : 0) | (i32(a, 3) < 0 ? 8 : 0); }
}
