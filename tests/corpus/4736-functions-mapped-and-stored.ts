// A function both passed to `.map` (which calls it with element, index and array) and stored in a typed array of
// functions: its value is a typed adapter over the function, whose call forwards its own `this`. User functions,
// an intrinsic library member and an arrow, called through `.map`, an element call (`ops[i](x)`, whose `this` is the
// array) and a loop.
import { cos } from "../../packages/intrinsics/math.ts";
function double(x: number): number { return x * 2; }
function inc(x: number): number { return x + 1; }
const half = (x: number): number => x / 2;
const xs: number[] = [1, 2, 3];
console.log(xs.map(double).join(","), xs.map(inc).join(","), xs.map(half).join(","), xs.map(cos).join(","));
const ops: ((x: number) => number)[] = [double, inc, half, cos];
console.log(ops.map((f) => f(10)).join(","));
console.log(ops[0]!(4), ops[1]!(4), ops[2]!(4), ops[3]!(0));
let total = 0;
for (let i = 0; i < ops.length; i++) total += ops[i]!(i);
console.log(total);
