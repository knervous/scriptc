// for-of over compiled arrays iterates them natively while the array iteration
// protocol is the engine's own; everything else takes the iterator protocol.
var show = function (v) { return v === undefined ? "u" : String(v); };
export function basics() {
  var out = [];
  var a = [1, "two", null, undefined, { k: 3 }, [4, 5]];
  for (var x of a) out.push(typeof x === "object" && x !== null ? JSON.stringify(x) : show(x));
  // Holes read undefined.
  var h = [1, , 3]; h[5] = 6;
  var hs = []; for (var y of h) hs.push(show(y)); out.push(hs.join("|"));
  // Growth during iteration is seen (the length is read each step); shrinking stops early.
  var g = [1, 2, 3], gs = [];
  for (var z of g) { gs.push(z); if (z < 3 && g.length < 6) g.push(z + 10); }
  out.push(gs.join(","));
  var s = [1, 2, 3, 4, 5], ss = [];
  for (var w of s) { ss.push(w); s.pop(); }
  out.push(ss.join(","), s.length);
  // Element writes ahead of the cursor are seen.
  var e = [1, 2, 3], es = [];
  for (var v of e) { es.push(v); if (v === 1) e[2] = 30; }
  out.push(es.join(","));
  // Empty.
  var n = 0; for (var q of []) n++; out.push(n);
  return out.join(" ; ");
}
export function control() {
  var out = [];
  var a = [5, 6, 7, 8, 9];
  for (var x of a) { if (x === 6) continue; if (x === 8) break; out.push(x); }
  outer: for (var i of [1, 2, 3]) { for (var j of [10, 20, 30]) { if (j === 20) continue outer; if (i === 3) break outer; out.push(i * j); } }
  var find = function (arr, t) { for (var v of arr) if (v === t) return "found " + v; return "none"; };
  out.push(find(a, 7), find(a, 70));
  try { for (var k of a) { if (k === 7) throw new Error("stop at " + k); } } catch (err) { out.push(err.message); }
  // Per-iteration bindings captured by closures.
  var fns = [];
  for (let m of ["a", "b", "c"]) fns.push(function () { return m; });
  out.push(fns.map(function (f) { return f(); }).join(""));
  // Destructuring heads.
  var pairs = [[1, "one"], [2, "two"]], ps = [];
  for (var pair of pairs) ps.push(pair[0] + "=" + pair[1]);
  for (var { id, tag = "none" } of [{ id: 1 }, { id: 2, tag: "t" }]) ps.push(id + ":" + tag);
  out.push(ps.join(","));
  // A pre-declared loop variable.
  var last; for (last of [3, 4]) ; out.push(last);
  return out.join(" ; ");
}
export function others() {
  var out = [];
  var cs = []; for (var c of "héllo") cs.push(c); out.push(cs.join("."));
  var m = new Map([["a", 1], ["b", 2]]), ms = []; for (var kv of m) ms.push(kv[0] + kv[1]); out.push(ms.join(","));
  var st = new Set([3, 1, 3, 2]), sts = []; for (var t of st) sts.push(t); out.push(sts.join(","));
  var closed = 0;
  var custom = { [Symbol.iterator]() { var i = 0; return { next: function () { i++; return { value: i, done: i > 3 }; }, return: function () { closed++; return { value: undefined, done: true }; } }; } };
  for (var cv of custom) { if (cv === 2) break; out.push("c" + cv); }
  out.push("closed " + closed);
  try { for (var bad of 42) out.push(bad); } catch (err) { out.push("not iterable"); }
  return out.join(" ; ");
}
// The array iteration protocol changed by the program while a loop runs.
export function patched() {
  var out = [];
  // A `return` added to the array iterator prototype while a loop runs: an early exit calls it.
  var iterProto = Object.getPrototypeOf([][Symbol.iterator]());
  var calls = [];
  var arr = [10, 20, 30, 40];
  for (var z of arr) {
    if (z === 10) iterProto.return = function () { calls.push("return after " + this.next().value); return {}; };
    if (z === 20) break;
  }
  delete iterProto.return;
  out.push(calls.join(","));
  var after = []; for (var w of arr) { after.push(w); if (w === 20) break; } out.push(after.join(","), calls.length);
  return out.join(" ; ");
}
