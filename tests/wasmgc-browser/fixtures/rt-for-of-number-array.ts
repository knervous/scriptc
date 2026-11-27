// `for (const v of values)` over a number[] with v typed number binds an f64 local (agent RT, 10-28): a hole still
// reads JS's undefined (typeof, String, === undefined, arithmetic NaN), the loop sees pushes
// and length changes made by its body, `let` bindings captured per iteration keep their own value, and break and
// continue behave as before.
const values: number[] = [1, 2.5, -0, NaN];
let sum = 0;
for (const v of values) sum += v;
console.log("sum", sum, Object.is(values[2], -0));
const holes: number[] = [1, , 3] as number[];
holes[5] = 6;
const seen: string[] = [];
for (const v of holes) seen.push(`${typeof v}:${String(v)}:${v === undefined}:${v + 1}`);
console.log("holes", seen.join(" "));
const grow: number[] = [1, 2];
const order: number[] = [];
for (const v of grow) { order.push(v); if (grow.length < 5) grow.push(v * 10); }
console.log("grow", order.join(","));
const fns: (() => number)[] = [];
for (let v of [4, 5, 6]) { v *= 2; fns.push(() => v); }
console.log("captured", fns.map((f) => f()).join(","));
let picked = -1;
for (const v of [3, 8, 13, 21]) { if (v % 2 === 1 && v < 10) continue; picked = v; if (v > 5) break; }
console.log("picked", picked);
const nested: number[][] = [[1, 2], [3], []];
let total = 0;
for (const row of nested) for (const v of row) total = total * 10 + v;
console.log("nested", total);
function maxOf(xs: number[]): number { let best = -Infinity; for (const x of xs) if (x > best) best = x; return best; }
console.log("max", maxOf([3, 9, 2]), maxOf([]), maxOf([NaN, 1]));
