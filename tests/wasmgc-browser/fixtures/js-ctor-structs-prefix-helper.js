// Constructors whose puts are followed by other code: the struct is complete after the puts, and the
// remainder runs on it (reads, writes of its own properties, `return this`, a throw, an explicit
// return of another object). A remainder that hands `this` on or adds a key keeps the constructor
// ordinary. Every object behaves as a plain constructed object.
function Point(x, y) {
  this.x = x;
  this.y = y;
  this.len = 0;
  this.len = Math.sqrt(this.x * this.x + this.y * this.y);
  if (this.len > 10) { this.x = 10; this.len = -1; }
}
// `return this` after the puts.
function Self(v) {
  this.v = v;
  this.w = v * 2;
  if (this.w > 4) this.v = 0;
  return this;
}
Point.prototype.kind = "point";
function sum(p) { return p.x + p.y; }
function Checked(v) {
  this.v = v;
  this.ok = true;
  if (this.v < 0) throw new RangeError("negative " + this.v);
}
function Maybe(v) {
  this.v = v;
  this.w = 2;
  if (v === 0) return { zero: true };
}
var seen = [];
// Constructors that return a value, called through an untyped alias (the checker rejects `new` on them).
function mk(f) { return f; }
var S = mk(Self), M = mk(Maybe);
function Registered(a) { this.a = a; this.b = 1; seen.push(this); }
function Extended(a) { this.a = a; this.extra = this.a + 1; }
export function points() {
  var out = [], p = new Point(3, 4), q = new Point(30, 40);
  out.push(p.len, sum(p), p.kind, q.x, q.len, Object.keys(q).join(","), JSON.stringify(p));
  for (var i = 0, s = 0; i < 100; i++) { var r = new Point(i, 1); s += r.x + r.len; } out.push(Math.round(s));
  p.z = 5; delete q.y; out.push(Object.keys(p).join(","), Object.keys(q).join(","), sum(p), sum(q), q.kind);
  return out.join(" ");
}
export function others() {
  var out = [];
  out.push(new Checked(2).ok);
  try { new Checked(-3); } catch (e) { out.push(e instanceof RangeError, e.message); }
  out.push(JSON.stringify(new M(0)), JSON.stringify(new M(5)), JSON.stringify(new S(1)), JSON.stringify(new S(3)));
  var r = new Registered(7); out.push(seen.length, seen[0] === r, Object.keys(r).join(","));
  var e = new Extended(4); out.push(e.extra, Object.keys(e).join(","));
  return out.join(" ");
}
