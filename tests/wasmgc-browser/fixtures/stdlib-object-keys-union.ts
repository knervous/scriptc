// @options: {"interfaceClassArms": true}
// Object.keys(frag) as Union[] where frag is a narrowed `Partial<Record<Union,
// string>> | null` returned by an optional interface method.
type Point = "A" | "B" | "C";
interface Plugin { getCustomCode?(kind: "v" | "f"): Partial<Record<Point, string>> | null }
const plugins: Plugin[] = [
  { getCustomCode: (k) => (k === "f" ? { A: "a1", C: "c1" } : null) },
  {},
  { getCustomCode: () => ({ B: "b2" }) },
];
const out: string[] = [];
for (const p of plugins) {
  const frag = p.getCustomCode?.("f");
  if (frag) {
    for (const point of Object.keys(frag) as Point[]) {
      const code = frag[point];
      if (!code) continue;
      out.push(point + "=" + code);
    }
  }
}
console.log(out.join(","));
