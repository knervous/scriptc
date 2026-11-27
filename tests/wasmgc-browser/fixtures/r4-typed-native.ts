// Typed records inside compiled JS keep their identity: reads, writes from
// both sides, nested records, function-valued fields, keys and round trips.
import { readTypedRecord, touch, nestedTag, callField, same, spread, setFn } from './r4-typed-helper.js';
type Inner = { tag: string };
type Rec = { n: number; label: string; inner: Inner; f: (x: number) => number };
const r: Rec = { n: 7, label: "a", inner: { tag: "t" }, f: (x: number) => x * 2 };
const n: number = readTypedRecord(r);
touch(r);
const tag: string = nestedTag(r);
const c: number = callField(r);
setFn(r);
const c2: number = r.f(5);
const s: boolean = same(r, r);
const sp: string = spread(r);
console.log(n, r.n, r.label, tag, c, c2, s, sp);
