// Untyped side of ui-typed-collections-dyn.ts: React state holding a typed Map.
export function useMap(m, s) {
  const out = [];
  out.push(m.get(1), m.get(2), m.get("1"), m.has(1), m.has("x"), m.size);
  m.set(3, { name: "flux" });
  m.delete(1);
  const seen = [];
  m.forEach((v, k, self) => { seen.push(`${k}=${v.name}`); if (k === 2) self.set(9, { name: "late" }); });
  out.push(seen.join(";"), m.size);
  s.add("c"); out.push(s.has("a"), s.has(7), s.size);
  return out.join(",");
}
