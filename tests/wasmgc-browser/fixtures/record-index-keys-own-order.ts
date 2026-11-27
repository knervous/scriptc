// An index-signature record's keys in JS own-key order: canonical array indices ascending by value, then every other
// key in insertion order. Keys that only look numeric ("01", "-1", "1.5", "4294967295", "1e3") are names, not indices.
// Spawn-id-keyed pools (the client's EntityPool) enumerate this way every frame, so a large out-of-order record runs too.
const rec: Record<string, number> = {};
for (const key of ["30", "b", "4294967294", "01", "7", "4294967295", "-1", "a", "0", "1.5", "1e3", "12", "100"]) rec[key] = key.length;
delete rec["7"];
rec["7"] = 99;
delete rec["a"];
console.log(Object.keys(rec).join(","));
console.log(Object.values(rec).join(","));
console.log(Object.entries(rec).map(([k, v]) => `${k}=${v}`).join(" "));
const pool: Record<string, number> = {};
for (let id = 4000; id > 0; id -= 7) pool[String(id)] = id;
pool["name"] = -1;
let sum = 0, ordered = true, previous = -1;
for (let pass = 0; pass < 20; pass++) {
  const keys = Object.keys(pool);
  for (let i = 0; i < keys.length - 1; i++) {
    const at = Number(keys[i]);
    if (at <= previous && i > 0) ordered = false;
    previous = i === 0 ? -1 : at;
  }
  for (const value of Object.values(pool)) sum += value;
}
console.log(Object.keys(pool).length, ordered, Object.keys(pool)[0], Object.keys(pool).at(-1), sum);
