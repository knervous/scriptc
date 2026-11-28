// xxHash32, xxHash64 and CRC-32 over a 4 MiB generated text corpus, in plain TypeScript (the JS lane's reference).
// Algorithms: xxHash by Yann Collet (reference implementation BSD-2-Clause, https://github.com/Cyan4973/xxHash);
// CRC-32 as in ISO-HDLC / zlib (table-driven, public domain technique). This port is original code, Apache-2.0.
import { textCorpus } from "../common/input.ts";

const P32_1 = 0x9e3779b1 | 0, P32_2 = 0x85ebca77 | 0, P32_3 = 0xc2b2ae3d | 0, P32_4 = 0x27d4eb2f | 0, P32_5 = 0x165667b1 | 0;
const rotl32 = (x: number, r: number): number => (x << r) | (x >>> (32 - r));
const u32le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24);

export function xxh32(b: Uint8Array, seed: number): number {
  const len = b.length;
  let i = 0, h: number;
  if (len >= 16) {
    let v1 = (seed + P32_1 + P32_2) | 0, v2 = (seed + P32_2) | 0, v3 = seed | 0, v4 = (seed - P32_1) | 0;
    for (; i + 16 <= len; i += 16) {
      v1 = Math.imul(rotl32((v1 + Math.imul(u32le(b, i), P32_2)) | 0, 13), P32_1);
      v2 = Math.imul(rotl32((v2 + Math.imul(u32le(b, i + 4), P32_2)) | 0, 13), P32_1);
      v3 = Math.imul(rotl32((v3 + Math.imul(u32le(b, i + 8), P32_2)) | 0, 13), P32_1);
      v4 = Math.imul(rotl32((v4 + Math.imul(u32le(b, i + 12), P32_2)) | 0, 13), P32_1);
    }
    h = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) | 0;
  } else h = (seed + P32_5) | 0;
  h = (h + len) | 0;
  for (; i + 4 <= len; i += 4) h = Math.imul(rotl32((h + Math.imul(u32le(b, i), P32_3)) | 0, 17), P32_4);
  for (; i < len; i++) h = Math.imul(rotl32((h + Math.imul(b[i]!, P32_5)) | 0, 11), P32_1);
  h = Math.imul(h ^ (h >>> 15), P32_2);
  h = Math.imul(h ^ (h >>> 13), P32_3);
  return (h ^ (h >>> 16)) >>> 0;
}

const M = 0xffffffffffffffffn;
const P64_1 = 0x9e3779b185ebca87n, P64_2 = 0xc2b2ae3d27d4eb4fn, P64_3 = 0x165667b19e3779f9n, P64_4 = 0x85ebca77c2b2ae63n, P64_5 = 0x27d4eb2f165667c5n;
const rotl64 = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (64n - r))) & M;
const u64le = (b: Uint8Array, i: number): bigint => (BigInt(u32le(b, i + 4) >>> 0) << 32n) | BigInt(u32le(b, i) >>> 0);
const round64 = (acc: bigint, lane: bigint): bigint => (rotl64((acc + lane * P64_2) & M, 31n) * P64_1) & M;
const merge64 = (acc: bigint, v: bigint): bigint => (((acc ^ round64(0n, v)) * P64_1 + P64_4) & M);

export function xxh64(b: Uint8Array, seed: bigint): bigint {
  const len = b.length;
  let i = 0, h: bigint;
  if (len >= 32) {
    let v1 = (seed + P64_1 + P64_2) & M, v2 = (seed + P64_2) & M, v3 = seed & M, v4 = (seed - P64_1) & M;
    for (; i + 32 <= len; i += 32) {
      v1 = round64(v1, u64le(b, i)); v2 = round64(v2, u64le(b, i + 8));
      v3 = round64(v3, u64le(b, i + 16)); v4 = round64(v4, u64le(b, i + 24));
    }
    h = (rotl64(v1, 1n) + rotl64(v2, 7n) + rotl64(v3, 12n) + rotl64(v4, 18n)) & M;
    h = merge64(h, v1); h = merge64(h, v2); h = merge64(h, v3); h = merge64(h, v4);
  } else h = (seed + P64_5) & M;
  h = (h + BigInt(len)) & M;
  for (; i + 8 <= len; i += 8) h = ((rotl64(h ^ round64(0n, u64le(b, i)), 27n) * P64_1 + P64_4) & M);
  if (i + 4 <= len) { h = ((rotl64(h ^ ((BigInt(u32le(b, i) >>> 0) * P64_1) & M), 23n) * P64_2 + P64_3) & M); i += 4; }
  for (; i < len; i++) h = (rotl64(h ^ ((BigInt(b[i]!) * P64_5) & M), 11n) * P64_1) & M;
  h = ((h ^ (h >> 33n)) * P64_2) & M;
  h = ((h ^ (h >> 29n)) * P64_3) & M;
  return h ^ (h >> 32n);
}

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
export function crc32(b: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const corpus = textCorpus(4 << 20, 1);
const small = corpus.subarray(0, 64 << 10);
let a = 0, c = 0, b = 0n;
const t0 = performance.now();
for (let r = 0; r < 8; r++) a = xxh32(corpus, r);
const t1 = performance.now();
for (let r = 0; r < 8; r++) c = crc32(corpus);
const t2 = performance.now();
for (let r = 0; r < 4; r++) b = xxh64(small, BigInt(r));
const t3 = performance.now();
console.log("xxh32", a, "crc32", c, "xxh64", b.toString(16));
console.log("xxh32 of 'abc'", xxh32(new Uint8Array([97, 98, 99]), 0), "xxh64 of 'abc'", xxh64(new Uint8Array([97, 98, 99]), 0n).toString(16));
console.log(`time.xxh32 ${(t1 - t0).toFixed(1)}`);
console.log(`time.crc32 ${(t2 - t1).toFixed(1)}`);
console.log(`time.xxh64 ${(t3 - t2).toFixed(1)}`);
console.log(`time ${(t3 - t0).toFixed(1)}`);
