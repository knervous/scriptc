type Draft = { face: string; hair: string; skin: string; n: number };
const base: Draft = { face: "f", hair: "h", skin: "s", n: 1 };
function set(d: Draft, field: "face" | "hair" | "skin", id: string): Draft {
  return { ...d, [field]: id };
}
let calls = 0;
function id(): string { calls++; return "v" + calls; }
const toggles = [{ key: "a" as const }, { key: "b" as const }];
type Opt = { a: boolean; b: boolean; c: number };
function upd(o: Opt, key: "a" | "b", v: boolean): Opt { return { ...o, [key]: v, c: o.c + 1 }; }
console.log(JSON.stringify(set(base, "hair", "X")), JSON.stringify(set(base, "skin", id())), calls);
console.log(JSON.stringify(upd({ a: false, b: false, c: 0 }, toggles[1]!.key, true)));
for (const axis of ["x", "y"] as const) {
  const p = { x: 1, y: 2, z: 3 };
  console.log(JSON.stringify({ ...p, [axis]: 9 }));
}
const rows = (["x", "y", "z"] as const).map((axis) => JSON.stringify({ x: "1", y: "2", z: "3", [axis]: "n" }));
console.log(rows.join("|"));
