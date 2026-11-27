// Property-write sites cache one add transition (from-shape -> to-shape, slot).
// The cached add must behave exactly as the generic write: inherited setters
// that appear later, prototype changes, getter-only inherited keys, slot
// growth from small literals, and objects that become dictionaries.
// Exported, so their parameters stay untyped (dyn).
export function keysOf(o) { return Object.keys(o).join(""); }
export function countKeys(o) { return Object.keys(o).length; }
export function dropC(o) { delete o.c; }
export function transitions() {
  const out = [];
  // A constructor's `this.x = ...` sites, warmed, then a setter for "y" on its prototype.
  function Point(x, y) { this.x = x; this.y = y; this.z = x + y; }
  const pts = [];
  for (let i = 0; i < 5; i++) pts.push(new Point(i, i * 2));
  out.push(pts.map(p => keysOf(p) + p.z).join(","));
  const seen = [];
  Object.defineProperty(Point.prototype, "y", { set(v) { seen.push(v); }, get() { return "g" + seen.length; }, configurable: true });
  const q = new Point(7, 8);
  out.push(keysOf(q) + " " + q.y + " " + seen.join("+") + " " + Object.prototype.hasOwnProperty.call(q, "y") + " " + q.z);
  const pointProto = Object.getPrototypeOf(q);
  delete pointProto.y;
  const r = new Point(1, 1);
  out.push(keysOf(r) + " " + r.y + " " + seen.length);

  // One write site, two prototypes with the same from-shape: only B's has a setter.
  function A() {}
  function B() {}
  Object.defineProperty(B.prototype, "k", { set(v) { this.viaSetter = v; }, configurable: true });
  function init(o, v) { o.k = v; return o; }
  const pairs = [];
  for (let i = 0; i < 3; i++) { const a = init(new A(), i), b = init(new B(), i); pairs.push(keysOf(a) + a.k + "/" + keysOf(b) + b.viaSetter); }
  out.push(pairs.join(","));

  // A prototype changed after the site cached its transition.
  function C() {}
  const plain = init(new C(), 1);
  init(new C(), 2);
  Object.setPrototypeOf(C.prototype, B.prototype);
  const c2 = init(new C(), 3);
  out.push(keysOf(plain) + "/" + keysOf(c2) + c2.viaSetter);

  // A getter-only inherited key refuses the write (module code is strict).
  function D() {}
  init(new D(), 1);
  init(new D(), 2);
  Object.defineProperty(D.prototype, "k", { get() { return "fixed"; }, configurable: true });
  try { init(new D(), 3); out.push("no-throw"); } catch (e) { out.push(e instanceof TypeError ? "TypeError" : "other"); }

  // Same from-shape, smaller slot arrays: an exact-size literal meets a warmed site.
  function addY(o) { o.y = 2; o.w = 3; return o; }
  const e = {}; e.x = 1;
  const grown = [addY(e), addY({ x: 1 }), addY({ x: 4 }), addY(Object.assign({}, { x: 5 }))];
  let gs = "";
  for (let i = 0; i < grown.length; i++) gs += JSON.stringify(grown[i]);
  out.push(gs);

  // Many cached adds (slot growth by the shape's slack), then a dictionary.
  function Wide(v) {
    this.a = v; this.b = v + 1; this.c = v + 2; this.d = v + 3; this.e = v + 4; this.f = v + 5; this.g = v + 6; this.h = v + 7;
    this.i = v + 8; this.j = v + 9; this.k2 = v + 10; this.l = v + 11; this.m = v + 12; this.n = v + 13; this.o = v + 14; this.p = v + 15;
    this.q = v + 16; this.r = v + 17; this.s = v + 18; this.t = v + 19; this.u = v + 20; this.v = v + 21; this.w = v + 22; this.x = v + 23;
  }
  const ws = [];
  for (let i = 0; i < 4; i++) ws.push(new Wide(i * 100));
  out.push(ws.map(w => { const keys = Object.keys(w); let s = 0; for (let i = 0; i < keys.length; i++) s += w[keys[i]]; return keys.length + ":" + s + ":" + w.x; }).join(","));
  const big = new Wide(0);
  for (let i = 0; i < 70; i++) big["extra" + i] = i;
  dropC(big);
  const again = new Wide(1);
  out.push(countKeys(big) + " " + big.x + " " + ("c" in big) + " " + countKeys(again) + " " + again.c);
  return out.join(" | ");
}
