// Object.keys on a typed record passed to compiled JS: JS order is the
// literal's insertion order. Typed records store fields in canonical order.
import { keysOf } from './r4-typed-helper.js';
type Rec = { n: number; label: string; inner: { tag: string } };
const r: Rec = { n: 7, label: "a", inner: { tag: "t" } };
const ks: string = keysOf(r);
console.log(ks);
