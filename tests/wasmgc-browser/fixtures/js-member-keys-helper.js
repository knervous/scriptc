// Member writes with constant and number keys in untyped JS: assignment
// chains used as values (React's FiberNode), compound and update operators,
// logical assignments, the memo-cache fill loop, holes and appends, number
// keys on objects, strings and typed arrays, accessors and evaluation order.
const SENTINEL = Symbol.for("react.memo_cache_sentinel");
// Inputs are made here and passed back in, so the operations see dyn values.
export function obj(kind) { return kind === 1 ? { n: 1, m: 3 } : kind === 2 ? { n: 1 } : kind === 3 ? { z: 9 } : {}; }
export function arr(kind) { return kind === 1 ? [1, 2, 3] : kind === 2 ? [1, 5] : kind === 3 ? [null, 0, undefined] : [10, 20, 30]; }
export function bytes() { return new Uint8Array(3); }
export function floats() { return new Float64Array(2); }
export function fiber(tag, key) {
  const f = {};
  f.tag = tag;
  f.key = key;
  f.sibling = f.child = f.return = f.stateNode = f.type = f.elementType = null;
  f.index = 0;
  f.refCleanup = f.ref = null;
  f.dependencies = f.memoizedState = f.updateQueue = f.memoizedProps = null;
  f.subtreeFlags = f.flags = 0;
  f.childLanes = f.lanes = 0;
  return Object.keys(f).join(",") + " " + [f.sibling, f.ref, f.flags, f.lanes].join("/");
}
export function chains() {
  const o = {}; const a = [];
  const x = o.a = o["b"] = o[2] = a[0] = a["1"] = 7;
  const r = (o.c = 1, o.d = o.c + 1);
  let y; y = (a[2] = o.e = "e");
  return [x, r, y, Object.keys(o).join(","), a.join("|")].join(" ");
}
export function detachPair() {
  const a = { alternate: null }; const b = { alternate: a }; a.alternate = b;
  return detach(b);
}
function detach(f) {
  const alternate = f.alternate;
  null !== alternate && ((f.alternate = null), detach(alternate));
  f.child = null; f.sibling = null;
  return f.alternate === null && (alternate === null || alternate.alternate === null);
}
export function compound(o, a) {
  o.n += 1; o["m"] *= 2; a[0] += 5; a[1] -= 1; a["2"] |= 8;
  const i = 1;
  a[i] **= 2; a[i + 1] <<= 1;
  return [o.n, o.m, a.join(",")].join(" ");
}
export function update(o, a) {
  const i = 0;
  const r = [o.n++, ++o.n, o["n"]--, a[0]++, ++a[i], a[1]--, --a["1"], a[i]];
  o.s = "4"; o.s++; a[2] = null; a[2]++; a[3] = undefined; a[3]--;
  return r.join(",") + " " + [o.n, o.s, typeof o.s, a.join(",")].join(" ");
}
export function logical(o, a) {
  o.x ??= 1; o.x ??= 2; o["y"] ||= "y"; o.z &&= 3; o.w = 0; o.w ||= "w"; o.v = 5; o.v &&= "v";
  a[0] ??= "a"; a[5] ||= "f"; a[1] &&= "b"; a["2"] ??= "c";
  const i = 3; a[i] ??= "d";
  return [Object.keys(o).join(","), o.x, o.y, o.z, o.w, o.v, a.length, String(a[4]), a.join("|")].join(" ");
}
export function memoCache(size) {
  const data = Array(size);
  for (let current = 0; current < size; current++) data[current] = SENTINEL;
  let hits = 0;
  for (let current = 0; current < size; current++) if (data[current] === SENTINEL) hits++;
  data[0] = "x";
  const deps = [1, "a", null];
  const next = [1, "a", null];
  let same = true;
  for (let i = 0; i < deps.length; i++) if (!Object.is(deps[i], next[i])) same = false;
  return [hits, data[0], data[size - 1] === SENTINEL, data[size] === undefined, same].join(",");
}
export function holes() {
  const a = [1, , 3];
  const b = [];
  b[0] = 1; b[1] = 2; b[3] = 4;
  const j = 6; b[j] = 7;
  return [String(a[1]), 1 in a, String(a[3]), b.length, 2 in b, String(b[2]), String(b[5]), b[6]].join(",");
}
export function numberKeys(o, s, j) {
  o[0] = "z"; o[1.5] = "f"; o[-1] = "n"; o[j] = "j";
  const k = -0;
  return [Object.keys(o).join(","), o["1.5"], o[-1], o[k], o["0"], s[0], s[j], s[9], s[-1], s[1.5]].join(" ");
}
export function numericStrings(a) {
  const keys = ["1", "01", "1.0", " 1", "", "-0", "2"];
  return keys.map((k) => String(a[k])).join(",");
}
export function typed(u, f) {
  const i = 1;
  u[0] = 300; u[i] += 2; f[i] = 2.5; f[0] *= 3;
  return [u[0], u[i], u[2], String(u[5]), f[0], f[i], u.length].join(",");
}
export function accessors() {
  const log = [];
  const obj = { set v(x) { log.push("set " + x); }, get v() { log.push("get"); return "getter"; } };
  const r = (obj.v = "five");
  const target = { get k() { log.push("k"); return 1; } };
  const holder = { get o() { log.push("receiver"); return target; } };
  const arr = [];
  arr[(log.push("key"), 0)] = (log.push("rhs"), holder.o.k);
  return [r, log.join(";"), arr[0]].join(" ");
}
