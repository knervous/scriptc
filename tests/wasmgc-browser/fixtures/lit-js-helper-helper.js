// The JS side for lit-js-helper: receives and returns literal-union values and records holding them.
export function echo(v) { return v; }
export function describe(v) { return typeof v + ":" + v + ":" + v.length; }
export function same(a, b) { return a === b; }
export function makeMode(i) { return ["idle", "walk", "run", "sprint"][i]; }
export function makeRecord(i) { return { kind: i & 1 ? "ranged" : "melee", n: i }; }
export function readKind(r) { return r.kind; }
export function setKind(r, k) { r.kind = k; }
export function keysOf(o) { return Object.keys(o).join(","); }
export function collect(list) { return list.map((x) => x.toUpperCase()).join("|"); }
export function callWith(f, v) { return f(v); }
export function store(v) { globalThis.__litStored = v; }
export function stored() { return globalThis.__litStored; }
export function mapGet(m, k) { return m.get(k); }
export function fieldOf(o) { return o.state; }
export function arrayOf() { return ["run", "idle"]; }
