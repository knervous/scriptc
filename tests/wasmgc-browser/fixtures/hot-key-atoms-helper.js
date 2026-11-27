// Computed keys that are string boxes: for-in keys (born with their atom),
// keys interned once and reused, keys from ToString in a computed-access
// dispatcher, a key variable reassigned mid-loop, and keys that index arrays.
export function copy(src) { var out = {}; for (var k in src) if (src.hasOwnProperty(k)) out[k] = src[k] * 2; return out; }
export function diff(a, b) { var r = []; for (var k in a) { if (!(k in b) || a[k] !== b[k]) r.push(k); } for (var j in b) if (!a.hasOwnProperty(j)) r.push("+" + j); return r.join(","); }
export function reassign(o) { var s = ""; for (var k in o) { s += k + "=" + o[k] + ";"; k = k === "a" ? "b" : "zz"; s += k + ":" + o[k] + ";"; } return s; }
export function drop(o, keys) { for (var i = 0; i < keys.length; i++) delete o[keys[i]]; return Object.keys(o).join(","); }
export function pick(o, key) { return o[key]; }
export function put(o, key, v) { o[key] = v; return o[key]; }
export function described(o) { var r = []; for (var k in o) { var d = Object.getOwnPropertyDescriptor(o, k); r.push(k + (d && d.writable ? "w" : "-")); } return r.join(","); }
export function symObj(s) { var o = { a: 2 }; o[s] = 1; return o; }
export function symbolCase() { var s = Symbol.for("hot-key-atoms"), o = symObj(s); return pick(o, s) + "," + pick(o, "a"); }
export function odd() { return { zz: "z", c: "C", 3: "three" }; }
export function four() { return { a: 1, b: 2, c: 3, d: 4 }; }
export function withGetter() { return { a: 1, get b() { return 2; } }; }
// for-in over a receiver that is not a local, a key copied to another local,
// and keys deleted or added during the walk (the presence recheck).
export function nested(h) { var s = ""; for (var k in h.inner) { var k2 = k; s += k2 + "=" + h.inner[k2] + (h.inner.hasOwnProperty(k2) ? "+" : "-") + ";"; } return s; }
export function mutating(o) { var s = ""; for (var k in o) { if (k === "a") { delete o.c; o.z = 9; } s += k + ","; } return s + Object.keys(o).join("|"); }
export function copies(o) { var r = []; for (var k in o) { var a = k, b = a; b = b + ""; r.push(o[a] + ":" + o[b] + ":" + (a in o)); } return r.join(","); }
