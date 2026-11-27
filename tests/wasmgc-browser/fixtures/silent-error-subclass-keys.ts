// @native-any-only: an Error subclass instance held as native `any`: own keys, stack and expandos follow the program's assignments
function id(v: any): any { return v; }
class Plain extends Error { code = 3; }
class Named extends Error { constructor(m: string) { super(m); this.name = "Named"; } }
class Bare extends Error {}
const p = id(new Plain("m")), n = id(new Named("m")), b = id(new Bare("m")), e = id(new Error("m"));
for (const v of [p, n, b, e]) {
  console.log(Object.keys(v).join(","), typeof v.stack, "stack" in v, "message" in v, "name" in v, Object.hasOwn(v, "stack"), Object.hasOwn(v, "message"), Object.hasOwn(v, "name"));
  console.log(JSON.stringify(v), Object.getOwnPropertyNames(v).join(","), Object.entries(v).length, JSON.stringify(Object.assign({}, v)));
}
b.extra = 1;
console.log(Object.keys(b).join(","), JSON.stringify(b), b.extra, Object.getOwnPropertyNames(b).join(","));
class Plain2 { a = 1; }
const q = id(new Plain2());
q.extra = 2;
console.log(Object.keys(q).join(","), JSON.stringify(q), JSON.stringify({ ...q }), Object.entries(q).join("|"), JSON.stringify(Object.assign({}, q)));
