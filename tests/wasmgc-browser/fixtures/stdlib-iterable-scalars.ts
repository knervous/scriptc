// @native-only: engine-dyn cannot box a typed Set/Map or Map view across the Iterable parameter
// @options: {"interfaceClassArms": true}
// Iterable<scalar> parameters fed by arrays, Sets, Map views and a string.
function total(xs: Iterable<number>): number { let t = 0; for (const x of xs) t += x; return t; }
console.log(total([1, 2, 3]), total(new Set([4, 5, 5])), total(new Map([[1, 10], [2, 20]]).values()), total(new Map([[7, 1]]).keys()));
function words(xs: Iterable<string>): number { let n = 0; for (const w of xs) { if (w.length > 1) n++; } return n; }
console.log(words(["hi", "x", "abc"]), words(new Set(["no", "yes"])), words("abc"));
