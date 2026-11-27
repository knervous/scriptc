// Objects built by recognized constructors (experimentalJsConstructorStructs)
// behave as the generic objects would on every semantic surface.
function Fiber(tag, key, mode) {
  this.tag = tag;
  this.key = key;
  this.sibling = this.child = this.return = null;
  this.index = 0;
  this.flags = this.lanes = 0;
  this.mode = mode;
  this.alternate = null;
}
Fiber.prototype.describe = function () { return this.tag + ":" + this.key + ":" + this.flags; };
Fiber.prototype.isFiber = true;
function Root(container) { this.tag = 1; this.container = container; this.current = null; this.pending = 0; }
var keys = function (o) { return Object.keys(o).join(","); };
var forIn = function (o) { var r = []; for (var k in o) r.push(k); return r.join(","); };
export function make(tag, key) { return new Fiber(tag, key, 1); }
export function basics() {
  var out = [], a = new Fiber(3, "a", 1), b = new Fiber(5, null, 0);
  // Reads, writes, chained puts, prototype members, order and enumeration.
  a.flags |= 4; a.lanes = a.lanes | 16; a.child = b; b.return = a; b.index = a.index + 2;
  out.push(a.describe(), b.describe(), a.flags, a.lanes, a.child === b, b.return === a, b.index, a.isFiber, a.missing);
  out.push(keys(a), forIn(b), JSON.stringify(b, function (k, v) { return k === "return" ? undefined : v; }));
  out.push("child" in a, "isFiber" in a, a.hasOwnProperty("isFiber"), a.hasOwnProperty("flags"), Object.getPrototypeOf(a) === Fiber.prototype);
  out.push(Fiber.prototype.isPrototypeOf(a), JSON.stringify(Object.getOwnPropertyDescriptor(a, "key")));
  // Computed keys reach the same properties.
  var k = "fl" + "ags"; a[k] = 9; out.push(a.flags, a["ta" + "g"], keys(Object.assign({}, b)).length, JSON.stringify(new Root("c")));
  var spread = Object.assign({ extra: 1 }, a); out.push(keys(spread).split(",").length, spread.flags);
  return out.join(" ; ");
}
export function reshape() {
  var out = [];
  // Expandos: appended after the constructor's keys; old fields keep their values.
  var e = new Fiber(1, "e", 2); e.extra = "x"; e.flags = 3;
  out.push(keys(e), e.extra, e.flags, e.mode, e.describe());
  // Integer-like keys enumerate first.
  var n = new Fiber(2, "n", 0); n[7] = "seven"; n["1"] = "one"; out.push(keys(n), n[7]);
  // Delete, then re-add at the end.
  var d = new Fiber(4, "d", 0); delete d.key; out.push("key" in d, d.key, keys(d)); d.key = "again"; out.push(keys(d), d.describe());
  // Attributes: frozen, read-only and hidden properties.
  var f = new Fiber(6, "f", 0); Object.defineProperty(f, "flags", { writable: false, configurable: false });
  try { f.flags = 99; out.push("written"); } catch (err) { out.push(err instanceof TypeError); }
  try { delete f.flags; out.push("deleted"); } catch (err) { out.push(err instanceof TypeError); }
  out.push(f.flags, JSON.stringify(Object.getOwnPropertyDescriptor(f, "flags")), keys(f));
  var h = new Fiber(7, "h", 0); Object.defineProperty(h, "mode", { enumerable: false }); out.push(keys(h), h.mode);
  var g = new Fiber(8, "g", 0); Object.defineProperty(g, "key", { get: function () { return "got"; } }); out.push(g.key, keys(g));
  // A non-number where a number was (fields take any value).
  var s = new Fiber(9, "s", 0); s.flags = "many"; s.index = null; s.lanes = { n: 1 }; out.push(s.flags, s.index, s.lanes.n, typeof s.flags);
  // Prototype changed after construction.
  var p = new Fiber(10, "p", 0); Object.setPrototypeOf(p, { describe: function () { return "other"; } }); out.push(p.describe(), p.isFiber, p.tag);
  return out.join(" ; ");
}
export function calls() {
  var out = [];
  // Called without new (module code is strict: `this` is undefined).
  try { Fiber(1, "x", 0); out.push("no throw"); } catch (err) { out.push(err instanceof TypeError); }
  // Called on another receiver.
  var o = { first: 1 }; Fiber.call(o, 2, "o", 0); out.push(keys(o), o.describe === undefined, o.tag);
  // Subclass through the prototype chain: the base constructor runs on the subclass's object.
  function Sub(tag) { Fiber.call(this, tag, "sub", 3); this.subOnly = true; }
  Object.setPrototypeOf(Sub.prototype, Fiber.prototype);
  Sub.prototype.describe = function () { return "sub:" + Fiber.prototype.describe.call(this); };
  var s = new Sub(11); out.push(keys(s), s.describe(), s.isFiber, Object.getPrototypeOf(Object.getPrototypeOf(s)) === Fiber.prototype);
  // A struct object as another constructor's prototype.
  function Child() { this.own = 1; }
  Child.prototype = new Fiber(12, "proto", 0);
  var c = new Child(); out.push(c.tag, c.describe(), keys(c), forIn(c).split(",").length);
  // Many objects of one constructor, mixed with converted ones.
  var list = []; for (var i = 0; i < 40; i++) { var x = new Fiber(i, "k" + i, 0); if (i % 9 === 0) x["e" + i] = i; list.push(x); }
  var sum = 0; for (var j = 0; j < list.length; j++) sum += list[j].tag + (list[j]["e" + j] || 0); out.push(sum, keys(list[9]));
  return out.join(" ; ");
}
export function readBack(v) { return [v.flags, v.pageExtra, keys(v), v.describe()].join(","); }
