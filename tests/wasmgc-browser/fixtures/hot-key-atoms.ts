// String-box keys carry their atom (for-in keys from birth, any other box
// once a property access has interned it): computed reads, writes, `in`,
// hasOwnProperty, delete and descriptors through such keys, a key variable
// reassigned inside a for-in body or copied to another local, for-in over a
// receiver that is not a local or over a typed record, keys deleted and added
// during the walk, page strings as keys, the same box on objects of different
// layouts, index-like keys on arrays, and symbols.
// @hits(native,native-any): ^\$dyn\.strAtom$
// @hits(native,native-any): ^\$dyn\.keyAtom$
import * as h from "./hot-key-atoms-helper.js";
const page: any = globalThis;
const src: any = { a: 1, b: 2, c: 3 };
console.log(JSON.stringify(h.copy(src)), JSON.stringify(h.copy({ x: 5, a: 7 })));
console.log(h.diff(src, { a: 1, b: 9, d: 4 }), h.diff({ a: 1 }, { a: 1 }));
console.log(h.reassign({ a: 1, b: 2 }));
console.log(h.drop(h.four(), ["b", "d", "q"]));
const keys: any[] = ["a", "b", "zz", "1", "length", JSON.parse('"c"'), String(page.Number(3))];
const arr: any = [10, 20, 30, 40];
const odd: any = h.odd();
for (const k of keys) console.log(k, h.pick(src, k), h.pick(arr, k), h.pick(odd, k));
const target: any = {};
for (const k of keys) h.put(target, k, k + "!");
console.log(JSON.stringify(target), h.put(arr, "2", 33), arr.join(","));
console.log(h.described(h.withGetter()));
console.log(h.symbolCase());
console.log(h.nested({ inner: h.four() }), h.mutating(h.four()), h.copies(h.four()));
// for-in over a typed record (native-any: its keys are the record's fields).
const rec = { p: 1, q: "x", r: true };
console.log(h.copy({ n: 2, m: 3 }), h.copies(rec), h.nested({ inner: rec }));
