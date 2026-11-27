// `new` with up to four arguments invokes a compiled constructor directly;
// its object starts without slots and sizes them by its shape's slack.
export function holder(x, y) { const h = {}; h.a = x; h.b = y; return h; }
export function show(a, b, c) {
  const d = {}; d[c.a] = c.b; const keyed = Object.keys(d).join(""); delete d[c.a];
  return a.a + "," + a.b + "," + b.a + "," + c.b + " " + (a.a === "first") + (a.a === a.b) + (b.b === c.b) + " " + keyed + " " + Object.keys(d).length;
}
export function run(n, PageCtor) {
  const out = [];
  // Constructors with 0, 2, 4 and 5 arguments, and fewer arguments than parameters.
  function C0() { this.n = arguments.length; }
  function C2(x, y) { this.s = x + y; this.n = arguments.length; this.y = typeof y; }
  function C4(p, q, r, s) { this.s = p + q + r + s; this.n = arguments.length; }
  function C5(p, q, r, s, t) { this.s = p + q + r + s + t; this.n = arguments.length; }
  C2.prototype.sum = function () { return this.s; };
  const objs = [new C0(), new C2(n, 3), new C2(n), new C4(1, 2, 3, n), new C5(1, 2, 3, 4, n)];
  let js = "";
  for (let i = 0; i < objs.length; i++) js += JSON.stringify(objs[i]);
  out.push(js);
  out.push(new C2(4, 5).sum() + " " + (Object.getPrototypeOf(new C2(1, 1)) === C2.prototype));
  // A constructor that adds many properties (one slot array sized by slack).
  function Many(v) { for (let i = 0; i < 40; i++) this["p" + i] = v + i; this.last = v; }
  let total = 0;
  for (let r = 0; r < 3; r++) { const m = new Many(r); total += m.p0 + m.p39 + m.last + Object.keys(m).length; }
  out.push(String(total));
  // A page constructor through the same `new`.
  const page = new PageCtor([[1, "one"], [n, "two"]]);
  out.push(page.size + " " + page.get(n));
  return out.join(" | ");
}
