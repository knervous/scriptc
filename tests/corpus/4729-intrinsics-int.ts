// The int intrinsic library (packages/intrinsics/int.ts): every 32- and 64-bit
// operation over edge values. Node runs the library's plain-JS bodies; compiled
// builds lower each call to integer instructions, and the outputs must match.
import { clz, ctz, popcnt, rotl, rotr, bswap, mulhi, mulhiU, addSat, subSat, mulSat, addSatU, subSatU, mulSatU, addWrap, toInt8, toUint16,
  clz64, ctz64, popcnt64, rotl64, rotr64, bswap64, mulhi64, mulhiU64, addWrap64, mulWrap64, subWrap64, addSat64, subSat64, mulSat64, addSatU64, subSatU64, mulSatU64, lo32, hi32, join64 } from "../../packages/intrinsics/int.ts";
const xs = [0, 1, -1, 2, 0x7fffffff, -0x80000000, 0xdeadbeef, 12345, -98765, 3.7, -0.5, 2 ** 40 + 3, 255, 256, 65535, 65536];
const out: string[] = [];
for (const a of xs) {
  out.push(`${clz(a)} ${ctz(a)} ${popcnt(a)} ${bswap(a)} ${toInt8(a)} ${toUint16(a)}`);
  for (const b of xs) out.push(`${rotl(a, b)} ${rotr(a, b)} ${mulhi(a, b)} ${mulhiU(a, b)} ${addSat(a, b)} ${subSat(a, b)} ${mulSat(a, b)} ${addSatU(a, b)} ${subSatU(a, b)} ${mulSatU(a, b)} ${addWrap(a, b)}`);
}
const bs = [0n, 1n, -1n, 2n, 0x7fffffffffffffffn, -0x8000000000000000n, 0xdeadbeefcafebaben, 123456789n, -987654321n, 1n << 63n, (1n << 64n) + 5n];
for (const a of bs) {
  out.push(`${clz64(a)} ${ctz64(a)} ${popcnt64(a)} ${bswap64(a)} ${lo32(a)} ${hi32(a)} ${rotl64(a, 13)} ${rotr64(a, 7)} ${rotl64(a, 0)}`);
  for (const b of bs) out.push(`${mulhi64(a, b)} ${mulhiU64(a, b)} ${addWrap64(a, b)} ${subWrap64(a, b)} ${mulWrap64(a, b)} ${addSat64(a, b)} ${subSat64(a, b)} ${mulSat64(a, b)} ${addSatU64(a, b)} ${subSatU64(a, b)} ${mulSatU64(a, b)}`);
}
out.push(`${join64(0xdeadbeef, -1)} ${mulWrap64(addWrap64(0xffffffffffffffffn, 2n), 0x9E3779B97F4A7C15n)}`);
let h = 0;
for (const line of out) for (let i = 0; i < line.length; i++) h = Math.imul(h ^ line.charCodeAt(i), 16777619);
console.log(out.length, h);
for (let i = 0; i < out.length; i += 37) console.log(out[i]);
console.log(out.at(-1));
