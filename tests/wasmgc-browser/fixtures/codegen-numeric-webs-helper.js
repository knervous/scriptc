// Numeric webs: a reused untyped local whose runs only hold numbers gets an
// f64 local per run. Runs that mix in other values (strings through +, objects,
// valueOf), runs reaching a catch or finally, labeled loops, switch fallthrough,
// captured locals and parameters reused as counters keep JS semantics.
// Minified-style variable reuse: one untyped local holds objects, then numbers.
export function memo(fiber, size) {
  var current = fiber.alternate, q = null;
  if (current !== null) { current = current.updateQueue; if (current !== null) q = current.cache; }
  if (q == null) q = [];
  var data = q[0];
  if (data === undefined) for (data = q[0] = Array(size), current = 0; current < size; current++) data[current] = "S";
  return [data.length, data.join(""), typeof current, current, q.length].join("|");
}
function id(x) { return x; }
export function loops(list) {
  var a = list, out = [];
  for (a = 0; a < list.length; a++) { if (list[a] === "skip") continue; if (list[a] === "stop") break; out.push(a); }
  var b = a; b++; out.push(b, typeof b);
  var c = id("x"); c = 3; c--; out.push(c);
  var d = list; d = 0; while (d < 3) { d++; if (d === 2) d = id("two"); } out.push(d, typeof d);
  var e = 0; do { e += 1; } while (e < 4); out.push(e);
  var f = 5; f = f > 3 ? 1 : 2; out.push(f);
  var g = id(0); g = list.length > 1 ? 1 : "one"; g++; out.push(g);
  var h = id(0); try { h = 1; h = JSON.parse("{"); } catch (err) { out.push(typeof h, h); } h++; out.push(h);
  var k = 0; try { k = 7; } finally { k++; } out.push(k);
  var m = 0; lbl: for (var i = 0; i < 3; i++) { for (m = 0; m < 3; m++) { if (m === 1) continue lbl; if (i === 2) break lbl; } } out.push(i, m);
  var n = 0; switch (list.length) { case 0: n = "zero"; break; case 3: case 4: n = n === 0 ? 3 : n; n++; break; default: n = list; } out.push(n);
  var p = 1; p = (p = 4, p + 1); out.push(p);
  var r = 0, s = list; for (r = 0; r < 2; r++) s = r; out.push(s, r);
  var t = id(0); t = t + "1"; out.push(t, typeof t);
  var u = -0; u++; u--; out.push(Object.is(u, -0), 1 / u);
  var v = 2 ** 53; v++; out.push(v);
  var w = NaN; w++; out.push(w);
  var x = 0; x = list[0] || 5; x++; out.push(x);
  var y = 0; for (var z of list) { y = z; } out.push(y);
  var aa = 0; aa = list.length && 7; aa++; out.push(aa);
  var bb = id(0); if (list.length > 100) { bb = "big"; } bb++; out.push(bb);
  var cc = id({ valueOf() { return 9; } }); cc++; out.push(cc);
  var dd = id("5"); dd++; out.push(dd, typeof dd);
  var ee = 0; function inner() { return ee; } ee = 3; ee++; out.push(inner());
  return out.join(",");
}
export function lanes(root, wip) {
  var pending = root.pendingLanes;
  if (0 === pending) return 0;
  var next = 0, susp = root.suspendedLanes, ping = root.pingedLanes;
  root = root.warmLanes;
  var nonIdle = pending & 134217727;
  0 !== nonIdle ? (pending = nonIdle & ~susp, 0 !== pending ? next = pending & -pending : (ping &= nonIdle, 0 !== ping ? next = ping & -ping : (root = nonIdle & ~root, 0 !== root && (next = root & -root)))) : (nonIdle = pending & ~susp, 0 !== nonIdle ? next = nonIdle & -nonIdle : 0 !== ping ? next = ping & -ping : (root = pending & ~root, 0 !== root && (next = root & -root)));
  return 0 === next ? 0 : 0 !== wip && wip !== next && 0 === (wip & susp) && (susp = next & -next, root = wip & -wip, susp >= root || (32 === susp && 0 !== (root & 4194048))) ? wip : next;
}
// Parameters reused as counters; the arguments object keeps parameters whole.
export function params(a, n, s) {
  var out = [a];
  for (a = 0; a < n; a++) out.push(a * 2);
  out.push(a, typeof a);
  s = s + 1; out.push(s, typeof s);
  n = n - 0.5; out.push(n);
  return out.join(",");
}
export function withArguments(a, b) {
  var out = [];
  a = 5; a++;
  out.push(a, arguments.length, typeof arguments[0], b);
  return out.join(",");
}
export function captured(list) {
  var k = list; k = 0;
  var read = function () { return k; };
  for (; k < 3; k++);
  return read() + ":" + typeof read();
}
export function mixed(o) {
  var x = o.start;           // anything
  x = 2147483647; x++;       // beyond int32
  var big = x;
  x = -0; x--; x++;          // -0 survives as a number
  var negz = 1 / x;
  x = o.start; x = x * 1;    // NaN from an object without valueOf
  var nan = x;
  x = 0; x = x + o.v;        // valueOf on an arithmetic path
  var vo = x;
  x = 1; x = x + "1";        // string concatenation through +
  var str = x;
  return [big, negz, nan, vo, str, typeof str].join(",");
}
