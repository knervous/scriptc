// TypedArray.prototype.toReversed on every element type: a new array of the same type with the elements in
// reverse order (stored values, so -0 and NaN survive), leaving the receiver alone.
function show(xs: number[]): string {
  return xs.map((v) => (Object.is(v, -0) ? "-0" : String(v))).join(",");
}

const u8 = new Uint8Array([1, 2, 255]);
const r8 = u8.toReversed();
console.log(show(Array.from(r8)), show(Array.from(u8)), r8 === u8, r8 instanceof Uint8Array);
console.log(show(Array.from(new Uint8ClampedArray([0, 128, 255]).toReversed())));
console.log(show(Array.from(new Int8Array([-128, 0, 127]).toReversed())));
console.log(show(Array.from(new Uint16Array([65535, 1, 2]).toReversed())));
const i16 = new Int16Array([-32768, 5, 32767]);
const r16 = i16.toReversed();
console.log(show(Array.from(r16)), r16 instanceof Int16Array, r16.length);
console.log(show(Array.from(new Uint32Array([4294967295, 0, 7]).toReversed())));
console.log(show(Array.from(new Int32Array([-2147483648, 1, 2147483647]).toReversed())));
console.log(show(Array.from(new Float32Array([1.5, -0, NaN, Infinity]).toReversed())));
const f64 = new Float64Array([0.1, -0, NaN, -Infinity, 1e300]);
const r64 = f64.toReversed();
console.log(show(Array.from(r64)), show(Array.from(f64)), r64 instanceof Float64Array);
console.log(new Float64Array(0).toReversed().length, show(Array.from(new Int32Array([42]).toReversed())));
