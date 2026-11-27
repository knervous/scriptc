// Chained member assignments in value position on compiled dyn receivers
// (`this.a = this.b = v`, `x.p = y.q = v`): reference-before-value order,
// the RHS value threaded through (never reread), setters run once, and the
// receivers stay compiled objects (no page facade involved).
var log = [];
function Node(tag) {
  this.sibling = this.child = this.parent = null;
  this.flags = this.lanes = 0;
  this.tag = tag;
}
function Proto() {}
Object.defineProperty(Proto.prototype, "v", { get: function () { log.push("get v"); return this._v; }, set: function (x) { log.push("set v=" + x); this._v = x * 2; } });
function obj(name) { log.push("ref " + name); return holder[name]; }
var holder = { a: {}, b: new Proto(), c: {} };
export function run() {
  var out = [];
  var n = new Node(7);
  out.push(Object.keys(n).join(","), n.child === null, n.lanes + n.flags);
  // The expression's value is the RHS, not a reread of a setter-backed property.
  var r = obj("a").x = obj("b").v = obj("c").y = 5;
  out.push(r, holder.a.x, holder.b._v, holder.c.y, log.join("|"));
  // Chains through computed keys and numbers.
  var k = "dyn", m = {};
  m.p = m[k] = m.q = 3.5;
  out.push(JSON.stringify(m));
  // A chain whose inner write throws: earlier references were evaluated, nothing after the throw ran.
  log.length = 0;
  var nil = holder.none === undefined ? null : 0;
  try { obj("a").z = (obj("c").w = 1, nil).boom = 2; } catch (e) { out.push(e instanceof TypeError, e.message, log.join("|"), holder.c.w, "z" in holder.a); }
  return out.join(" ; ");
}
