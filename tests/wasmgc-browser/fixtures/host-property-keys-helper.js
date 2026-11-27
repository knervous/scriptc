// Computed keys in object literals (ToPropertyKey of each key value).
export function keyedAll() {
  const sym = Symbol.for("pk"), out = [];
  const keyed = k => { const o = { [k]: 1 }; return Object.keys(o).join(",") + "/" + (o[sym] === 1); };
  for (const k of ["a", "", "01", 1, 1.5, -0, NaN, 1e21, -1, 2 ** 32, 0.1 + 0.2, true, null, undefined]) out.push(keyed(k));
  const o = { [sym]: 2, [3]: "x", ["y"]: 4 };
  out.push(o[sym], o[3], o.y, Object.keys(o).join(","));
  return out.join(" | ");
}
