// Functions over never-reassigned union parameters (matrix helpers over `Float32Array | Float64Array`) run a
// copy of their body per arm: one parameter, several parameters that hold the same arm, and the mixed case the
// copies do not cover (the body as it is). Parameters the body writes, closures, and bodies that only read a
// length keep the per-read dispatch. All of them read and write the same values as before.
type Mat = Float32Array | Float64Array;

function sum4(m: Mat, k: number): number { return m[k]! + m[k + 1]! + m[k + 2]! + m[k + 3]!; }
function multiply(a: Mat, b: Mat, out: Mat, offset: number): void {
  const a00 = a[0]!, a01 = a[1]!, a10 = a[2]!, a11 = a[3]!;
  for (let c = 0; c < 2; c++) {
    const b0 = b[c * 2]!, b1 = b[c * 2 + 1]!;
    out[offset + c * 2] = b0 * a00 + b1 * a10;
    out[offset + c * 2 + 1] = b0 * a01 + b1 * a11;
  }
}
function compose(tx: number, ty: number, s: number, out: Mat, offset: number): void {
  out[offset] = s; out[offset + 1] = 0; out[offset + 2] = tx;
  out[offset + 3] = 0; out[offset + 4] = s; out[offset + 5] = ty;
}
function rewritten(m: Mat, n: Mat): number {
  let s = m[0]!;
  m = n;
  return s + m[0]! + m[1]!;
}
function captured(m: Mat): number {
  const read = (i: number) => m[i]!;
  return read(0) + m[1]! + m[2]!;
}
function lengthOnly(m: Mat, n: Mat): number { return m.length * 10 + n.length; }
function early(m: Mat, k: number): number {
  if (k < 0) return -1;
  if (m[k]! > 1) return m[k]! * 2;
  return m[k + 1]! - 1;
}

function join(m: Mat): string {
  const parts: string[] = [];
  for (let i = 0; i < m.length; i++) parts.push(String(m[i]));
  return parts.join(",");
}
const f = (xs: number[]) => new Float32Array(xs), d = (xs: number[]) => new Float64Array(xs);
console.log(sum4(f([1.1, 2.2, 3.3, 4.4, 5.5]), 1), sum4(d([1.1, 2.2, 3.3, 4.4, 5.5]), 1), sum4(f([1, 2]), 0));
for (const [a, b, out] of [
  [f([1, 2, 3, 4]), f([0.1, 0.2, 0.3, 0.4]), new Float32Array(6)],
  [d([1, 2, 3, 4]), d([0.1, 0.2, 0.3, 0.4]), new Float64Array(6)],
  [f([1, 2, 3, 4]), d([0.1, 0.2, 0.3, 0.4]), new Float64Array(6)],
  [d([1, 2, 3, 4]), f([0.1, 0.2, 0.3, 0.4]), new Float32Array(3)],
] as [Mat, Mat, Mat][]) {
  multiply(a, b, out, 1);
  console.log(out instanceof Float32Array ? "f32" : "f64", join(out));
}
const m32 = new Float32Array(8), m64 = new Float64Array(8);
compose(1.1, 2.2, 1 / 3, m32, 2); compose(1.1, 2.2, 1 / 3, m64, 1); compose(5, 6, 7, m32, 5);
console.log(Array.from(m32).join(","), Array.from(m64).join(","));
console.log(rewritten(f([1.5, 2]), d([0.25, 0.5])), rewritten(d([1.5, 2]), f([0.25, 0.5])));
console.log(captured(f([0.1, 0.2, 0.3])), captured(d([0.1, 0.2, 0.3])), lengthOnly(f([1]), d([1, 2])));
console.log(early(f([0.5, 3]), 0), early(d([2.5, 3]), 0), early(f([0.5, 3]), -1), early(d([0.5]), 0), early(f([0.5]), 4));
