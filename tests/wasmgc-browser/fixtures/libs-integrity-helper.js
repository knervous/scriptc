// Integrity levels and reflection on compiled objects and functions.
function del(obj, key) { delete obj[key]; return true; }
function attempt(f) { try { f(); return "ok"; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
export function run() {
  var out = [];
  var o = { a: 1, b: { c: 2 } };
  Object.seal(o);
  out.push(Object.isSealed(o), Object.isFrozen(o), Object.isExtensible(o), attempt(() => { o.a = 5; }), o.a, attempt(() => { o.z = 1; }), "z" in o, attempt(() => del(o, "a")), o.a);
  Object.freeze(o);
  out.push(Object.isFrozen(o), attempt(() => { o.a = 9; }), o.a, Object.isFrozen(o.b), attempt(() => { o.b.c = 3; }), o.b.c);
  var p = { x: 1 };
  Object.preventExtensions(p);
  out.push(Object.isExtensible(p), Object.isSealed(p), attempt(() => { p.y = 1; }), attempt(() => { p.x = 2; }), p.x, attempt(() => del(p, "x")), "x" in p, Object.isFrozen(p));
  out.push(attempt(() => Object.defineProperty(p, "q", { value: 1 })), attempt(() => Object.setPrototypeOf(p, {})));
  var empty = Object.preventExtensions({});
  out.push(Object.isFrozen(empty), Object.isFrozen(1), Object.isExtensible("s"), Object.freeze(7));
  function f() {} f.tag = 1; Object.freeze(f);
  out.push(Object.isFrozen(f), attempt(() => { f.tag = 2; }), f.tag);
  var d = {};
  Object.defineProperties(d, { a: { value: 1, enumerable: true }, h: { value: 2 }, w: { value: 3, writable: true, enumerable: true } });
  out.push(Object.keys(d).join(","), Object.getOwnPropertyNames(d).join(","), d.h, attempt(() => { d.a = 5; }), d.a);
  var descs = Object.getOwnPropertyDescriptors(d);
  out.push(Object.keys(descs).join(","), descs.h.writable, descs.w.writable, descs.a.enumerable, descs.h.enumerable);
  out.push(Object.values({ x: 5, y: 6 }).join(","), Object.entries({ k: "v" }).join(";"), Object.getOwnPropertyNames("ab").join(","), Reflect.ownKeys([7]).join(","));
  return out.join("|");
}
