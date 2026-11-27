// reduce over compiled arrays: the length at entry bounds the walk (items
// pushed meanwhile are not visited), indices removed meanwhile and holes are
// skipped, without an initial value the first present item seeds, and an
// empty walk without one is V8's TypeError. Callbacks of each arity, a
// number accumulator, a capture, and a callback that is not a literal.
// @hits(native-any): ^\$arr\.reduce\.(direct|fn)\.
import { holey, sparseHead, sumBy, grow } from "./loops-reduce-helper.js";
const rows: any = [{ v: 1 }, { v: 2.5 }, { v: -3 }, { v: 4 }];
console.log(rows.reduce((s: any, r: any) => s + r.v, 0), rows.reduce((s: any, r: any, i: any) => s + r.v * i, 10));
console.log(rows.reduce((s: any, r: any, i: any, a: any) => s + (a.length - i) + r.v, 0), rows.reduce((s: any) => s + 1, 0));
const nums: any = [5, 6, 7];
console.log(nums.reduce((a: any, b: any) => a * b), nums.reduce((a: any, b: any) => a + "," + b));
const k = 3; console.log(nums.reduce((a: any, b: any) => a + b * k, 0));
const growing: any = [1, 2];
console.log(growing.reduce((a: any, x: any, _i: any, arr: any) => { arr.push(x * 10); return a + x; }, 0), growing.length);
const shrinking: any = [1, 2, 3, 4];
console.log(shrinking.reduce((a: any, x: any, _i: any, arr: any) => { arr.pop(); return a + x; }, 0));
const h1: any = holey(), h2: any = holey(), sp: any = sparseHead();
console.log(h1.reduce((a: any, x: any) => a + x, 0), h2.reduce((a: any, x: any) => a + x), sp.reduce((a: any, x: any) => a + "|" + x));
const empty: any = [], one: any = [9];
try { empty.reduce((a: any, b: any) => a + b); } catch (e) { console.log((e as Error).name, (e as Error).message); }
console.log(empty.reduce((a: any, b: any) => a + b, "init"), one.reduce((a: any, b: any) => a + b));
const add = (a: any, b: any) => a + b;
const pick: any = add;
console.log(nums.reduce(pick, 100));
console.log(sumBy([{ v: 1 }, { v: 2 }]), grow([1, 2, 3]), grow([4]));
