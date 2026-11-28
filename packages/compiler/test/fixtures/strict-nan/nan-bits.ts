// The bits of NaNs a program stores and reads back: 0 / 0 folded at compile time, the same division at run time,
// and two other run-time NaNs, through DataView and Float64Array/Float32Array. Under math=strict every stored NaN is
// the canonical quiet NaN; otherwise the bits are the engine's (a folded NaN is 0x7ff8000000000000, x86 computes
// 0xfff8000000000000).
const view = new DataView(new ArrayBuffer(8));
const hex64 = (v: number): string => {
  view.setFloat64(0, v, true);
  return (view.getUint32(4, true) >>> 0).toString(16).padStart(8, "0") + (view.getUint32(0, true) >>> 0).toString(16).padStart(8, "0");
};
let zero = 0;
if (Date.now() < 0) zero = 1; // keeps the run-time division opaque to constant folding
const folded = 0 / 0;
const runtime = zero / zero;
const arr = new Float64Array([folded, runtime, Math.sqrt(-1), zero * Infinity]);
const words = new Uint32Array(arr.buffer);
const f32 = new Float32Array([runtime]);
console.log("dataview", hex64(folded), hex64(runtime));
console.log("float64array", [0, 1, 2, 3].map((k) => (words[2 * k + 1]! >>> 0).toString(16) + (words[2 * k]! >>> 0).toString(16).padStart(8, "0")).join(" "));
console.log("float32array", (new Uint32Array(f32.buffer)[0]! >>> 0).toString(16));
