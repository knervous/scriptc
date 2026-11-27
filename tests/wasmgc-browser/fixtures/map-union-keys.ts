// Map/Set keys of a union type compare by SameValueZero: same arm and equal value (strings by content,
// numbers with -0 as +0 and NaN as NaN, references by identity, null and undefined each one key);
// iteration returns the original keys in insertion order. (A Map keyed by an optional string field.)
type Item = { id?: string; n: number };
const items: Item[] = [{ id: "a", n: 1 }, { n: 2 }, { id: "b", n: 3 }, { id: "a", n: 4 }, { n: 5 }];
const byId = new Map<string | undefined, number[]>();
for (const it of items) { const list = byId.get(it.id); if (list) list.push(it.n); else byId.set(it.id, [it.n]); }
console.log(byId.size, [...byId.entries()].map(([k, v]) => `${String(k)}=${v.join("+")}`).join(" "), byId.has(undefined), byId.has("c"));
console.log(byId.delete(undefined), byId.has(undefined), byId.size, [...byId.keys()].join(","));

const mixed = new Map<string | number | null, string>();
mixed.set(1, "one"); mixed.set("1", "string one"); mixed.set(null, "null"); mixed.set(-0, "zero"); mixed.set(NaN, "nan");
mixed.set(0, "zero again"); mixed.set(Number("x"), "nan again"); mixed.set(1, "one again");
console.log(mixed.size, mixed.get(1), mixed.get("1"), mixed.get(null), mixed.get(0), mixed.get(-0), mixed.get(NaN), mixed.has("null"));
console.log([...mixed.keys()].map((k) => (typeof k === "number" && Object.is(k, -0) ? "-0" : String(k))).join(","));

const seen = new Set<boolean | string>();
for (const v of [true, "true", false, true, "false", "true"]) seen.add(v);
console.log(seen.size, [...seen].map((v) => typeof v + ":" + String(v)).join(","));

class Node2 { readonly name: string; constructor(name: string) { this.name = name; } }
const a = new Node2("a"), b = new Node2("a");
const owners = new Map<Node2 | string, number>();
owners.set(a, 1); owners.set(b, 2); owners.set("a", 3); owners.set(a, 4);
console.log(owners.size, owners.get(a), owners.get(b), owners.get("a"), owners.get(new Node2("a")));
