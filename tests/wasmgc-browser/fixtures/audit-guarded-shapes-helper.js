class Box { constructor(x) { this.x = x; } get twice() { return this.x * 2; } }
function read(v) { return v.x; }
function write(v, x) { v.x = x; }
export function shapes(page) {
  const out = []; let hits = 0;
  // Same shape: one object turns its property into an accessor after the cache is warm.
  const a = { x: 1, y: 2 }, b = { x: 3, y: 4 };
  out.push(read(a), read(b), read(a), read(b));
  Object.defineProperty(b, "x", { get() { hits++; return 30; }, set(v) { hits += v; }, configurable: true });
  out.push(read(a), read(b), read(b), hits);
  write(a, 5); write(b, 100); out.push(read(a), read(b), hits);
  // Prototype changes under a warm cache: inherited, then shadowed, then removed.
  const proto = { x: 7 }, c = {}; Object.setPrototypeOf(c, proto);
  out.push(read(c)); proto.x = 8; out.push(read(c));
  Object.setPrototypeOf(c, { x: 9 }); out.push(read(c));
  c.x = 10; out.push(read(c)); page.auditDeleteKey(c, "x"); out.push(read(c));
  // Deletes and re-adds change slot order.
  const d = { x: 1, y: 2, z: 3 }; out.push(read(d)); page.auditDeleteKey(d, "x"); out.push(String(read(d))); d.x = 11; out.push(read(d), Object.keys(d).join(""));
  // Non-writable via defineProperty on a cache-warm shape.
  const g = { x: 1 }; write(g, 2); Object.defineProperty(g, "x", { writable: false });
  try { write(g, 3); out.push("no throw"); } catch (e) { out.push(e.name); } out.push(read(g));
  // Inherited setter on a fresh object of the root shape.
  let set = 0; const withSetter = {}; Object.setPrototypeOf(withSetter, { set x(v) { set = v; }, get x() { return -1; } });
  write(withSetter, 14); out.push(set, read(withSetter), Object.keys(withSetter).length);
  // Class instances, getters and an expando on the class through the same sites.
  const box = new Box(15); out.push(read(box), box.twice); write(box, 16); out.push(read(box), box.twice);
  // Page-made objects and page mutation behind a warm cache.
  const made = page.auditMake2(); out.push(read({ x: made.n }), made.label);
  const h = { x: 1, n: 2 }; out.push(read(h)); page.auditDeleteKey(h, "x"); out.push(String(read(h)));
  page.auditTouch(h); out.push(h.n);
  const acc = page.auditMakeAccessor(); out.push(acc.n, acc.n, page.auditAccessorHits());
  return out.join("|");
}
