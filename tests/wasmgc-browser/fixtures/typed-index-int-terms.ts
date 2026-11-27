// Typed-array indices built from i32-narrowed loop counters (`o = n * 16`, `t = o; t += 4`, `t + 1`) compute exactly in
// i64: out-of-range sums (past 2^31, below 0, an unsigned >>> term near 2^32) read undefined and drop writes, as in Node.
const f = new Float32Array(64), u = new Uint8Array(8), i32 = new Int32Array(4);
for (let i = 0; i < f.length; i++) f[i] = i * 0.5;
const out: string[] = [];
let sum = 0;
for (let n = 0; n < 4; n++) {
  const o = n * 16;
  for (let t = o; t < o + 16; t += 4) sum += f[t]! + f[t + 1]! * 2 + f[t + 2]! * 3 + f[t + 3]! * 4;
}
out.push(String(sum));
for (let n = 0; n < 3; n++) { const o = n * 3; u[o + 1] = 200 + n; u[o + 7] = 9; }
out.push(Array.from(u).join(","));
let big = 0;
for (let k = 2147483640; k < 2147483647; k++) big = k;
out.push(String(f[big + 10]), String(f[big - 2147483600]), String(f[(big >>> 0) + 2147483647]));
let neg = 0;
for (let k = 0; k < 3; k++) { neg = k - 5; i32[neg + 4] = 7 + k; }
out.push(Array.from(i32).join(","), String(i32[neg + 1]), String(i32[neg + 2]));
let wide = 0;
for (let k = 0; k < 2; k++) wide = (k - 1) >>> 0;
out.push(String(wide), String(f[wide + 1]), String(f[(wide >>> 0) - 4294967290]));
console.log(out.join(" | "));
