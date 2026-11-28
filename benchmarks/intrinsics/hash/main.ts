// xxHash32, xxHash64 and CRC-32 over a 4 MiB generated text corpus, written with the int intrinsic library: rotl,
// mulWrap and the 64-bit forms lower to i32/i64 instructions when compiled.
// Algorithms: xxHash by Yann Collet (reference implementation BSD-2-Clause, https://github.com/Cyan4973/xxHash);
// CRC-32 as in ISO-HDLC / zlib (table-driven, public domain technique). This port is original code, Apache-2.0.
import { addWrap, mulWrap, rotl, addWrap64, mulWrap64, rotl64, join64, toUint32 } from "../../../packages/intrinsics/int.ts";
import type { Int32, Uint32, Uint64 } from "../../../packages/intrinsics/int.ts";
import { textCorpus } from "../common/input.ts";

const P32_1 = 0x9e3779b1 | 0, P32_2 = 0x85ebca77 | 0, P32_3 = 0xc2b2ae3d | 0, P32_4 = 0x27d4eb2f | 0, P32_5 = 0x165667b1 | 0;
function u32le(b: Uint8Array, i: number): Int32 { return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24); }

export function xxh32(b: Uint8Array, seed: number): Uint32 {
  const len = b.length;
  let i = 0, h: Int32;
  if (len >= 16) {
    let v1: Int32 = addWrap(addWrap(seed, P32_1), P32_2), v2: Int32 = addWrap(seed, P32_2), v3: Int32 = seed | 0, v4: Int32 = addWrap(seed, -P32_1);
    for (; i + 16 <= len; i += 16) {
      v1 = mulWrap(rotl(addWrap(v1, mulWrap(u32le(b, i), P32_2)), 13), P32_1);
      v2 = mulWrap(rotl(addWrap(v2, mulWrap(u32le(b, i + 4), P32_2)), 13), P32_1);
      v3 = mulWrap(rotl(addWrap(v3, mulWrap(u32le(b, i + 8), P32_2)), 13), P32_1);
      v4 = mulWrap(rotl(addWrap(v4, mulWrap(u32le(b, i + 12), P32_2)), 13), P32_1);
    }
    h = addWrap(addWrap(rotl(v1, 1), rotl(v2, 7)), addWrap(rotl(v3, 12), rotl(v4, 18)));
  } else h = addWrap(seed, P32_5);
  h = addWrap(h, len);
  for (; i + 4 <= len; i += 4) h = mulWrap(rotl(addWrap(h, mulWrap(u32le(b, i), P32_3)), 17), P32_4);
  for (; i < len; i++) h = mulWrap(rotl(addWrap(h, mulWrap(b[i]!, P32_5)), 11), P32_1);
  h = mulWrap(h ^ (h >>> 15), P32_2);
  h = mulWrap(h ^ (h >>> 13), P32_3);
  return toUint32(h ^ (h >>> 16));
}

const P64_1 = 0x9e3779b185ebca87n, P64_2 = 0xc2b2ae3d27d4eb4fn, P64_3 = 0x165667b19e3779f9n, P64_4 = 0x85ebca77c2b2ae63n, P64_5 = 0x27d4eb2f165667c5n;
function u64le(b: Uint8Array, i: number): Uint64 { return join64(u32le(b, i + 4), u32le(b, i)); }
function round64(acc: bigint, lane: bigint): Uint64 { return mulWrap64(rotl64(addWrap64(acc, mulWrap64(lane, P64_2)), 31), P64_1); }
function merge64(acc: bigint, v: bigint): Uint64 { return addWrap64(mulWrap64(acc ^ round64(0n, v), P64_1), P64_4); }

export function xxh64(b: Uint8Array, seed: bigint): Uint64 {
  const len = b.length;
  let i = 0, h: Uint64;
  if (len >= 32) {
    let v1: Uint64 = addWrap64(addWrap64(seed, P64_1), P64_2), v2: Uint64 = addWrap64(seed, P64_2), v3: Uint64 = addWrap64(seed, 0n), v4: Uint64 = addWrap64(seed, -P64_1);
    for (; i + 32 <= len; i += 32) {
      v1 = round64(v1, u64le(b, i)); v2 = round64(v2, u64le(b, i + 8));
      v3 = round64(v3, u64le(b, i + 16)); v4 = round64(v4, u64le(b, i + 24));
    }
    h = addWrap64(addWrap64(rotl64(v1, 1), rotl64(v2, 7)), addWrap64(rotl64(v3, 12), rotl64(v4, 18)));
    h = merge64(h, v1); h = merge64(h, v2); h = merge64(h, v3); h = merge64(h, v4);
  } else h = addWrap64(seed, P64_5);
  h = addWrap64(h, BigInt(len));
  for (; i + 8 <= len; i += 8) h = addWrap64(mulWrap64(rotl64(h ^ round64(0n, u64le(b, i)), 27), P64_1), P64_4);
  if (i + 4 <= len) { h = addWrap64(mulWrap64(rotl64(h ^ mulWrap64(join64(0, u32le(b, i)), P64_1), 23), P64_2), P64_3); i += 4; }
  for (; i < len; i++) h = mulWrap64(rotl64(h ^ mulWrap64(BigInt(b[i]!), P64_5), 11), P64_1);
  h = mulWrap64(h ^ (h >> 33n), P64_2);
  h = mulWrap64(h ^ (h >> 29n), P64_3);
  return h ^ (h >> 32n);
}

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
export function crc32(b: Uint8Array): Uint32 {
  let c: Int32 = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return toUint32(c ^ -1);
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
