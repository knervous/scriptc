// @expect: a1 after:a | b2 after:b | none after:zz | c3 after:c | e after:e | f->g after:g
// @expect: x=10 y=20 z=30 w=undefined
// A run of `if (key === "lit")` tests on one string local (the per-class key tables of dynamic class
// access, string switches lowered as chains): at most one body runs, a body that falls through continues
// after the run, an unknown key runs none, and a body that reassigns the key ends the run.
function pick(key: string): string {
  let out = "none";
  if (key === "a") { out = "a1"; }
  if (key === "b") { out = "b2"; }
  if (key === "c") { out = "c3"; }
  if (key === "d") { return "d4"; }
  if (key === "e") { out = "e"; }
  if (key === "f") { key = "g"; out = "f->"; }
  if (key === "g") { out += "g"; }
  return `${out} after:${key}`;
}
console.log(["a", "b", "zz", "c", "e", "f"].map(pick).join(" | "));
const rec: Record<string, number> = { x: 10, y: 20, z: 30 };
console.log(["x", "y", "z", "w"].map((k) => `${k}=${rec[k]}`).join(" "));
