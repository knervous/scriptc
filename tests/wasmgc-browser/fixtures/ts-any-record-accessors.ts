// @native-any-only: object-literal accessors reached through TS any are typed records with %get:/%set: closure slots only native-any holds natively
// Reads run the getter on every read (constant and computed keys), writes run the setter, `in`/hasOwn see accessor names, a setter-only accessor reads undefined.
const vals: any[] = [{ n: 3 }, { get n() { return 5; } }];
for (const v of vals) console.log(v.n);
let hits = 0;
const acc: any[] = [{ a: 1, get b() { hits++; return 2; }, set b(x: number) { hits += x; }, c: 3 }];
const o = acc[0];
console.log(o.b, o.b, hits);
o.b = 10;
console.log(hits, "b" in o, Object.hasOwn(o, "b"));
const k = "b";
console.log(o[k]);
const so: any[] = [{ set w(x: number) { hits = x; } }];
console.log(so[0].w);
so[0].w = 42;
console.log(hits);
