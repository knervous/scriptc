// Spreading the element of an array callback into a fresh literal whose fields are all
// required: the element is a required record (never absent), so every field copies with
// no earlier contributor and the extra field is added.
type Part = { colors: Float32Array | null; count: number; label: string };
const parts: Array<Omit<Part, "count"> & { count: number }> = [];
parts.push({ colors: null, count: 1, label: "a" });
parts.push({ colors: new Float32Array([1, 2]), count: 2, label: "b" });
const extra = [10, 20];
const merged = parts.map((p, i) => ({ ...p, extra: extra[i]! }));
for (const m of merged) console.log(m.label, m.count, m.extra, m.colors === null ? "none" : m.colors.length);
const viaFilter = parts.filter((p) => p.count > 1).map((p) => ({ ...p, tag: "t" + p.count }));
console.log(viaFilter.length, viaFilter[0]!.tag, viaFilter[0]!.label);
export {};
