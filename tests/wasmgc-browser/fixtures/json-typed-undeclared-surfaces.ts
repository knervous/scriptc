// @native-only: the engine dyn model keeps the page object but copies records for spread, Object.values/entries and inspection
// Every surface that enumerates a record built from untyped data sees the source's undeclared own keys, interleaved in the source's order.
type P = { score: number; name: string };
const p = JSON.parse('{"z":1,"name":"n","w":"s","score":5}') as P;
console.log(Object.keys(p).join(","));
console.log(Object.values(p).join("|"));
console.log(Object.entries(p).map((e) => e[0]).join(","));
const ks: string[] = [];
for (const k in p) ks.push(k);
console.log(ks.join(","));
console.log(JSON.stringify({ ...p }), JSON.stringify({ ...p, score: 9 }));
console.log(JSON.stringify(p, null, 2));
console.log(p);
const a: any = p;
console.log(JSON.stringify(a), Object.keys(a).join(","), "z" in a, a.z);
a.extra = 9;
console.log(JSON.stringify(p), Object.keys(p).join(","));
console.log(Object.hasOwn(p, "z"), Object.hasOwn(p, "score"), Object.hasOwn(p, "nope"), "z" in p, "nope" in p);
// A source whose declared keys arrive in another order than the declaration.
const q = JSON.parse('{"name":"n","score":5}') as P;
console.log(JSON.stringify(q), Object.keys(q).join(","));
// Records built from literals stay exact.
const lit: P = { score: 1, name: "x" };
console.log(JSON.stringify({ ...lit, score: 2 }), Object.keys(lit).join(","), Object.values(lit).join("|"), Object.hasOwn(lit, "z"));
// Nested records and arrays of records.
type Doc = { title: string; items: { id: number }[]; meta: { k: string } };
const d = JSON.parse('{"title":"t","x":1,"items":[{"id":1,"u":"a"},{"id":2}],"meta":{"k":"v","j":{"deep":true}}}') as Doc;
console.log(JSON.stringify(d));
console.log(Object.keys(d).join(), Object.keys(d.items[0]!).join(), Object.keys(d.meta).join());
d.items[0]!.id = 77;
d.items.push({ id: 3 });
console.log(JSON.stringify(d.items));
