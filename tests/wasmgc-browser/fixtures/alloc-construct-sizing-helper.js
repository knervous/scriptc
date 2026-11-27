// `new` sites remember how large their objects became; objects of every size stay correct.
function Node(tag, extra) {
  this.tag = tag; this.key = null; this.child = null; this.index = 0;
  if (extra) for (var i = 0; i < extra; i++) this["x" + i] = i;
}
Node.prototype.describe = function () { return Object.keys(this).length + ":" + this.tag; };
function Root(tag) { this.tag = tag; for (var i = 0; i < 30; i++) this["r" + i] = i; }
function Swap(v) { this.v = v; return v > 1 ? { swapped: v } : undefined; }
function Many() { for (var i = 0; i < 80; i++) this["m" + i] = i; delete this.m3; }
function mk(x) { return x; }
function make(n) { return new Node("n" + n, n % 3 === 0 ? n : 0); }
export function run() {
  var out = [], root = new Root("root");
  var nodes = []; for (var i = 0; i < 12; i++) nodes.push(make(i));
  out.push(nodes.map(function (n) { return n.describe(); }).join(","));
  // Keys added after construction (beyond the site's size) and reads of every key.
  var n = nodes[1]; n.later = "L"; n.again = 2; out.push(Object.keys(n).join("|"), n.later + n.again + n.tag + n.index);
  var big = nodes[9]; out.push(big.x8, Object.keys(big).length, JSON.stringify(nodes[3]));
  out.push(Object.keys(root).length, root.r29, root.tag);
  var S = mk(Swap); out.push(JSON.stringify(new S(1)), JSON.stringify(new S(2)), JSON.stringify(new S(3)));
  var many = new Many(); out.push(Object.keys(many).length, many.m79, String(many.m3), "m3" in many);
  // Instances keep their prototype and instanceof.
  out.push(Object.getPrototypeOf(nodes[0]) === Node.prototype, nodes[0].describe === nodes[5].describe);
  // Same site, shrinking objects after large ones.
  var small = []; for (var j = 0; j < 4; j++) small.push(make(1)); out.push(small.map(function (x) { return x.describe(); }).join(","));
  for (var k = 0; k < 4; k++) { small[k]["k" + k] = k; } out.push(small.map(function (x) { return Object.keys(x).join(""); }).join(","));
  return out.join(" ; ");
}
