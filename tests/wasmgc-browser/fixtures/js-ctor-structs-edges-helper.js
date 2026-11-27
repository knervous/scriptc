// Constructor structs at their edges: constructors that are not recognized,
// prototype accessors before and during construction, throws midway, explicit
// returns, replaced prototypes and mass conversion.
var log = [];
var keys = function (o) { return Object.keys(o).join(","); };
var seen = [];
function register(o) { seen.push(keys(o)); }
// `this` escapes before the body ends, or is read: not recognized (generic objects).
function Escape(a) { this.a = a; register(this); this.b = 2; }
function Self(a) { this.a = a; this.b = this.a + 1; }
// A prototype setter exists before construction: the setter takes the put.
function Guarded(v) { this.v = v; this.w = 1; }
Object.defineProperty(Guarded.prototype, "v", { get: function () { return "get:" + this._v; }, set: function (x) { log.push("set v " + x); this._v = x; } });
// A setter defined while the body runs (by its own RHS): later puts see it.
function Late(x) { this.a = x; this.b = defineLater(); this.c = 3; this.d = 4; }
function defineLater() { Object.defineProperty(Late.prototype, "c", { set: function (x) { log.push("late c " + x); }, configurable: true }); return "b"; }
// A getter-only prototype property: the put throws (strict module code).
function ReadOnly(x) { this.y = x; this.x = 2; }
Object.defineProperty(ReadOnly.prototype, "x", { get: function () { return 1; } });
// A throw midway: the half-built object is never seen.
function Throws(a) { this.a = a; this.b = check(a); this.c = 1; }
function check(a) { if (a < 0) throw new RangeError("negative " + a); return a * 2; }
// Not recognized: an explicit return, a repeated key, a __proto__ put.
function Returns() { this.x = 1; return { y: 2 }; }
function Twice() { this.a = 1; this.a = 2; this.b = 3; }
var base = { inherited: "yes" };
function Proto() { this.__proto__ = base; this.own = 1; }
function Plain(a, b) { this.a = a; this.b = b; }
function mk(x) { return x; }
export function run() {
  var out = [];
  var e = new Escape(1); out.push(seen.join("|"), keys(e), e.b);
  var s = new Self(4); out.push(keys(s), s.b);
  var g = new Guarded(5); out.push(keys(g), g.v, g._v, log.join("|"));
  log.length = 0;
  var l1 = new Late(1); out.push(keys(l1), l1.c, log.join("|"));
  var l2 = new Late(2); out.push(keys(l2), log.join("|"));
  try { new ReadOnly(7); out.push("no throw"); } catch (err) { out.push(err instanceof TypeError); }
  try { new Throws(-1); out.push("no throw"); } catch (err) { out.push(err instanceof RangeError, err.message); }
  var t = new Throws(3); out.push(keys(t), t.b);
  var R = mk(Returns); out.push(JSON.stringify(new R()), JSON.stringify(new Twice()), new Proto().inherited, keys(new Proto()));
  // A prototype that is not an object: the default Object.prototype.
  Plain.prototype = 42; var p = new Plain(1, 2); out.push(keys(p), Object.getPrototypeOf(p) === Object.prototype, typeof p.hasOwnProperty);
  Plain.prototype = { kind: "plain" }; var q = new Plain(3, 4); out.push(q.kind, keys(q));
  // Identity.
  var pair = []; pair.push(p); pair.push(q); var at = -1; for (var z = 0; z < pair.length; z++) if (pair[z] === q) at = z; out.push(at, q === q, p === q);
  // A setter added to a prototype after objects exist: new objects honor it, old ones keep their own data.
  var before = new Plain(5, 6);
  Object.defineProperty(Plain.prototype, "b", { set: function (x) { log.push("plain b " + x); }, configurable: true });
  log.length = 0; var after = new Plain(7, 8); out.push(keys(before), before.b, keys(after), log.join("|"));
  before.b = 60; out.push(before.b, log.join("|"));
  return out.join(" ; ");
}
// Many conversions: past the constructor's limit `new` goes back to ordinary objects; all stay correct.
function Cell(i) { this.i = i; this.sq = i * i; }
export function mass() {
  var cells = [], total = 0;
  for (var i = 0; i < 1500; i++) { var c = new Cell(i); if (i % 2) c.odd = true; cells.push(c); }
  for (var j = 0; j < cells.length; j++) total += cells[j].sq + (cells[j].odd ? 1 : 0) + Object.keys(cells[j]).length;
  return [total, keys(cells[0]), keys(cells[1499]), keys(cells[1498])].join(" ; ");
}
