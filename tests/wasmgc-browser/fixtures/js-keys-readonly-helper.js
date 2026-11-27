// Object.keys results read only through .length and [i] (shared per shape / record type),
// against results that escape, are written, or outlive a shape change.
export function shallowEqual(objA, objB) {
  var keysA, keysB, i;
  if (Object.is(objA, objB)) return true;
  if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) return false;
  keysA = Object.keys(objA);
  keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (i = 0; i < keysA.length; i++) {
    var k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(objB, k) || !Object.is(objA[k], objB[k])) return false;
  }
  return true;
}
export function listKeys(o) { const ks = Object.keys(o); let s = ""; for (let i = 0; i < ks.length; i++) s += ks[i] + ","; return s + ks.length; }
export function count(o) { return Object.keys(o).length; }
export function escaped(o) { const ks = Object.keys(o); ks.push("extra"); return ks; }
export function sorted(o) { const ks = Object.keys(o); ks.sort(); return ks.join(","); }
export function returned(o) { const ks = Object.keys(o); return ks; }
export function stored(o, box) { const ks = Object.keys(o); box.k = ks; return ks.length; }
export function captured(o) { const ks = Object.keys(o); return () => ks.length; }
export function reassigned(o, p) { let ks = Object.keys(o); const n = ks.length; ks = [n]; ks.push(Object.keys(p).length); return ks.join(","); }
export function mutateDuring(o) { const ks = Object.keys(o); let s = ""; for (let i = 0; i < ks.length; i++) { s += ks[i]; if (i === 0) o.added = 1; } return s + "|" + listKeys(o); }
export function forIn(o) { let s = ""; for (const k in o) s += k + "=" + o[k] + ";"; return s; }
export function forInMutate(o) { let s = ""; for (const k in o) { s += k + ";"; if (o.b !== undefined) delete o.b; } return s; }
export function dyn(n) { const o = {}; for (let i = 0; i < n; i++) o["k" + i] = i; return o; }
export function shapes() {
  const a = { x: 1, y: 2 }, b = JSON.parse('{"x":1,"y":2}'), c = { y: 2, x: 1 }, d = { x: 1, y: 2, z: 3 };
  /** @type {any[]} */
  const out = [];
  out.push(shallowEqual(a, b), shallowEqual(a, c), shallowEqual(a, d), shallowEqual(d, a), listKeys(a), listKeys(c), listKeys(d));
  delete b.y; out.push(listKeys(b), shallowEqual(a, b));
  b.y = 2; out.push(listKeys(b), shallowEqual(a, b));
  const e = escaped(a); out.push(e.join(","), listKeys(a), sorted(c), listKeys(c));
  const r = returned(a); r[0] = "changed"; out.push(listKeys(a), r.join(","));
  const box = {}; stored(a, box); box.k.pop(); out.push(listKeys(a), box.k.length);
  out.push(captured(d)(), reassigned(a, d), count(a), count(d), count([1, 2, 3]), count("abc"));
  const idx = { 2: "b", 1: "a", z: 0, 0: "c" }; out.push(listKeys(idx), listKeys(idx));
  const big = JSON.parse(JSON.stringify(dyn(40))); out.push(count(big)); delete big.k3; out.push(count(big), listKeys(dyn(3)));
  out.push(mutateDuring({ p: 1, q: 2 }));
  return out.join(" | ");
}
