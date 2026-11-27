// Map get followed by set of the same key reuses the read's entry (map-fusion.ts) when only inert code runs between.
// Hits and misses, an intervening call that mutates the map, delete/clear between, equal strings that are different
// objects, number keys (-0, NaN, negatives, large, fractional), and insertion order must match Node.

function show(label: string, m: Map<string, number>): void {
  const parts: string[] = [];
  for (const [k, v] of m) parts.push(k + "=" + v);
  console.log(label, m.size, parts.join(" "));
}
function showNum(label: string, m: Map<number, number>): void {
  const parts: string[] = [];
  for (const [k, v] of m) parts.push((Object.is(k, -0) ? "-0" : String(k)) + "=" + v);
  console.log(label, m.size, parts.join(" "));
}

// Counting: the first occurrence misses and inserts, later ones hit and overwrite in place.
const words = "the cat and the hat and the bat sat on the mat".split(" ");
const counts: Map<string, number> = new Map();
for (const w of words) {
  const cur = counts.get(w);
  counts.set(w, (cur === undefined ? 0 : cur) + 1);
}
show("counts", counts);

// The single-statement form.
const lengths: Map<string, number> = new Map();
for (const w of words) lengths.set(w, (lengths.get(w) ?? 0) + w.length);
show("lengths", lengths);

// Equal strings that are different objects: built fresh for each read and each write.
const fresh: Map<string, number> = new Map();
for (let i = 0; i < 8; i++) {
  const k = "id" + (i % 3);
  const got = fresh.get(k);
  fresh.set("i" + "d" + (i % 3), (got ?? 0) + i);
  const key2 = ["i", "d", String(i % 3)].join("");
  fresh.set(key2, (fresh.get(key2) ?? 100) + 1);
}
show("fresh", fresh);

// An intervening call that mutates the map must not fuse (the entry it found moves or dies).
let calls = 0;
function bump(m: Map<string, number>, k: string): number {
  calls++;
  m.delete(k);
  m.set("zz" + calls, calls);
  return 7;
}
const mut: Map<string, number> = new Map([["a", 1], ["b", 2], ["c", 3]]);
const va = mut.get("a");
mut.set("a", (va ?? 0) + bump(mut, "a"));
show("call between", mut);
const vb = mut.get("b");
mut.set("b", bump(mut, "b") + (vb ?? 0));
show("call in value", mut);
mut.set("c", (mut.get("c") ?? 0) + bump(mut, "c"));
show("call single", mut);
// A call that grows the table (rebuild moves every entry).
function grow(m: Map<string, number>): number {
  for (let i = 0; i < 50; i++) m.set("g" + i, i);
  return 1;
}
const gm: Map<string, number> = new Map([["x", 10], ["y", 20]]);
const gy = gm.get("y");
gm.set("y", (gy ?? 0) + grow(gm));
console.log("grown y", gm.get("y"), gm.size, [...gm.keys()].slice(0, 4).join(","));

// delete or clear between the read and the write.
const dm: Map<string, number> = new Map([["k1", 1], ["k2", 2], ["k3", 3]]);
const d1 = dm.get("k1");
dm.delete("k1");
dm.set("k1", (d1 ?? 0) + 1);
show("deleted", dm);
const d2 = dm.get("k2");
dm.set("k2", (d2 ?? 0) + (dm.delete("k3") ? 100 : 0));
show("delete inside", dm);
const d3 = dm.get("k2");
dm.clear();
dm.set("k2", (d3 ?? 0) + 1);
show("cleared", dm);

// The write goes to another map, or another key, or the key local changes between.
const a: Map<string, number> = new Map([["p", 1], ["q", 2]]);
const other: Map<string, number> = new Map([["p", 50]]);
const p1 = a.get("p");
other.set("p", (p1 ?? 0) + 1);
const q1 = a.get("q");
a.set("r", (q1 ?? 0) + 3);
const alias = a;
const p2 = a.get("p");
alias.set("p", (p2 ?? 0) + 10);
let kk = "p";
let held = a.get(kk);
kk = "q";
a.set(kk, (held ?? 0) + 1000);
show("a", a);
show("other", other);

// Field-path keys (records), behind conditions and continues.
type Row = { cat: string; v: number };
function aggregate(rows: Row[]): Map<string, number> {
  const agg: Map<string, number> = new Map();
  for (const r of rows) {
    if (r.v < 0) continue;
    const cur = agg.get(r.cat);
    agg.set(r.cat, (cur === undefined ? 0 : cur) + r.v);
  }
  return agg;
}
show("aggregate", aggregate([{ cat: "b", v: 2 }, { cat: "a", v: 1 }, { cat: "b", v: -5 }, { cat: "c", v: 4 }, { cat: "a", v: 8 }]));

// Number keys: SameValueZero (-0 is +0, NaN is NaN), negatives, large and fractional keys.
const nums: Map<number, number> = new Map();
const keys = [1, NaN, -0, 0, 2, NaN, 0, -0, 1, -3, 1e300, 0.5, -3, 0.5, 2 ** 53, 2 ** 53 + 2, 1e300, 4294967296, -0.25, -0.25];
for (const k of keys) {
  const prev = nums.get(k);
  nums.set(k, prev === undefined ? 100 : prev + 1);
}
showNum("nums", nums);
for (const k of keys) nums.set(k, (nums.get(k) ?? 0) * 2);
showNum("nums doubled", nums);
console.log("has -0", nums.has(-0), "get 0", nums.get(0), "get NaN", nums.get(NaN), "get -3", nums.get(-3));

// Boolean and reference values overwrite in place too.
const flags: Map<string, boolean> = new Map();
for (let i = 0; i < 7; i++) {
  const k = "f" + (i % 3);
  const f = flags.get(k);
  flags.set(k, f === undefined ? true : !f);
}
console.log("flags", [...flags.entries()].map(([k, v]) => k + ":" + v).join(" "));
const lists: Map<string, string> = new Map();
for (const w of words) { const prev = lists.get(w[0]!); lists.set(w[0]!, (prev ?? "") + w); }
console.log("lists", [...lists.entries()].map(([k, v]) => k + ":" + v).join(" "));

// A NaN value is stored and read back.
const nanValues: Map<string, number> = new Map([["x", 1]]);
const x0 = nanValues.get("x");
nanValues.set("x", (x0 ?? 0) * NaN);
console.log("nan value", nanValues.get("x"));

// A throwing value leaves the map as it was.
const tm: Map<string, number> = new Map([["t", 1]]);
const rows: (Row | undefined)[] = [{ cat: "t", v: 1 }, undefined];
for (const r of rows) {
  try {
    const cur = tm.get("t");
    tm.set("t", (cur ?? 0) + r!.v);
  } catch (e) {
    console.log("threw", e instanceof TypeError);
  }
}
show("after throw", tm);
