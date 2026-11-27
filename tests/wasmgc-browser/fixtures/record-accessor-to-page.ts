// A record with accessor properties handed to page code: every read and write runs the accessor (JS evaluates it each time).
import { read, write, has, sum } from "./record-accessor-to-page-helper.js";
let reads = 0, writes = 0, stored = 10;
const obj = {
  get v() { reads++; return stored; },
  set v(x: number) { writes++; stored = x; },
  w: 5,
};
console.log(read(obj), read(obj), reads);
console.log(write(obj, 42), writes, stored);
console.log(has(obj), sum(obj), reads);
const ro = { get v() { return 7; }, w: 1 };
console.log(read(ro), has(ro));
