// Array callbacks on a typed array held through TS any (or by untyped code)
// walk it live and receive the array itself: identity holds, writes are seen.
// @hits(native,native-any): ^\$tarr\.iter\.forEach$
// @hits(native,native-any): ^\$tarr\.iter\.reduce$
import { walk } from "./ts-any-typed-array-callbacks-helper.js";
const xs: number[] = [1, 2, 3];
const a: any = xs;
let same = 0;
a.forEach((_x: any, i: any, arr: any) => { if (arr === xs) same++; if (i === 0) arr[1] = 20; });
console.log(same, xs[1]);
console.log(a.map((x: any, _i: any, arr: any) => x + (arr === a ? 100 : 0)).join(","));
console.log(a.filter((x: any, _i: any, arr: any) => { arr[2] = 7; return x > 5; }).join(","), xs[2]);
console.log(a.some((x: any, _i: any, arr: any) => arr === xs && x === 7), a.every((_x: any, _i: any, arr: any) => arr === xs));
console.log(a.find((x: any, _i: any, arr: any) => arr === xs && x > 10), a.findIndex((x: any, _i: any, arr: any) => arr === xs && x === 7));
console.log(a.reduce((s: any, x: any, _i: any, arr: any) => s + x + (arr === xs ? 1 : 0), 0), a.reduce((s: any, x: any) => s + x));
// Holes are skipped (find/findIndex visit them), and the length at entry bounds the walk.
const holes: number[] = [1, , 3, 4] as number[];
const ah: any = holes;
let visits = 0; ah.forEach(() => visits++);
console.log(visits, ah.reduce((s: any, x: any) => s + x), ah.findIndex((x: any) => x === undefined));
const grow: number[] = [1, 2];
const ag: any = grow;
let n = 0; ag.forEach((_x: any, i: any, arr: any) => { n++; if (i === 0) arr.push(9); });
console.log(n, grow.length);
const empty: number[] = [];
const ae: any = empty;
try { ae.reduce((s: any, x: any) => s + x); } catch (e) { console.log(e instanceof TypeError, (e as Error).message); }
const ys: number[] = [4, 5, 6];
console.log(walk(ys), ys.join(","));
