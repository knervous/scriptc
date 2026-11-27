// `a[i]` in loops and array callbacks: a compiled array with an integer index
// below its length reads in place (a hole as undefined); fractions, -0, NaN,
// negatives, indices past the length, strings, typed arrays, array-likes and
// arrays that shrink or grow during the loop take the generic read.
// @hits(native,native-any): ^\$hit\.index\.get\.array$
import { holey, arrayLike, joinIdx, sumOdd } from "./loops-index-reads-helper.js";
const a: any = [10, 20, 30];
const keys: any[] = [0, 1, 2, 3, -1, 0.5, -0, NaN, 1e10, 2 ** 31, "1", Infinity];
let out: string[] = [];
for (let j = 0; j < keys.length; j++) out.push(String(a[keys[j]]));
console.log(out.join(","));
const h: any = holey();
out = []; for (let i = 0; i < 5; i++) out.push(String(h[i]));
console.log(out.join(","));
const s: any = "abc", t: any = new Uint8Array([7, 8, 9]), like: any = arrayLike();
out = []; for (let i = 0; i < 4; i++) out.push(String(s[i]) + String(t[i]) + String(like[i]));
console.log(out.join(","));
// The array changes while the loop reads it.
const g: any = [1, 2, 3];
out = []; for (let i = 0; i < 6; i++) { out.push(String(g[i])); if (i === 1) g.pop(); if (i === 2) g.push(9, 9); }
console.log(out.join(","), g.length);
// Index reads inside a callback, and a computed dyn key.
const b: any = [1, 2, 3, 4];
console.log(b.every((x: any, i: any) => x === b[i]), b.map((_x: any, i: any) => b[b.length - 1 - i]).join(""));
let k: any = 2;
let acc = 0; for (let i = 0; i < 3; i++) { acc += b[k]; k = k === 2 ? "1" : 0.5; }
console.log(acc);
console.log(joinIdx(holey(), 5), joinIdx("xyz", 4), joinIdx(new Int16Array([-1, 2]), 3), joinIdx(arrayLike(), 3), sumOdd([1, 2, 3, 4, 5, 6.5]));
