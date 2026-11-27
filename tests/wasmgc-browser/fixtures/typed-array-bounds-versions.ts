// Typed-array accesses at a stable base plus bounded offsets (`out[offset + c * 4 + 1]`, `m[k + 3]`, `a[15]`) run
// behind one guard per array and base that every index is in range; when the guard fails the statements run as
// they are. Both outcomes must read and write exactly what Node does: in range, partly out of range (undefined
// reads, ignored writes), negative, fractional, NaN, -0 and huge offsets, short arrays, an array that is both input
// and output, early returns, union arms, a base the body writes, and a temporary read after the guarded statements.
type Mat = Float32Array | Float64Array;

function multiply(a: Mat, b: Mat, out: Mat, offset: number): void {
  const a00 = a[0]!, a01 = a[1]!, a10 = a[4]!, a11 = a[5]!;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]!, b1 = b[c * 4 + 1]!;
    out[offset + c * 4] = b0 * a00 + b1 * a10;
    out[offset + c * 4 + 1] = b0 * a01 + b1 * a11;
  }
}
function sum4(m: Float32Array, k: number): number { return m[k]! + m[k + 1]! + m[k + 2]! + m[k + 3]!; }
function window(m: Float64Array, k: number): string {
  if (k > 100) return "far";
  const lo = m[k - 1], mid = m[k], hi = m[k + 1];
  if (mid === undefined) return `none ${lo} ${hi}`;
  return `${lo} ${mid} ${hi}`;
}
function fill(m: Uint8Array, k: number, v: number): number {
  const base = k * 2;
  m[base] = v; m[base + 1] = v + 1; m[base + 2] = v + 2; m[base + 3] = 300;
  let t = 0;
  t = m[base]! + m[base + 3]!;
  return t;
}
function moved(m: Int16Array, k: number): number {
  let s = m[k]! + m[k + 1]! + m[k + 2]!;
  k = k + 1;
  return s + m[k]! + m[k + 1]! + m[k + 2]!;
}
function later(m: Float32Array, k: number): number {
  let seen = 0;
  if (k >= 0) { var tail: number | undefined = m[k]! + m[k + 1]! + m[k + 2]!; seen = tail; }
  return seen + (tail ?? -1);
}

// Terms past int32 whose difference is a small offset: the index composes from their exact ToInt32 (mod 2^32).
function wide(m: Float32Array, x: number, k: number): number {
  const a = 4294967296 + (k & 3), b = 4294967296;
  return m[x + a - b]! * 100 + m[x + 1]! * 10 + m[x + 2]!;
}

const show = (m: Mat): string => { const p: string[] = []; for (let i = 0; i < m.length; i++) p.push(String(m[i])); return p.join(","); };
const f = (n: number, s = 1) => { const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (i + 1) * s * 0.5; return m; };
const d = (n: number, s = 1) => { const m = new Float64Array(n); for (let i = 0; i < n; i++) m[i] = (i + 1) * s * 0.25; return m; };

for (const offset of [0, 2, 4, 5, -1, 0.5, NaN, -0, 2 ** 31, 1e300]) {
  const out = new Float32Array(20);
  multiply(f(16), d(16, 2), out, offset);
  console.log("mul", offset, show(out));
}
const short = new Float64Array(6);
multiply(d(16), f(4), short, 0);
console.log("short", show(short));
const same = f(16);
multiply(same, same, same, 0);
console.log("alias", show(same));
const m32 = f(10);
for (const k of [0, 6, 7, -1, 1.5, NaN, 8, 2147483647]) console.log("sum4", k, sum4(m32, k));
const m64 = d(5);
for (const k of [1, 0, 4, 5, 101, -0, 2.5]) console.log("window", k, window(m64, k));
const u8 = new Uint8Array(9);
for (const k of [0, 2, 3, 4, -1]) console.log("fill", k, fill(u8, k, 250), show(new Float64Array(u8)));
const i16 = new Int16Array([1, 2, 3, 4, 5, 6]);
for (const k of [0, 2, 3, 4]) console.log("moved", k, moved(i16, k));
for (const k of [0, 8, -1]) console.log("later", k, later(m32, k));
for (const k of [0, 1, 2, 3, 7]) console.log("wide", k, wide(f(8), 2, k), wide(f(8), 5, k));
