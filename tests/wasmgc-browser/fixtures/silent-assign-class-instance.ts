// Object.assign / spread / entries / values / JSON over class instances held as any.
class P { a = 1; b = "x"; c = true; }
class Q extends P { d = [1, 2]; }
function id(v: any): any { return v; }
const p = id(new P());
const q = id(new Q());
console.log(JSON.stringify(Object.assign({}, p)));
console.log(JSON.stringify(Object.assign({ z: 0 }, p, q, { e: 9 })));
console.log(JSON.stringify({ ...p }), JSON.stringify({ ...q }));
console.log(JSON.stringify(Object.entries(q)), JSON.stringify(Object.values(p)));
console.log(JSON.stringify(p), JSON.stringify(q));
console.log(Object.keys(Object.assign({}, q)).join(","));
