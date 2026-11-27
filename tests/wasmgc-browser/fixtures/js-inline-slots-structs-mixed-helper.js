// Constructor structs whose anyref fields share the object's inline slot fields
// (experimentalDynInlineSlots): int fields come first, so a later property sits in
// an inline field below its own position until the object converts.
var keys = function (o) { return Object.keys(o).join(","); };
var vals = function (o) { var out = []; for (var k in o) out.push(k + "=" + String(o[k])); return out.join(","); };
// i32, i32, any, any, i32, any, any, any: anyref fields 2,3,5,6 share the inline fields.
function Node(tag, key, mode) { this.tag = 0; this.flags = 0; this.key = key; this.type = null; this.lanes = 0; this.ref = null; this.mode = mode; this.extra = tag; }
// Fewer anyref fields than inline slots: the rest stay unused.
function Small(a) { this.n = 0; this.a = a; }
// Only int fields.
function Ints() { this.x = 1; this.y = 2; }
var late = false;
// A setter defined while the body runs converts the half-built object.
function Half(a) { this.f = 0; this.a = a; this.b = maybeDefine(); this.c = "c"; this.d = 7; }
function maybeDefine() { if (late) Object.defineProperty(Half.prototype, "d", { set: function (x) { this._d = "set:" + x; }, configurable: true }); return "b"; }
export function run() {
  var out = [];
  var a = new Node("t", "k", 3);
  out.push(vals(a));
  a.tag = 5; a.flags |= 8; a.key = "k2"; a.type = { name: "T" }; a.ref = [1, 2];
  out.push(vals(a), a.type.name, a.ref.length);
  // An expando converts it: every property keeps its value and order.
  a.expando = "e";
  out.push(vals(a), a.type.name, a.tag + a.flags);
  a.mode = "m"; a.lanes = 2.5;
  out.push(vals(a));
  // A delete converts another one.
  var b = new Node(1, 2, 3);
  delete b.key;
  out.push(vals(b), "key" in b, b.type, b.extra);
  b.key = "back"; out.push(keys(b), b.key);
  // A non-int written to an int field converts it.
  var c = new Node("x", "y", "z");
  c.flags = "not an int";
  out.push(vals(c));
  // defineProperty converts it; the value moves with its attributes.
  var d = new Node(0, 0, 0);
  Object.defineProperty(d, "ref", { value: "ro", writable: false, enumerable: true, configurable: true });
  try { d.ref = "changed?"; } catch (err) { out.push(err instanceof TypeError); }
  out.push(vals(d));
  var s = new Small("s"); s.more = 1; s.more2 = 2; out.push(vals(s));
  var t = new Small(null); delete t.n; out.push(vals(t));
  var i = new Ints(); i.z = "z"; out.push(vals(i));
  var h1 = new Half(1); out.push(vals(h1));
  late = true;
  var h2 = new Half(2); out.push(vals(h2), h2._d);
  // Spread and assign read every field of a struct and of a converted object.
  var e = new Node("t2", "k3", 4);
  out.push(vals(Object.assign({}, e)), vals({ ...a }));
  return out.join(" ; ");
}
// Mass: many objects of one constructor convert, past the demotion limit.
export function mass() {
  var all = [], sum = 0;
  for (var i = 0; i < 700; i++) { var n = new Node(i, "k" + i, i & 3); if (i % 3 === 0) n["x" + (i % 5)] = i; all.push(n); }
  for (var j = 0; j < all.length; j++) { var o = all[j]; sum += o.extra + o.mode + Object.keys(o).length; if (o.key !== "k" + j) return "bad key " + j; }
  return [sum, keys(all[0]), keys(all[1]), vals(all[699])].join(" ; ");
}
