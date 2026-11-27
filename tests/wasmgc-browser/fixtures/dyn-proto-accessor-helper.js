// __proto__ on an untyped object is the prototype accessor, not an own
// property: reads, assignment (constant and computed keys), null, ignored
// primitives, a null-prototype object (own property again), cycles.
const t = (f) => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const at = (o, k) => o[k], put = (o, k, v) => { o[k] = v; };
export function run() {
  const out = [];
  const p = { hi() { return "hi"; } }, o = { a: 1 };
  o.__proto__ = p;
  out.push([typeof o.hi, Object.keys(o).join(","), Object.getPrototypeOf(o) === p, o.__proto__ === p, at(o, "__proto__") === p, o.hasOwnProperty("__proto__")].join(" "));
  const q = { a: 2 }; put(q, "__proto__", p); out.push([q.hi(), Object.keys(q).join(",")].join(" "));
  o.__proto__ = 5; out.push(Object.getPrototypeOf(o) === p);
  o.__proto__ = null; out.push([typeof o.hi, Object.getPrototypeOf(o) === null, o.__proto__].join(" "));
  const bare = {}; Object.setPrototypeOf(bare, null); bare.__proto__ = 7; const ks = []; for (const k in bare) ks.push(k); out.push([ks.join(","), bare.__proto__].join(" "));
  const c1 = {}, c2 = {}; c1.__proto__ = c2; out.push(t(() => { c2.__proto__ = c1; return "no"; }));
  const plain = {}; out.push([plain.__proto__ === Object.prototype, ({}).__proto__ === Object.getPrototypeOf({})].join(" "));
  return out.join("\n");
}
