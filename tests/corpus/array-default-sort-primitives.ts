// Array.prototype.sort and toSorted without a comparator on number and boolean arrays: the stable order of each
// element's String conversion, so [10, 9, 1] sorts as [1, 10, 9], -0 and 0 keep their order and NaN/Infinity sort
// as their spellings. sort returns its receiver; toSorted leaves it alone.
const show = (xs: number[]): string => xs.map((v) => (Object.is(v, -0) ? "-0" : String(v))).join(",");

const nums = [10, 9, 1, -0, 0, NaN, Infinity, -5, 2.5, 100, 1e21, 0.000001, 1e-7];
const copied = nums.toSorted();
console.log(show(copied));
console.log(show(nums));
console.log(nums.sort() === nums, show(nums));
console.log([true, false, true, false].sort().join(","));
console.log([false, true].toSorted().join(","));
const empty: number[] = [];
console.log(empty.sort().length, show([3].toSorted()));
