export function box(v) { return v; }
export function probe(o) {
  const proto = Object.getPrototypeOf(o);
  const names = Object.getOwnPropertyNames(proto).sort().join(",");
  const out = [names, typeof proto.addToRef, typeof o.pick, o.len()];
  const r = o.addToRef({ x: 10, y: 20 }, { x: 0, y: 0 });
  out.push(r.x, r.y, o.pick(1, 2, true), proto.pick.call(o, "p", "q", false), proto.addToRef.call(o, { x: 1, y: 1 }, { x: 0, y: 0 }).y);
  return out.join("|");
}
