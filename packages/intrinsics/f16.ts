/* @scriptc-intrinsics f16/1 */
/* Float16 (IEEE binary16) storage: conversion to and from 16-bit patterns,
 * DataView access and bulk packing.
 *
 * This file's conversions are exact software: round to nearest, ties to
 * even, straight from the double (no rounding through float32), NaN stored as
 * the canonical 0x7e00. scriptc compiles them as written on WasmGC (WebAssembly
 * has no shipped f16 arithmetic, so values are converted at load and store and
 * computed as f64) and lowers them natively to the runtime's binary16
 * conversion. The plain-JavaScript entry of the package (f16.engine.mjs)
 * uses the engine's Math.f16round and DataView float16 methods where they
 * exist (Chrome 135, Firefox 129, Safari 18.2) and this code elsewhere; the
 * results are identical. */

import type { Uint16 } from "./int.ts";

/** Which conversion this module uses: "software" here; the JavaScript entry reports "engine" when the engine has one. */
export const F16_PATH: "software" | "engine" = "software";

const WORDS = new Float64Array(1);
const HALVES = new Int32Array(WORDS.buffer);
const HI = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 1 : 0;

/** Round half to even of a non-negative double below 2^31. */
function rint(v: number): number {
  const f = Math.floor(v), d = v - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
}

/** The binary16 bit pattern nearest to x (ties to even); NaN gives 0x7e00. */
export function toF16Bits(x: number): Uint16 {
  if (x !== x) return 0x7e00;
  WORDS[0] = x;
  const sign = (HALVES[HI]! >>> 16) & 0x8000;
  const a = Math.abs(x);
  if (a >= 65520) return sign | 0x7c00;
  if (a < 6.103515625e-5) return sign | rint(a * 16777216);
  const e = ((HALVES[HI]! >>> 20) & 0x7ff) - 1023;
  let q = rint((a / Math.pow(2, e) - 1) * 1024);
  let biased = e + 15;
  if (q === 1024) { q = 0; biased++; }
  return biased >= 31 ? sign | 0x7c00 : sign | (biased << 10) | q;
}

/** The value of a binary16 bit pattern (its low 16 bits). */
export function fromF16Bits(h: number): number {
  const exponent = (h >>> 10) & 0x1f, fraction = h & 0x3ff;
  const sign = h & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * fraction * 5.960464477539063e-8;
  if (exponent === 31) return fraction === 0 ? sign * Infinity : NaN;
  return sign * (1024 + fraction) * Math.pow(2, exponent - 25);
}

/** x rounded to the nearest binary16 value (Math.f16round). */
export function f16round(x: number): number {
  return fromF16Bits(toF16Bits(x));
}

/** DataView.prototype.getFloat16. */
export function getFloat16(view: DataView, byteOffset: number, littleEndian = false): number {
  return fromF16Bits(view.getUint16(byteOffset, littleEndian));
}
/** DataView.prototype.setFloat16. */
export function setFloat16(view: DataView, byteOffset: number, value: number, littleEndian = false): void {
  view.setUint16(byteOffset, toF16Bits(value), littleEndian);
}

/** Stores `count` values of src (from srcStart) into dst (from dstStart) as binary16 patterns. */
export function packF16(src: Float32Array | Float64Array | number[], dst: Uint16Array, srcStart = 0, dstStart = 0, count = src.length - srcStart): void {
  for (let i = 0; i < count; i++) dst[dstStart + i] = toF16Bits(src[srcStart + i]!);
}
/** Reads `count` binary16 patterns of src (from srcStart) into dst (from dstStart). */
export function unpackF16(src: Uint16Array, dst: Float32Array | Float64Array, srcStart = 0, dstStart = 0, count = src.length - srcStart): void {
  for (let i = 0; i < count; i++) dst[dstStart + i] = fromF16Bits(src[srcStart + i]!);
}
