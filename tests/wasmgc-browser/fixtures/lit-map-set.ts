// Literal values as Map/Set keys and values, Record<Mode, T> keys from Object.keys/entries,
// map.get results compared with literals, and Map/Set keyed by runtime-built members.
type Res = "wood" | "stone" | "ore" | "gem";
const ALL: Res[] = ["wood", "stone", "ore", "gem"];

const price = new Map<Res, number>([["wood", 2], ["stone", 3]]);
price.set("ore", 7);
price.set("gem", 50);
price.set("wood", 1);
console.log([...price.keys()].join(","), [...price.values()].join(","), price.size, price.get("ore"), price.has("gem"));
console.log(price.get(("st" + "one") as Res), price.has("go" + "ld" as string as Res), price.get(String.fromCharCode(103, 101, 109) as Res));

// Values that are literals.
const next = new Map<Res, Res>();
for (let i = 0; i < ALL.length; i++) next.set(ALL[i], ALL[(i + 1) % ALL.length]);
let r: Res = "wood";
const path: string[] = [];
for (let i = 0; i < 6; i++) { path.push(r); r = next.get(r)!; }
console.log(path.join(">"), next.get("gem") === "wood", next.get("ore") === next.get("ore"));
console.log(JSON.stringify([...next]), [...next.entries()].map(([k, v]) => k[0] + v[0]).join(""));

// A set of literals.
const owned = new Set<Res>(["wood", "wood", "ore"]);
owned.add("gem");
owned.delete("wood");
owned.add(("wo" + "od") as Res);
console.log([...owned].join(","), owned.has("ore"), owned.has("stone"), owned.size);
const missing = ALL.filter((x) => !owned.has(x));
console.log(missing.join(","));

// Record<Res, T> keys and entries.
// Written in sorted key order: see lit-defect-record-literal-order.
const stock: Record<Res, number> = { gem: 1, ore: 3, stone: 0, wood: 10 };
const keys = Object.keys(stock) as Res[];
let best: Res = keys[0];
for (const k of keys) if (stock[k] * (price.get(k) ?? 0) > stock[best] * (price.get(best) ?? 0)) best = k;
console.log(keys.join(","), best, best === "gem", keys.indexOf(best));
for (const [k, v] of Object.entries(stock) as [Res, number][]) if (k === "ore" || v === 0) console.log("entry", k, v);
for (const k in stock) if ((k as Res) !== "wood") stock[k as Res] = stock[k as Res] + 1;
console.log(JSON.stringify(stock));

// A Map keyed by a literal union holding records, and a WeakMap-free reverse index.
const reverse = new Map<string, Res>();
for (const k of ALL) reverse.set(k.toUpperCase(), k);
console.log(reverse.get("ORE"), reverse.get("ore"), reverse.get("GEM") === "gem", [...reverse.keys()].join(","));

// Map with mixed string keys: literal and runtime string must hit the same entry.
const m = new Map<string, number>();
m.set("stone", 1);
m.set("sto" + "ne", 2);
m.set(ALL[1], 3);
console.log(m.size, m.get("stone"));
