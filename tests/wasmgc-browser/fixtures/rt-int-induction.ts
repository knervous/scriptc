// Integer code shapes the runtime pass changed (agent RT, 10-28): a `for (i = 0; i < length; i++)` counter held as an
// int32 (array and typed-array lengths are below 2^31; the bound may change while the loop runs), and ToInt32 of an
// exact integer sum computed in i32 (`(acc + i) | 0`, `h * 31 + c`), with i64-shadowed counters guarded to ±2^52 and
// the f64 path past it (counters stepped by large amounts, overflow and back).
const i32 = new Int32Array(8);
let acc = 0;
for (let i = 0; i < i32.length; i++) { acc = (acc + i * 1000000007) | 0; i32[i] = acc; }
console.log("prefix", Array.from(i32).join(","));
const grow: number[] = [1, 2, 3];
let seen = 0;
for (let i = 0; i < grow.length; i++) { seen += grow[i]!; if (grow.length < 6) grow.push(i * 10); }
console.log("grow", seen, grow.length);
const shrink = [5, 6, 7, 8, 9];
const kept: number[] = [];
for (let i = 0; i < shrink.length; i++) { kept.push(shrink[i]!); shrink.pop(); }
console.log("shrink", kept.join(","), shrink.length);
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
console.log("hash", hash("abcdefghijklmnopqrstuvwxyz"), hash(""), hash("￿￿￿￿￿￿￿"));
function bigStep(): string {
  const out: number[] = [];
  let big = 0;
  for (let k = 0; k < 6; k++) { big = big + 2 ** 51; out.push((big + 3) | 0, (big - 1) | 0); }
  let back = 2 ** 60;
  back = back + 1;
  back = back - 2 ** 60;
  out.push((back + 5) | 0);
  return out.join(",");
}
console.log("big", bigStep());
function counters(n: number): string {
  let a = 0, b = 0;
  for (let j = 0; j < n; j += 3) { a = (a + j) | 0; b = (b - j * 7) | 0; }
  return `${a},${b}`;
}
console.log("counters", counters(100), counters(0), counters(7));
const after: number[] = [9, 9];
let last = -1;
for (let i = 0; i < after.length; i++) last = i;
let tail = 0;
for (let i = 2; i < after.length; i++) tail++;
console.log("after", last, tail);
function boundBy(n: number): number { const xs = new Float64Array(n); let s = 0; for (let i = 0; i < xs.length; i++) { xs[i] = i / 2; s += xs[i]!; } return s; }
console.log("float64", boundBy(10), boundBy(0));
let neg = 0;
for (let i = 0; i < -5; i++) neg++;
console.log("neg", neg);
