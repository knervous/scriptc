// TypedArray.prototype.sort and toSorted on every element type: the default order is numeric (NaN last, -0
// before +0 on floats), a comparator's sort is stable and its NaN result counts as 0, sort returns its receiver
// and toSorted leaves it alone.
function show(xs: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < xs.length; i++) parts.push(Object.is(xs[i], -0) ? "-0" : String(xs[i]));
  return parts.join(",");
}

const u8 = new Uint8Array([200, 3, 0, 255, 3, 17]);
console.log(u8.sort() === u8, show(Array.from(u8)));
const u8c = new Uint8ClampedArray([9, 1, 250, 4]);
console.log(show(Array.from(u8c.toSorted())), show(Array.from(u8c)));
const i8 = new Int8Array([5, -128, 127, -1, 0]);
console.log(show(Array.from(i8.sort())));
const u16 = new Uint16Array([65535, 2, 1000, 2]);
console.log(show(Array.from(u16.sort((a, b) => b - a))));
const i16 = new Int16Array([-300, 300, -32768, 7]);
console.log(show(Array.from(i16.toSorted())), show(Array.from(i16)));
const u32 = new Uint32Array([4294967295, 0, 2147483648, 12]);
console.log(show(Array.from(u32.sort())));
const i32 = new Int32Array([10, -2147483648, 2147483647, -5]);
console.log(show(Array.from(i32.sort())));
const f32 = new Float32Array([0.5, -0, NaN, 0, -Infinity, 1.25, -0.5]);
console.log(show(Array.from(f32.sort())));
const f64 = new Float64Array([3, NaN, -0, 0, -1, Infinity, NaN, 1e-300]);
const sorted = f64.toSorted();
console.log(show(Array.from(sorted)), show(Array.from(f64)), sorted === f64);
console.log(show(Array.from(f64.sort())) === show(Array.from(sorted)));

// Stability: a comparator on the integer part keeps equal keys in their original order.
const keyed = new Float64Array([2.1, 1.9, 2.2, 1.1, 2.3, 1.5]);
console.log(show(Array.from(keyed.sort((a, b) => Math.floor(a) - Math.floor(b)))));
// A NaN or one-argument comparator orders nothing.
console.log(show(Array.from(new Int32Array([3, 1, 2]).sort(() => NaN))));
console.log(show(Array.from(new Int32Array([3, 1, 2]).toSorted((a) => a - a))));
// Empty and single-element arrays.
console.log(show(Array.from(new Float64Array(0).sort())), show(Array.from(new Uint16Array([42]).toSorted())));
