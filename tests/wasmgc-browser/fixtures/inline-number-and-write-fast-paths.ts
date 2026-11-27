// Strict equality, ToInt32 and element writes take inline fast paths (a dev build has no wasm-opt inlining); every
// other case keeps the out-of-line semantics: NaN is unequal to itself, two undefineds are equal, ToInt32 wraps modulo
// 2^32, and writes past the length grow the array with holes (array-frozen-write-fast-path: onto a frozen array, throw).
export {};
const nums = [0, -0, 1, -1, 1.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 4294967297, NaN, Infinity, -Infinity, 1e20];
const eq: string[] = [];
for (const a of nums) eq.push(`${a === 1 ? 1 : 0}${a === a ? 1 : 0}${a === 2147483648 ? 1 : 0}${(a | 0)}`);
console.log(eq.join(" "));
let u: number | undefined, w: number | undefined;
const maybe = (k: number): number | undefined => (k > 0 ? k : undefined);
u = maybe(0); w = maybe(-1);
console.log(u === w, u === maybe(2), maybe(3) === maybe(3), (NaN | 0), (1.9 | 0), (-1.9 | 0), (2 ** 32 + 5) | 0, (-(2 ** 31) - 1) | 0);
const xs: number[] = [1, 2, 3];
xs[0] = 10; xs[2] = 30; xs[3] = 40; xs[6] = 70;
console.log(xs.length, xs.join(","), 4 in xs, 5 in xs);
// xs now has hole states: in-bounds writes into a hole must record the slot as present.
xs[4] = 50; xs[1] = 20;
console.log(xs.join(","), 4 in xs, 5 in xs);
const out: number[] = [0, 0, 0, 0];
for (let i = 0; i < 4; i++) out[i] = i * 1.5;
console.log(out.join(","));
