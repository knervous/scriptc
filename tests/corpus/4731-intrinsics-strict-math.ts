// The strict-math intrinsic library (packages/intrinsics/math.ts): every
// function, pow included, over edge values and a pseudo-random sweep. The
// result bits are hashed: Node (the library's JS bodies), WasmGC and native
// must produce the same doubles.
import { sin, cos, tan, asin, acos, atan, atan2, exp, expm1, log, log1p, log2, log10, sinh, cosh, tanh, asinh, acosh, atanh, cbrt, pow } from "../../packages/intrinsics/math.ts";

const unary: [string, (x: number) => number][] = [["sin", sin], ["cos", cos], ["tan", tan], ["asin", asin], ["acos", acos], ["atan", atan],
  ["exp", exp], ["expm1", expm1], ["log", log], ["log1p", log1p], ["log2", log2], ["log10", log10], ["sinh", sinh], ["cosh", cosh],
  ["tanh", tanh], ["asinh", asinh], ["acosh", acosh], ["atanh", atanh], ["cbrt", cbrt]];
const xs: number[] = [0, -0, 1, -1, 0.5, 1e-300, 1e300, 3.141592653589793, 100, -7.25, 1e-8, 0.7, 2, 1e6, NaN, Infinity, -Infinity, 710, 1e22, 5e-324];
let rng = 12345;
for (let i = 0; i < 1500; i++) {
  rng = (Math.imul(rng, 1103515245) + 12345) | 0;
  xs.push((rng / 2147483648) * (i % 7 === 0 ? 1000 : i % 3 === 0 ? 50 : 2));
}
const bits = new DataView(new ArrayBuffer(8));
let h = 0x811c9dc5 | 0;
const mix = (v: number): void => {
  bits.setFloat64(0, v, true);
  h = Math.imul(h ^ bits.getInt32(0, true), 16777619);
  h = Math.imul(h ^ bits.getInt32(4, true), 16777619);
};
for (const [name, f] of unary) {
  const before = h;
  for (const x of xs) mix(f(x));
  console.log(name, (h ^ before) >>> 0, f(0.5), f(-3.25));
}
for (const x of xs.slice(0, 200)) for (const y of xs.slice(0, 40)) mix(atan2(x, y));
console.log("atan2", h >>> 0, atan2(1, -2));
const ys = [0.5, 2, 3, -1.5, 10, 0.1, 1e-3, -0.5, 1 / 3, 53];
for (const x of xs.slice(0, 400)) for (const y of ys) mix(pow(Math.abs(x), y));
console.log("pow", h >>> 0, pow(2, 0.5), pow(10, -3), pow(-8, 1 / 3), pow(1.0000001, 1e7));
