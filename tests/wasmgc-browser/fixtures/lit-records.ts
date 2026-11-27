// Literal unions in record and object-literal fields: required and optional `kind?` fields,
// discriminated unions with if-chains on `kind`, destructuring, JSON.stringify/parse round trips,
// Object.keys/entries, spread copies, `in`, and objects whose keys are literal values.
type Kind = "melee" | "ranged" | "spell";
interface Attack { kind: Kind; name: string; tier?: "low" | "mid" | "high"; }
type Ev = { type: "hit"; amount: number } | { type: "miss" } | { type: "crit"; amount: number; mult: number };

const attacks: Attack[] = [
  { kind: "melee", name: "slash", tier: "low" },
  { kind: "ranged", name: "shot" },
  { kind: "spell", name: "bolt", tier: "high" },
  { kind: "melee", name: "bash" },
];

function rangeOf(a: Attack): number {
  if (a.kind === "melee") return 1;
  else if (a.kind === "ranged") return 20;
  else if (a.kind === "spell") return 30;
  return -1;
}
for (const a of attacks) console.log(a.name, a.kind, rangeOf(a), a.tier ?? "none", a.tier === undefined, "tier" in a);

function value(e: Ev): number {
  if (e.type === "hit") return e.amount;
  if (e.type === "crit") return e.amount * e.mult;
  return 0;
}
const events: Ev[] = [{ type: "hit", amount: 5 }, { type: "miss" }, { type: "crit", amount: 3, mult: 2 }];
console.log(events.map(value).join(","), events.map((e) => e.type).join(","));

// JSON in both directions.
console.log(JSON.stringify(attacks));
const parsed: Attack[] = JSON.parse(JSON.stringify(attacks));
console.log(parsed.map((a) => rangeOf(a)).join(","), parsed[2].kind === attacks[2].kind, parsed[1].tier === undefined);

// Keys and entries of records holding literal values.
const a0 = attacks[0];
console.log(Object.keys(a0).join(","), Object.entries(a0).map(([k, v]) => `${k}=${v}`).join(";"), Object.values(a0).join("/"));

// Spread copies keep and override literal fields.
const up: Attack = { ...a0, tier: "mid" };
const swapped = { ...attacks[1], kind: "spell" as Kind };
console.log(up.tier, a0.tier, swapped.kind, attacks[1].kind, JSON.stringify(swapped), rangeOf(swapped));

// Destructuring literal fields, with defaults.
const { kind, tier = "low" } = attacks[1];
const [{ kind: k2 }, , { tier: t3 }] = attacks;
console.log(kind, tier, k2, t3);

// Literal values as object keys, `in`, and computed property names.
const byKind: Partial<Record<Kind, string[]>> = {};
for (const a of attacks) { const l = byKind[a.kind]; if (l) l.push(a.name); else byKind[a.kind] = [a.name]; }
console.log(JSON.stringify(byKind), "melee" in byKind, attacks[1].kind in byKind, (("sp" + "ell") as Kind) in byKind, ("none" as string as Kind) in byKind);
const dyn = { [attacks[2].kind]: 1, [attacks[0].kind + "!"]: 2 };
console.log(JSON.stringify(dyn), Object.keys(dyn).join(","));

// A record whose field is reassigned across the members and compared to another record's.
const cursor: { mode: Kind } = { mode: "melee" };
let matches = 0;
for (let i = 0; i < 9; i++) {
  cursor.mode = cursor.mode === "melee" ? "ranged" : cursor.mode === "ranged" ? "spell" : "melee";
  if (cursor.mode === attacks[i % 4].kind) matches++;
}
console.log(cursor.mode, matches);

// Nested records and optional chaining.
type Slot = { item?: { rarity: "common" | "rare" } };
const slots: Slot[] = [{}, { item: { rarity: "rare" } }, { item: { rarity: "common" } }];
console.log(slots.map((s) => s.item?.rarity ?? "empty").join(","), slots.filter((s) => s.item?.rarity === "rare").length);
