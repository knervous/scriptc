// for-in over native dyn objects while the body mutates them (V8's observable order and skips).
function mk(x) { return x; }
function inherit(proto) { var o = mk({}); Object.setPrototypeOf(o, proto); return o; }
function keysOf(o) { var s = []; for (var k in o) s.push(k); return s.join(","); }
export function basics() {
  var out = [];
  out.push(keysOf({ b: 1, a: 2, 2: "x", 1: "y", 10: "z", c: 3 }));
  out.push(keysOf({}), keysOf(null), keysOf(undefined), keysOf(5), keysOf([7, 8, 9]));
  var f = function () {}; f.x = 1; f.y = 2; out.push(keysOf(f));
  var big = mk({}); for (var i = 0; i < 70; i++) big["k" + i] = i;
  var n = 0, last = ""; for (var k in big) { n++; last = k; } out.push(n + ":" + last);
  var hidden = mk({ a: 1, b: 2, c: 3 }); Object.defineProperty(hidden, "b", { enumerable: false }); out.push(keysOf(hidden));
  var nul = Object.create(null); nul.q = 1; nul.r = 2; out.push(keysOf(nul));
  var del = mk({ a: 1, b: 2, c: 3 }); delete del.b; del.d = 4; out.push(keysOf(del));
  return out.join(" | ");
}
export function mutation() {
  var out = [];
  // Adds are never visited.
  var o = mk({ a: 1, b: 2 }), seen = [];
  for (var k in o) { seen.push(k); o["n" + k] = 1; }
  out.push(seen.join(",") + "/" + Object.keys(o).join(","));
  // Deleting a key not yet visited skips it; deleting a visited one changes nothing.
  o = mk({ a: 1, b: 2, c: 3, d: 4 }); seen = [];
  for (k in o) { seen.push(k); if (k === "a") delete o.c; if (k === "b") delete o.a; }
  out.push(seen.join(","));
  // Delete then re-add a key before its turn: it is visited (the snapshot holds it, and it is present again).
  o = mk({ a: 1, b: 2, c: 3 }); seen = [];
  for (k in o) { seen.push(k + "=" + o[k]); if (k === "a") { delete o.c; o.c = 9; } }
  out.push(seen.join(","));
  // Delete everything mid-walk.
  o = mk({ a: 1, b: 2, c: 3 }); seen = [];
  for (k in o) { seen.push(k); for (var j in o) delete o[j]; }
  out.push(seen.join(","));
  // Many adds in the body move the object to a dictionary shape mid-walk.
  o = mk({ a: 1, b: 2, c: 3 }); seen = [];
  for (k in o) { seen.push(k); for (var i = 0; i < 80; i++) o[k + i] = i; if (k === "a") delete o.c; }
  out.push(seen.join(",") + "/" + Object.keys(o).length);
  // Nested walks over the same object.
  o = mk({ x: 1, y: 2 }); seen = [];
  for (var p in o) for (var q in o) seen.push(p + q);
  out.push(seen.join(","));
  // An index-like key added and one deleted during the walk.
  o = mk({ 1: "a", b: 2, 0: "c" }); seen = [];
  for (k in o) { seen.push(k); if (k === "0") { o[5] = 1; delete o.b; } }
  out.push(seen.join(","));
  return out.join(" | ");
}
export function prototypes() {
  var out = [];
  var proto = mk({ p: 1, shared: 2 }), o = inherit(proto); o.own = 3; o.shared = 4;
  out.push(keysOf(o));
  // Deleting an own key that shadows an inherited one: still visited once (present through the chain).
  var seen = []; for (var k in o) { seen.push(k); if (k === "own") delete o.shared; } out.push(seen.join(","));
  // A non-enumerable own key shadows an enumerable inherited one.
  var o2 = inherit(mk({ h: 1, v: 2 })); Object.defineProperty(o2, "h", { value: 0, enumerable: false }); out.push(keysOf(o2));
  // Changing the prototype mid-walk does not add keys to the walk.
  var o3 = mk({ a: 1, b: 2 }); seen = [];
  for (k in o3) { seen.push(k); Object.setPrototypeOf(o3, { extra: 1 }); }
  out.push(seen.join(",") + "/" + keysOf(o3));
  // Deleting an inherited key not yet visited skips it.
  var base = mk({ i1: 1, i2: 2 }), o4 = inherit(base); o4.z = 0; seen = [];
  for (k in o4) { seen.push(k); if (k === "z") delete base.i2; }
  out.push(seen.join(","));
  function C() { this.f = 1; } C.prototype.m = function () {}; C.prototype.n = 2;
  out.push(keysOf(new C()));
  return out.join(" | ");
}
export function keyUses() {
  var out = [], o = mk({ alpha: 1, beta: 2, gamma: 3 }), held = [], copy = mk({});
  for (var k in o) {
    held.push(k);
    copy[k] = o[k] * 2;
    if (Object.prototype.hasOwnProperty.call(o, k)) out.push(typeof k + ":" + k.length + ":" + (k === "beta") + ":" + (k + "!"));
  }
  out.push(held.join(","), held[1] === "beta", JSON.stringify(copy));
  // The key is reassigned in the body: later uses see the new value.
  var r = [];
  for (let k2 in o) { const before = k2; k2 = k2.toUpperCase(); r.push(before + ">" + k2, typeof k2, Object.prototype.hasOwnProperty.call(o, k2)); k2 = k2 + 1; r.push(k2); }
  out.push(r.join(","));
  // A pre-declared binding keeps the last visited key after the loop.
  var last; for (last in o) {} out.push(last);
  // Keys flow into closures created per iteration.
  var fs = []; for (const k3 in o) fs.push(function () { return k3; }); out.push(fs.map(function (f) { return f(); }).join(","));
  // Labelled continue / break inside the walk.
  var s = []; outer: for (var a in o) { for (var b in o) { if (b === a) continue outer; if (a === "gamma") break outer; s.push(a + b); } } out.push(s.join(","));
  return out.join(" | ");
}
export function accessors() {
  var log = [], o = mk({ a: 1, b: 2, c: 3 });
  Object.defineProperty(o, "g", { get: function () { delete this.c; return 7; }, enumerable: true, configurable: true });
  for (var k in o) log.push(k + "=" + o[k]);
  return log.join(",");
}
