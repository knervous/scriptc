// A union of typed arrays of different element kinds (the renderer's `Float32Array | Float64Array` matrix
// storage) holds the array itself: each element kind is its own struct, so the arm is a type test, never a
// box. Every path a union value takes keeps the array and its kind: construction, views and copies, element
// reads and writes, identity, narrowing, union-to-union conversion, storage in records, classes and arrays,
// untyped crossings, and printing.
type Mat = Float32Array | Float64Array;
type Indexes = Uint8Array | Uint16Array | Uint32Array | number[];
type MaybeMat = Float32Array | Float64Array | undefined | null;

function join(m: Mat): string {
  const parts: string[] = [];
  for (let i = 0; i < m.length; i++) parts.push(String(m[i]));
  return parts.join(",");
}
function describe(m: Mat): string {
  const kind = m instanceof Float32Array ? "f32" : "f64";
  return `${kind}:${m.length}:${m.byteLength}:${join(m)}`;
}
function pick(kind: number, n: number): Mat {
  const m: Mat = kind === 0 ? new Float32Array(n) : new Float64Array(n);
  for (let i = 0; i < n; i++) m[i] = i + 0.1;
  return m;
}
const a = pick(0, 3), b = pick(1, 3);
console.log(describe(a), describe(b));
// Element writes that round per kind, out-of-range and fractional indexes.
a[1] = 1 / 3; b[1] = 1 / 3; a[5] = 9; b[-1] = 9; a[0.5] = 2;
console.log(a[1], b[1], a[5], b[-1], a[0.5], a.length, b.length);
// Views and copies keep the kind; the buffer is a byte view of the same storage.
const views: Mat[] = [a.subarray(1), b.slice(0, 2), new Float32Array(b), new Float64Array(a.buffer, 0, 1)];
console.log(views.map(describe).join(" | "));
console.log(new Uint8Array(a.buffer).length, new Uint8Array(b.buffer).length, new DataView(b.buffer).getFloat64(8, true));
// Identity and narrowing.
const same: Mat = a;
console.log(same === a, (b as Mat) === (a as Mat), views[0] instanceof Float32Array, views[1] instanceof Float64Array, views[1] instanceof Float32Array);
// A wider union and the unit arms.
function widen(m: Mat): Float32Array | Float64Array | Uint8Array { return m; }
function maybe(m: MaybeMat): string {
  if (m === undefined) return "undefined";
  if (m === null) return "null";
  return describe(m);
}
console.log(describe(widen(b) as Mat), widen(a) instanceof Uint8Array, maybe(a), maybe(undefined), maybe(null), maybe(b.subarray(2)));
const optional: MaybeMat[] = [a, null, undefined, b];
console.log(optional.map((m) => (m ? (m instanceof Float64Array ? "Float64Array" : "Float32Array") : m === null ? "null" : "undefined")).join(","));
// Storage in records, classes and arrays.
class Holder {
  m: Mat; n: Mat | undefined;
  constructor(m: Mat, n: Mat | undefined) { this.m = m; this.n = n; }
}
const held = new Holder(b, a);
const rec = { m: a as Mat, tag: "r" };
const listed: Mat[] = [b, a, b];
console.log(describe(held.m), held.n ? describe(held.n) : "-", describe(rec.m), listed.indexOf(a), listed.lastIndexOf(b), listed.includes(views[0]!));
// An array-like union with a number array arm.
function total(xs: Indexes): number { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]!; return s; }
console.log(total(new Uint8Array([1, 255])), total(new Uint16Array([300, 2])), total(new Uint32Array([70000])), total([1.5, 2]));
// Untyped crossings and printing.
const u: unknown = b;
const back = u as Mat;
const anyM: any = a;
console.log(back === b, describe(back), anyM.length, anyM[1], JSON.stringify(a), JSON.stringify({ n: b.length }));
console.log(a, b);
for (const m of [a, b] as Mat[]) { let s = 0; for (let i = 0; i < m.length; i++) s += m[i]!; console.log(s.toFixed(4), m.subarray(1).length); }
