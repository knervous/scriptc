// Integer expressions the WasmGC backend proves int32 or uint32 from their ranges (ir/integer-ranges.ts), not their
// syntax: products and sums of bounded counters, masks times constants, remainders. They index typed arrays, pass
// to parameters that then take the i32 call ABI, and fill locals, and every one reads the same value Node does,
// including at the edges: products leaving int32, -0, past-the-end and negative indexes, uint32 values above 2^31.
const f32 = new Float32Array(128), u8 = new Uint8Array(320), i32 = new Int32Array(8);
for (let i = 0; i < 128; i++) f32[i] = i * 0.5;
for (let i = 0; i < 320; i++) u8[i] = i * 7;

function sumAt(m: Float32Array, k: number): number { return m[k]! + m[k + 1]! + m[k + 2]! + m[k + 3]!; }
function at(m: Uint8Array, k: number): number { return m[k]!; }
function scaled(k: number, s: number): number { return k * s; }

let total = 0;
for (let k = 0; k < 20; k++) total += sumAt(f32, k * 4) + sumAt(f32, (k & 7) * 8) + at(u8, k * 16 + 3);
console.log(total);
// Masks times constants, a remainder, and a product leaving int32 (the double is the value).
for (let k = 0; k < 4; k++) {
  const o = (k & 3) * 16, wide = (k + 1) * 1073741824, big = (k * 977) % 300, hi = (k + 1) * 0x40000000;
  console.log(o, wide, big, hi, at(u8, big), at(u8, wide), u8[(k & 1) * 299]!, f32[o + 15]!, f32[o - 1]);
}
// uint32 products above 2^31 stay unsigned; a negative factor can make -0, which is no integer.
for (let k = 1; k < 4; k++) {
  const u = (k & 0xffff) * 0x7fffffff, z = (k - 1) * -3, neg = -(k * 5);
  console.log(u, u >>> 0, u | 0, Object.is(z, -0), z, neg, i32[(k - 1) * 2]!, i32[neg]);
}
// The i32 call ABI: every call passes a bounded integer; one that passes a fraction keeps the double.
for (let k = 0; k < 3; k++) console.log(scaled(k * 3, 2), scaled((k & 1) + 1, 1.5));
// A counter past int32 through a while loop, and an index from a ternary of ranges.
let n = 2147483640, steps = 0;
while (n < 2147483650) { n += 3; steps++; }
console.log(n, steps, f32[steps > 2 ? (steps & 3) * 4 : 0]!);
