// Length writes on an untyped array: invalid lengths are a RangeError (they
// once reached the truncation loop as index -1 and trapped).
export function run() {
  const values = JSON.parse('[1,2,3,4]');
  const out = [];
  for (const n of [-1, 1.5, NaN, 4294967296, "x"]) {
    try { values.length = n; out.push("set " + values.length); } catch (e) { out.push(e.name); }
  }
  values.length = "3"; out.push(values.join(","));
  values.length = 1; out.push(values.join(",") + ":" + values.length);
  return out.join(" ");
}
