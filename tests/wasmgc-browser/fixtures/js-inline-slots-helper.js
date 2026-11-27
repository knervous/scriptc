// Native objects with inline slots (experimentalDynInlineSlots 3): every operation on the object
// model across the boundary between the inline fields (slots 0..2) and the overflow array.
// Deletes through untyped parameters (constant keys).
function delA(o) { delete o.a; } function delB(o) { delete o.b; } function delE(o) { delete o.e; } function delY(o) { delete o.y; }
function setF(o) { try { o.f = 9; } catch (err) { return "read-only"; } return "set"; }
function setProto(o, p) { o.__proto__ = p; }
function bare() { const o = {}; setProto(o, null); return o; }
function show(o) { return JSON.stringify(o) + " keys=" + Object.keys(o).join(","); }
function lit() { return { a: 1, b: 2 }; }                       // fewer keys than inline slots
function lit3() { return { a: 1, b: 2, c: 3 }; }                // exactly the inline slots
function lit6() { return { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }; } // spills to the overflow array
function F(x) { this.x = x; this.y = x + 1; this.z = x + 2; this.w = x + 3; this.v = x + 4; }
F.prototype.sum = function () { return this.x + this.y + this.z + this.w + this.v; };
export function basics() {
  const out = [];
  const a = lit(); a.c = 3; a.d = 4; a.e = 5;                    // grows across the boundary
  out.push(show(a));
  const b = lit6(); b.g = 7; b.a = 10; b.f = 60;                 // writes inline and overflow
  out.push(show(b) + " " + (b.a + b.f + b.g));
  const c = {}; for (let i = 0; i < 12; i++) c["k" + i] = i * i;  // computed keys: generic paths
  let s = 0; for (const k in c) s += c[k];
  out.push(show(c) + " sum=" + s);
  const d = lit6(); delB(d); delE(d);                       // deletes shift slots across the boundary
  out.push(show(d) + " " + d.c + "," + d.d + "," + d.f + "," + ("b" in d) + "," + d.e);
  d.b = "B"; d.e = "E"; out.push(show(d));
  const e = lit3(); delA(e); e.z = 26; out.push(show(e));
  const f = new F(10); out.push(show(f) + " " + f.sum());
  f.extra = "x"; delY(f); out.push(show(f) + " " + f.sum());
  return out.join("\n");
}
export function reflection() {
  const out = [];
  const o = lit6();
  Object.defineProperty(o, "b", { value: 20, writable: false, enumerable: true, configurable: true });
  Object.defineProperty(o, "e", { get() { return this.a * 100; }, enumerable: false, configurable: true });
  out.push(show(o) + " b=" + o.b + " e=" + o.e);
  try { "use strict"; o.b = 30; } catch (err) { out.push("ro"); }
  out.push(JSON.stringify(Object.getOwnPropertyDescriptor(o, "e") && typeof Object.getOwnPropertyDescriptor(o, "e").get));
  const spread = { ...lit6(), g: 7, a: 0 }; out.push(show(spread));
  const assigned = Object.assign({ z: 0 }, lit3(), { d: 4, e: 5 }); out.push(show(assigned));
  const six = lit6(); out.push(Object.keys(six).map(k => k + six[k]).join(""));
  const proto = lit6(); const child = { a: "own", q: 1 }; setProto(child, proto);
  out.push(child.a + child.b + child.f + " " + Object.keys(child).join(",") + " " + ("f" in child));
  const ro = lit6(); Object.defineProperty(ro, "f", { value: 66, writable: false }); out.push(setF(ro) + " " + show(ro));
  return out.join("\n");
}
// The same property sites see objects of several layouts (inline caches move between them).
export function polymorphic() {
  const objs = [lit(), lit3(), lit6(), new F(1), { c: 30, b: 20, a: 10 }, bare()];
  objs[5].a = 5; objs[5].b = 6;
  let s = "";
  for (let r = 0; r < 3; r++) for (const o of objs) { s += (o.a ?? "-") + ":" + (o.b ?? "-") + ":" + (o.f ?? "-") + " "; o.b = (o.b ?? 0) + 1; }
  return s;
}
// Many objects through one constructor-like literal site (site sizing) and growth past it.
export function sized() {
  const all = [];
  for (let i = 0; i < 40; i++) { const o = { id: i }; o.name = "n" + i; o.v = i * 2; if (i % 3 === 0) { o.x = 1; o.y = 2; o.z = 3; } all.push(o); }
  return all.reduce((t, o) => t + o.id + o.v + (o.z ?? 0), 0) + " " + JSON.stringify(all[3]) + " " + JSON.stringify(all[4]);
}
