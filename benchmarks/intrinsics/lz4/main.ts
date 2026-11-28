// LZ4 block format, written with the int intrinsic library: a greedy compressor (hash table of 4-byte sequences) and the decompressor, over 2 MiB of generated
// text, compressed twice and decompressed eight times.
// Format: the LZ4 block format by Yann Collet (https://github.com/lz4/lz4, lz4_Block_format.md; reference
// implementation BSD-2-Clause). This port is original code, Apache-2.0.
import { ctz, mulWrap } from "../../../packages/intrinsics/int.ts";
import type { Int32 } from "../../../packages/intrinsics/int.ts";
import { textCorpus, fnv1a } from "../common/input.ts";

// helpers:begin: the int library's mulWrap for the hash, and ctz to extend a match four bytes at a time.
function read32(b: Uint8Array, i: number): Int32 { return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24); }
function hash4(v: number): Int32 { return mulWrap(v, -1640531535) >>> 20; }
/** Bytes that match from a and b, up to limit. */
function matchLength(s: Uint8Array, a: number, b: number, limit: number): number {
  let n = 0;
  while (b + n + 4 <= limit) {
    const x = read32(s, a + n) ^ read32(s, b + n);
    if (x !== 0) return n + (ctz(x) >>> 3);
    n += 4;
  }
  while (b + n < limit && s[a + n] === s[b + n]) n++;
  return n;
}
// helpers:end

const MIN_MATCH = 4, LAST_LITERALS = 5, MF_LIMIT = 12;

export function compress(src: Uint8Array, dst: Uint8Array): number {
  const table = new Int32Array(4096).fill(-1);
  const n = src.length;
  let ip = 0, anchor = 0, op = 0;
  const limit = n - LAST_LITERALS;
  while (ip < n - MF_LIMIT) {
    const seq = read32(src, ip), h = hash4(seq);
    const ref = table[h]!;
    table[h] = ip;
    if (ref < 0 || ip - ref > 65535 || read32(src, ref) !== seq) { ip++; continue; }
    const len = MIN_MATCH + matchLength(src, ref + MIN_MATCH, ip + MIN_MATCH, limit);
    const lit = ip - anchor, token = op++;
    let t = lit >= 15 ? 15 << 4 : lit << 4;
    if (lit >= 15) { let l = lit - 15; while (l >= 255) { dst[op++] = 255; l -= 255; } dst[op++] = l; }
    dst.set(src.subarray(anchor, ip), op); op += lit;
    const off = ip - ref;
    dst[op++] = off & 0xff; dst[op++] = off >>> 8;
    const ml = len - MIN_MATCH;
    if (ml >= 15) { t |= 15; let l = ml - 15; while (l >= 255) { dst[op++] = 255; l -= 255; } dst[op++] = l; } else t |= ml;
    dst[token] = t;
    ip += len; anchor = ip;
  }
  const lit = n - anchor;
  dst[op++] = lit >= 15 ? 15 << 4 : lit << 4;
  if (lit >= 15) { let l = lit - 15; while (l >= 255) { dst[op++] = 255; l -= 255; } dst[op++] = l; }
  dst.set(src.subarray(anchor, n), op);
  return op + lit;
}

export function decompress(src: Uint8Array, size: number, dst: Uint8Array): number {
  let ip = 0, op = 0;
  while (ip < size) {
    const token = src[ip++]!;
    let lit = token >>> 4;
    if (lit === 15) { let b = 255; while (b === 255) { b = src[ip++]!; lit += b; } }
    dst.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
    if (ip >= size) break;
    const off = src[ip]! | (src[ip + 1]! << 8);
    ip += 2;
    let len = token & 15;
    if (len === 15) { let b = 255; while (b === 255) { b = src[ip++]!; len += b; } }
    len += MIN_MATCH;
    let from = op - off;
    if (off >= len) { dst.copyWithin(op, from, from + len); op += len; }
    else for (const end = op + len; op < end;) dst[op++] = dst[from++]!;
  }
  return op;
}

const input = textCorpus(2 << 20, 3);
const packed = new Uint8Array(input.length + (input.length >> 6) + 64);
const output = new Uint8Array(input.length);
let size = 0, outSize = 0;
const t0 = performance.now();
for (let r = 0; r < 2; r++) size = compress(input, packed);
const t1 = performance.now();
for (let r = 0; r < 8; r++) outSize = decompress(packed, size, output);
const t2 = performance.now();
let same = outSize === input.length;
for (let i = 0; same && i < input.length; i++) if (input[i] !== output[i]) same = false;
console.log("lz4 bytes", size, "of", input.length, "packed", fnv1a(packed, size), "round trip", same ? "exact" : "DIFFERS");
console.log(`time.compress ${(t1 - t0).toFixed(1)}`);
console.log(`time.decompress ${(t2 - t1).toFixed(1)}`);
console.log(`time ${(t2 - t0).toFixed(1)}`);
