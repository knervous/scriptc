// Direct array-callback loops over NATIVE dyn arrays with holes. The holes
// come from writes past the end and length growth in TS (a JS-helper literal
// with elisions arrives as a typed array and takes the generic walk), so these
// calls exercise $arr.<kind>.direct.*: hole skipping, map hole preservation,
// trailing holes, NaN/±0 number predicates, a this argument and mutation.
// @hits(native-any): ^\$arr\.find\.(direct|fn)\.
// @hits(native-any): ^\$arr\.findIndex\.(direct|fn)\.
// @hits(native-any): ^\$arr\.filter\.(direct|fn)\.
// @hits(native-any): ^\$arr\.map\.(direct|fn)\.
// @hits(native-any): ^\$arr\.forEach\.(direct|fn)\.
// @hits(native-any): ^\$arr\.some\.(direct|fn)\.
// @hits(native-any): ^\$arr\.every\.(direct|fn)\.
import { findWithThis } from "./ts-any-direct-callbacks-helper.js";
const h: any = [1, 2, 3];
h[5] = 6;
h.length = 8;
console.log(h.length, h.find((x) => x === undefined), h.findIndex((x) => x === undefined), h.find((x) => x > 5));
console.log(h.filter((_x) => true).length, h.some((x) => x === undefined), h.every((x) => x !== undefined));
let visits = 0; h.forEach(() => { visits++; }); console.log(visits);
const seen: number[] = []; h.forEach((_x, i) => { seen.push(i); }); console.log(seen.join(","));
// Interior holes only for map: trailing holes are a separate known defect
// (a native map result stops at the last visited index).
const inner: any = [1, 2, 3]; inner[5] = 6;
const m = inner.map((x) => x * 2);
console.log(m.length, 3 in m, 5 in m, m[5], m.join("|"));
const nums: any = [1, NaN, 0, -0, 2];
console.log(nums.findIndex((x) => x - 1), nums.filter((x) => x * 1).length, nums.some((x) => x - x), nums.every((x) => x + 1));
const grow: any = [1, 2];
console.log(grow.map((x, _i, a) => { a.push(x); return x; }).length, grow.length);
const shrink: any = [1, 2, 3, 4];
console.log(shrink.filter((_x, _i, a) => { a.pop(); return true; }).length);
console.log(findWithThis([1, 2, 3]), findWithThis(h));
