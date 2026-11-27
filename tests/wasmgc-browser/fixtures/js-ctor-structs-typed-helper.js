// Number-only constructor properties are i32 fields (experimentalJsConstructorStructs):
// every value JS can store still reads back exactly, compound updates keep JS order
// and conversions, and a value an i32 cannot hold converts the object.
function Node(tag) {
  this.tag = tag;
  this.flags = this.subtreeFlags = 0;
  this.lanes = 0;
  this.index = -1;
  this.next = null;
}
var keys = function (o) { return Object.keys(o).join(","); };
function num(v) { return Object.is(v, -0) ? "-0" : String(v); }
function show(o) { return num(o.flags) + "/" + num(o.subtreeFlags) + "/" + num(o.lanes) + "/" + num(o.index); }
export function edges() {
  var out = [];
  var a = new Node(1);
  a.flags = 2147483647; a.lanes = -2147483648; out.push(show(a), a.flags + 1, a.lanes - 1);
  a.flags |= 0x40000000; a.lanes >>>= 0; a.subtreeFlags = a.flags << 1; out.push(show(a), typeof a.lanes);
  a.flags ^= -1; a.subtreeFlags >>= 31; a.index = a.index >>> 28; out.push(show(a));
  // Values an i32 cannot hold: the object converts, values stay exact.
  var b = new Node(2); b.flags = 0.5; b.lanes = 2147483648; b.index = -0; b.subtreeFlags = NaN; out.push(show(b), keys(b));
  var c = new Node(3); c.index = "7"; c.flags = null; out.push(show(c), typeof c.index);
  var d = new Node(4); d.lanes = 1e21; d.flags = -Infinity; out.push(show(d));
  // f64 expressions written: int32 results stay fields, others convert.
  var e = new Node(5); for (var i = 0; i < 5; i++) e.index = i * 2; e.flags = e.index * 0.75; out.push(show(e));
  var f = new Node(6); f.lanes = (f.lanes | 4) + 0.25; out.push(show(f));
  return out.join(" ; ");
}
export function compound() {
  var out = [], log = [];
  var n = new Node(7);
  // ToPrimitive of the RHS runs after the old value is read; it may convert the object.
  var rhs = { valueOf: function () { log.push("valueOf"); n.extra = "x"; return 8; } };
  n.flags = 3; n.flags |= rhs; out.push(n.flags, keys(n), log.join("|"));
  var m = new Node(8);
  var del = { valueOf: function () { delete m.flags; return 1; } };
  m.flags = 6; m.flags |= del; out.push(m.flags, keys(m));
  // A compound update used as a value; on a non-struct receiver; through a getter.
  var p = new Node(9); var v = (p.lanes |= 5); var w = (p.lanes &= 4); out.push(v, w, p.lanes);
  var plain = { flags: 1 }; plain.flags |= 6; out.push(plain.flags);
  var acc = { get flags() { log.push("get"); return 2; }, set flags(x) { log.push("set " + x); } }; acc.flags |= 1; out.push(log.join("|"));
  // Strings and other values as operands.
  var q = new Node(10); q.flags |= "12"; q.lanes |= true; q.subtreeFlags |= 1.9; q.index |= -0; out.push(show(q));
  // Many updates in a loop (React's flag and lane updates).
  var r = new Node(11), s = 0; for (var k = 0; k < 64; k++) { r.flags |= 1 << (k % 31); r.lanes = r.lanes & ~(1 << (k % 7)); s += r.flags & 255; } out.push(r.flags, r.lanes, s);
  return out.join(" ; ");
}
export function views() {
  var out = [];
  var a = new Node(12); a.flags = -5; a.lanes = 65536; a.index = 3;
  var vals = []; for (var k in a) vals.push(k + "=" + a[k]); out.push(vals.join(","), JSON.stringify(a), a.flags === -5, a.lanes == "65536");
  var copy = Object.assign({}, a); out.push(JSON.stringify(copy), "flags" in a, a.hasOwnProperty("index"));
  return out.join(" ; ");
}
export function node(tag) { var n = new Node(tag); n.flags = 41; n.lanes = -1; return n; }
