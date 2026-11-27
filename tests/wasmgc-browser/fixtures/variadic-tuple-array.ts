// A tuple of one element type with a rest (`[A, ...A[]]`) is an A[] whose
// minimum length is type-level: length, indexing, push, splice, spread,
// destructuring, iteration and JSON behave as the array they are.
type NonEmpty<T> = [T, ...T[]];
const xs: NonEmpty<number> = [3];
xs.push(4, 5);
const [head, ...tail] = xs;
console.log(xs.length, xs[0], xs[2], head, tail.join("+"), JSON.stringify(xs));
const ro: readonly [string, ...string[]] = ["a", "b"];
console.log([...ro, "c"].join(""), ro.map((s) => s.toUpperCase()).join(), ro.length);
xs.splice(1, 1);
let sum = 0;
for (const x of xs) sum += x;
console.log(JSON.stringify(xs), sum);
function first<T>(list: readonly [T, ...T[]]): T { return list[0]; }
console.log(first(ro), first(xs));
const pair: [number, number, ...number[]] = [1, 2, 3];
console.log(pair.length, pair.reduce((a, b) => a + b, 0));
export {};
