// Typed-array reads, stores and compound stores keyed by array elements:
// for-of and forEach elements (possibly missing: an array may have holes)
// index exactly as a number would, and a missing key misses like NaN.
function marks(keys: readonly number[]): Float32Array {
  const out = new Float32Array(6);
  for (const k of keys) out[k] = k + 0.5;
  for (const k of keys) out[k] += 1;
  keys.forEach((k, i) => { out[k] = out[k]! * 2 + i; });
  return out;
}

function gather(keys: readonly number[], table: Float64Array): number {
  let total = 0;
  for (const k of keys) total += table[k]!;
  keys.forEach(k => { total += table[k]! * 10; });
  return total;
}

const table = new Float64Array([1, 2, 3, 4]);
console.log(Array.from(marks([0, 2, 5])).join(","));
console.log(gather([3, 1], table));
console.log(gather([], table));
// Out of range: the read misses (undefined), so the sum is NaN.
console.log(gather([9], table));
