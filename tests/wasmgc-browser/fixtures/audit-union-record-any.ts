// Records reaching dyn through a union (an array literal of differently
// shaped objects, a ternary of two shapes) keep their fields: the record
// type must register with the typed readers like a direct record does.
import { readPair } from "./audit-union-record-any-helper.js";
function readA(t0: any) { return String(t0.a) + "," + String(t0.b); }
const u: { a: number } | { b: number } = Math.random() < 2 ? { a: 3 } : { b: 4 };
console.log(readA(u), readPair(u));
const v: { a: number } | { b: number } = Math.random() > 2 ? { a: 3 } : { b: 4 };
console.log(readA(v), readPair(v));
const arr = [{ a: 6 }, { b: 7 }];
console.log(readA(arr[0]), readA(arr[1]), readPair(arr[1]));
for (const r of [{}, { a: null }, { a: 1 }, { a: { n: 2 } }]) console.log(readA(r), readPair(r));
const nested: { kind: string; inner: { a: number } | { b: string } } = { kind: "k", inner: { b: "s" } };
const anyNested: any = nested;
console.log(anyNested.inner.b, readPair(anyNested.inner));
const maybe: { a: number } | undefined = Math.random() < 2 ? { a: 8 } : undefined;
console.log(readA(maybe), readPair(maybe));
const withArr: { a: number[] } | { b: string } = { a: [1, 2] };
const wa: any = withArr;
console.log(wa.a.length, wa.a[1]);
