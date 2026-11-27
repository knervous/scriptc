// @native-only: the engine dyn model checks JSON data against the declared union where it enters, so the type-lie event ("crit") throws there
// Record fields declared as unions of string literals hold atoms even when data fills them (JSON, run-time strings) or a
// value no literal spells arrives (a type lie): compares, switches and every read as a string give Node's results.
type Mode = "always" | "night" | "schedule";
type Light = { mode: Mode; flicker: "steady" | "flame" | "wisp"; level: number };
type Ev = { kind: "hit"; dmg: number } | { kind: "heal"; amt: number } | { kind: "miss" };
function resolve(raw: { mode?: string; profile?: string }): Light {
  const legacy = raw.mode;
  const mode: Mode = legacy === "always" || legacy === "night" || legacy === "schedule" ? legacy : "always";
  return { mode, flicker: (raw.profile ?? "steady") as Light["flicker"], level: 1 };
}
const parsed = JSON.parse('[{"mode":"night","profile":"flame"},{"mode":"bogus"},{"profile":"glow"},{"mode":"schedule","profile":"wisp"}]') as { mode?: string; profile?: string }[];
const lights = parsed.map(resolve);
const out: string[] = [];
for (const l of lights) out.push(`${l.mode}:${l.flicker}:${l.mode === "night"}:${l.flicker === "flame"}:${l.flicker === ("glow" as string)}:${l.flicker.length}`);
const evs = JSON.parse('[{"kind":"hit","dmg":3},{"kind":"heal","amt":2},{"kind":"miss"},{"kind":"crit","dmg":9}]') as Ev[];
let total = 0;
for (const e of evs) {
  switch (e.kind) {
    case "hit": total += e.dmg; break;
    case "heal": total -= e.amt; break;
    default: out.push(`other:${e.kind}`);
  }
}
const byMode = new Map<string, number>();
for (const l of lights) byMode.set(l.mode, (byMode.get(l.mode) ?? 0) + 1);
out.push(String(total), JSON.stringify(lights), JSON.stringify(evs.map((e) => e.kind)), [...byMode].join(";"), Object.values(lights[0]!).join(","));
console.log(out.join(" "));
