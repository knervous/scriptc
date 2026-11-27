// Strict equality, number/boolean crossings and bitwise flags on engine
// values: the i31 boundaries, -0, NaN, strings, null/undefined and objects.
import { bitsGrid } from './fastpath-bits-helper.js';
const h: any = globalThis;
const id = (v: any): any => h.auditIdentity(v);
const lo = -(2 ** 30), hi = 2 ** 30 - 1;
const nums: any[] = [0, -0, 1, -1, lo, hi, lo - 1, hi + 1, 0.5, NaN, 2 ** 31, -(2 ** 31), 1e300, Infinity];
const out: string[] = [];
for (const a of nums) {
  const row: string[] = [];
  for (const b of nums) row.push(id(a) === id(b) ? "1" : "0");
  out.push(row.join(""));
}
console.log(out.join(" "));
const others: any[] = [null, undefined, "", "a", "1", "ab", true, false, {}, [], 1, 0];
const obj = {}, arr: any[] = [];
others[8] = obj; others[9] = arr;
const grid: string[] = [];
for (const a of others) {
  let row = "";
  for (const b of others) row += (id(a) === id(b) ? "1" : "0");
  grid.push(row);
}
console.log(grid.join(" "));
console.log(id("x" + "y") === "xy", id(obj) === obj, id(null) === null, id(undefined) === null, id(0) === null, id("") === null);
// Numbers crossing to JS: Object.is sees -0 and the boundaries exactly.
const back = (n: number): string => { const v = id(n); return `${Object.is(v, -0) ? "-0" : String(v)}:${typeof v}`; };
console.log([0, -0, lo, hi, lo - 1, hi + 1, 0.25, NaN, -7].map(back).join(" "));
// Numbers from JS: i31 and heap numbers read back exactly.
let sum = 0;
for (const a of nums) { const v: number = id(a); if (v === v && Math.abs(v) < 1e10) sum += v; }
console.log(sum);
// Bitwise on engine values: i31 operands and the fallbacks.
const bits: any[] = [0, -1, 5, lo, hi, hi + 1, -(2 ** 31), 0.5, "3", null, undefined, true];
console.log(bitsGrid(bits, id));
// Booleans crossing.
const flag = (b: boolean): string => { const v = id(b); return `${v}:${typeof v}:${v === true}`; };
console.log(flag(true), flag(false), flag(1 > 2));
