// num.isUndefined: `x === undefined`, `x == null` and `x ?? d` on number slots (browser targets test the slot for an
// undefined typed-array read). An LLVM number slot never holds undefined: an out-of-range typed-array read throws a
// RangeError there instead (values[5] on a length-2 array), so every number reaching the test is a number.
function pick(values: Float64Array, i: number): number { return values[i]!; }
const values = new Float64Array([1.5, 2.5]);
for (const i of [0, 1]) {
  const read = pick(values, i);
  console.log(read === undefined, read == null, read ?? 7, read !== undefined, read != null);
}
