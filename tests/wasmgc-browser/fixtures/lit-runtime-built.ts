// Values typed as a literal union but produced at run time (concatenation, String.fromCharCode,
// slice, templates, toLowerCase, JSON.parse, Object.keys, split) flowing into union-typed locals,
// parameters, fields, arrays and maps, then compared against literals and against literal-sourced
// values of the same union.
type Mode = "idle" | "walk" | "run";

function rank(m: Mode): number { return m === "idle" ? 0 : m === "walk" ? 1 : m === "run" ? 2 : -1; }
function isWalk(m: Mode): boolean { return m === "walk"; }

const sources: Mode[] = [
  ("wa" + "lk") as Mode,
  String.fromCharCode(105, 100, 108, 101) as Mode,
  "xxrunxx".slice(2, 5) as Mode,
  `${"w"}${"alk"}` as Mode,
  "IDLE".toLowerCase() as Mode,
  JSON.parse('"run"'),
  ...("idle,walk".split(",") as Mode[]),
  ...(Object.keys({ run: 1, idle: 2 }) as Mode[]),
];
console.log(sources.join(","), sources.map(rank).join(","), sources.filter(isWalk).length);

// Runtime values compared with literal-sourced values of the same union.
const lit: Mode[] = ["idle", "walk", "run"];
let hits = 0;
for (const s of sources) for (const l of lit) if (s === l) hits++;
console.log(hits, sources.map((s) => lit.indexOf(s)).join(","), sources.every((s) => lit.includes(s)));

// Stored into a field and a local that later get literal assignments, then compared again.
class Holder { mode: Mode = "idle"; }
const h = new Holder();
h.mode = sources[0];
let local: Mode = sources[2];
console.log(h.mode === "walk", local === "run", h.mode === local, rank(h.mode) + rank(local));
h.mode = "run";
console.log(h.mode === local, h.mode === sources[2], Object.is(h.mode, local));

// As Map keys: the runtime value and the literal reach the same entry.
const counts = new Map<Mode, number>();
for (const s of sources) counts.set(s, (counts.get(s) ?? 0) + 1);
console.log(counts.get("walk"), counts.get("idle"), counts.get("run"), counts.size, [...counts.keys()].join(","));

// Records parsed from JSON whose fields are typed as the union.
interface Unit { id: number; mode: Mode; }
const units: Unit[] = JSON.parse('[{"id":1,"mode":"run"},{"id":2,"mode":"idle"},{"id":3,"mode":"walk"},{"id":4,"mode":"run"}]');
console.log(units.filter((u) => u.mode === "run").map((u) => u.id).join(","), units.map((u) => rank(u.mode)).join(""));
units[1].mode = "walk";
console.log(JSON.stringify(units[1]), units.filter((u) => u.mode === units[2].mode).length);

// A runtime-built string switched on and used as a record key.
const table: Record<Mode, string> = { idle: "I", walk: "W", run: "R" };
let codes = "";
for (const s of sources) {
  switch (s) { case "idle": codes += table[s]; break; case "walk": codes += table["walk"]; break; default: codes += table[s].toLowerCase(); }
}
console.log(codes);

// Built character by character in a loop.
let acc = "";
for (const c of [119, 97, 108, 107]) acc += String.fromCharCode(c);
const looped = acc as Mode;
console.log(looped, looped === "walk", rank(looped), looped.length);
