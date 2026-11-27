// The page's intrinsic prototypes and constructors, seen by untyped code and
// through TS any, for compiled objects, arrays, typed arrays, typed records
// and tuples: Object.getPrototypeOf and .constructor answer the page's own
// Array.prototype / Object.prototype and Array / Object.
import { probe } from "./js-intrinsic-prototypes-helper.js";
const nums: number[] = [1, 2];
const rec = { a: 1 };
const tup: [number, string] = [1, "x"];
console.log(probe(nums, rec, tup));
const AP: any = Array.prototype, OP: any = Object.prototype;
const tn: any = nums, tr: any = rec, tt: any = tup;
console.log(Object.getPrototypeOf(tn) === AP, Object.getPrototypeOf(tr) === OP, Object.getPrototypeOf(tt) === AP, Object.getPrototypeOf(AP) === OP);
