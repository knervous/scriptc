// @native-any-only: TS any values converted to typed arrays at the checked boundary
// @profile: checked boundary: a TS-any value of the wrong element kind under a typed array annotation throws a path-annotated TypeError (JS keeps the value); this pins the element paths now built only on failure
// @expect: x,y,z 3
// @expect: 4 z true
// @expect: 0.5 -0 true 1e+21 | false,true,false
// @expect: expected string at $[2], got number
// @expect: expected number at $[2], got string
// @expect: expected boolean at $[1], got null
// @expect: expected string at $[1].a, got number
// @expect: expected string at $[1][1], got number
// @expect: expected array at $, got string
import { keys, make } from "./dyncheck-array-paths-helper.js";
const ks: string[] = keys({ x: 1, y: 2, z: 3 });
console.log(ks.join(","), ks.length);
const any: any[] = make(5);
console.log(any.length, any[2], any[1] === undefined);
const nums: number[] = make(6), bools: boolean[] = make(7);
console.log(nums[0], nums[1], Number.isNaN(nums[2]), nums[3], "|", bools.join(","));
const tries: (() => unknown)[] = [
  () => { const xs: string[] = make(0); return xs.length; },
  () => { const xs: number[] = make(1); return xs.length; },
  () => { const xs: boolean[] = make(2); return xs.length; },
  () => { const xs: { a: string }[] = make(3); return xs.length; },
  () => { const xs: string[][] = make(4); return xs.length; },
  () => { const xs: string[] = make(8); return xs.length; },
];
for (const t of tries) { try { console.log("accepted", t()); } catch (e) { console.log((e as Error).message); } }
