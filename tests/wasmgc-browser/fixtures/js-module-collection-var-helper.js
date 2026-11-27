// JS module vars holding a Set / Map: read through functions, mutated through them, identity kept.
function has(t) { return s.has(t); }
var s = new Set("a b".split(" "));
var m = new Map([["k", 1], ["j", 2]]);
export function probe() { return [s.size, has("a"), has("z")].join(" "); }
export function add(x) { s.add(x); return s.size; }
export function drop(x) { return s.delete(x) + ":" + s.size; }
export function listing() { return [...s].join("") + "|" + [...s.keys()].join("") + "|" + [...m.entries()].map((e) => e.join("=")).join(","); }
export function mapProbe() { return [m.size, m.get("k"), m.has("z"), m.set("z", 26).size, m.get("z"), m.delete("k"), m.size].join(" "); }
export function each() {
  let out = "";
  s.forEach((v) => { out += v; });
  m.forEach((v, k) => { out += k + v; });
  return out;
}
const alias = s;
export function identity() { return alias === s && s === s; }
export function viaAlias(x) { alias.add(x); return s.has(x) + ":" + alias.size; }
export function clearAll() { s.clear(); m.clear(); return s.size + m.size; }
