// String fields the program only ever writes with literals (atom fields, SCRIPTC_WASMGC_ATOM_STRINGS): record and class
// fields (inherited, constructor-written, reassigned, static), discriminated unions of records and of classes read with
// `u.kind` compares and switches, copies through locals and other fields, a record and an instance of such types handed
// to JS and changed there, JSON round trips, spreads into wider shapes, Object.keys/entries, an optional `kind?`, and
// every read as a string give Node's results.
import { poke, peek, renameUnit, keysOf } from "./atom-string-fields-helper.js";

type Dir = "n" | "e" | "s" | "w";
type Move = { kind: "move"; dir: Dir; steps: number };
type Wait = { kind: "wait"; ticks: number };
type Say = { kind: "say"; text: string; tone: "calm" | "loud" };
type Cmd = Move | Wait | Say;

const cmds: Cmd[] = [
  { kind: "move", dir: "n", steps: 2 }, { kind: "wait", ticks: 3 }, { kind: "say", text: "hi", tone: "calm" },
  { kind: "move", dir: "e", steps: 1 }, { kind: "say", text: "yo", tone: "loud" }, { kind: "move", dir: "w", steps: 5 },
];
function cost(c: Cmd): number {
  if (c.kind === "move") return c.steps * (c.dir === "n" || c.dir === "s" ? 2 : 1);
  else if (c.kind === "wait") return c.ticks;
  else if (c.kind === "say") return c.tone === "loud" ? 4 : 1;
  return -1;
}
function label(c: Cmd): string {
  switch (c.kind) {
    case "move": return `go ${c.dir}x${c.steps}`;
    case "wait": return `wait ${c.ticks}`;
    case "say": return `say ${c.text} (${c.tone})`;
  }
}
let total = 0;
for (const c of cmds) total += cost(c);
console.log(total, cmds.map(label).join("; "), cmds.filter((c): boolean => c.kind !== "wait").length);
const k0 = cmds[0].kind, k1 = cmds[3].kind;
console.log(k0, k0 === k1, k0 === cmds[1].kind, k0.length, k0.toUpperCase(), `${k1}!`, [k0, cmds[2].kind].join("+"));

// A record field reassigned with literals and copied between records and locals.
type Dial = { mode: "off" | "low" | "high"; prev: "off" | "low" | "high" };
const dial: Dial = { mode: "off", prev: "off" };
const seen: string[] = [];
for (let i = 0; i < 7; i++) {
  dial.prev = dial.mode;
  dial.mode = dial.mode === "off" ? "low" : dial.mode === "low" ? "high" : "off";
  let local = dial.mode;
  if (i % 3 === 0) local = "off";
  seen.push(`${dial.prev}>${dial.mode}:${local === dial.mode}`);
}
console.log(seen.join(" "), dial.mode === dial.prev, JSON.stringify(dial));

// Optional literal field (`kind?`): unset, set, compared.
type Opt = { kind?: "a" | "b"; n: number };
const opts: Opt[] = [{ n: 1 }, { kind: "a", n: 2 }, { kind: "b", n: 3 }];
console.log(opts.map((o) => o.kind ?? "-").join(""), opts.filter((o) => o.kind === "a").length, JSON.stringify(opts), "kind" in opts[0]);

// JSON both ways, Object.keys/values/entries and a spread into a wider shape.
const saidStr = JSON.stringify(cmds[2]);
const said = JSON.parse(saidStr) as Say;
console.log(saidStr, said.kind === "say", said.tone === (cmds[2] as Say).tone, cost(said));
const mv = cmds[5] as Move;
console.log(Object.keys(mv).join(","), Object.values(mv).join("/"), Object.entries(mv).map(([k, v]) => `${k}=${v}`).join(";"));
const wide = { ...mv, extra: "x" };
const narrow: Move = { ...mv, steps: 9 };
console.log(JSON.stringify(wide), wide.kind === "move", wide.dir, narrow.dir, narrow.kind === mv.kind, cost(narrow));

// Classes: constructor-written and initialized fields, inherited, overwritten by a subclass, static fields.
class Unit {
  static faction: "red" | "blue" = "red";
  role: "tank" | "healer" | "dps" = "dps";
  stance: "idle" | "guard" | "charge";
  constructor() { this.stance = "idle"; }
  act(): string {
    switch (this.stance) {
      case "idle": this.stance = "guard"; break;
      case "guard": this.stance = this.role === "tank" ? "guard" : "charge"; break;
      case "charge": this.stance = "idle"; break;
    }
    return `${this.role}/${this.stance}`;
  }
}
class Tank extends Unit {
  armor: "plate" | "mail" = "plate";
  constructor() { super(); this.role = "tank"; }
}
const units: Unit[] = [new Unit(), new Tank(), new Unit()];
const log: string[] = [];
for (let i = 0; i < 4; i++) for (const u of units) log.push(u.act());
console.log(log.join(" "), units.filter((u) => u.stance === "guard").length, units[1] instanceof Tank && (units[1] as Tank).armor === "plate");
console.log(Unit.faction, Unit.faction === "red", JSON.stringify(units[1]), JSON.stringify(units[0]), JSON.stringify({ ...(units[2] as Unit), extra: 1 }));
Unit.faction = "blue";
console.log(Unit.faction === "blue", units[0].role === units[2].role, units[0].role === units[1].role);

// A discriminated union of classes.
class Fire { readonly kind = "fire"; heat: number; constructor(heat: number) { this.heat = heat; } }
class Frost { readonly kind = "frost"; chill = 2; }
class Venom { kind: "venom" | "acid" = "venom"; }
type Spell = Fire | Frost | Venom;
const spells: Spell[] = [new Fire(3), new Frost(), new Venom(), new Fire(1)];
(spells[2] as Venom).kind = "acid";
function power(s: Spell): number {
  switch (s.kind) {
    case "fire": return (s as Fire).heat * 2;
    case "frost": return (s as Frost).chill;
    case "venom": return 7;
    case "acid": return 8;
  }
}
console.log(spells.map(power).join(","), spells.map((s) => s.kind).join(","), spells.filter((s) => s.kind === "fire").length, spells[0].kind === spells[3].kind);

// A record and an instance of the same types handed to JS, which reads and changes them.
type Flag = { kind: "on" | "off"; id: number };
const flag: Flag = { kind: "off", id: 1 };
const other: Flag = { kind: "on", id: 2 };
console.log(peek(flag), flag.kind === "off");
poke(flag, "on");
console.log(flag.kind, flag.kind === "on", flag.kind === other.kind, JSON.stringify(flag), keysOf(flag));
poke(flag, "o" + "ff");
console.log(flag.kind === "off", flag.kind === other.kind, `${flag.kind}`);
class Badge { tier: "bronze" | "silver" = "bronze"; }
const badge = new Badge(), plain = new Badge();
renameUnit(badge, "silver");
console.log(badge.tier, badge.tier === "silver", plain.tier === "bronze", badge.tier === plain.tier, JSON.stringify(badge));

// A union of records and a class hierarchy that never leave compiled code: every read compares atoms.
type Ev = { kind: "hit"; n: number } | { kind: "heal"; n: number; crit: boolean } | { kind: "miss" };
const evs: Ev[] = [];
for (let i = 0; i < 9; i++) evs.push(i % 3 === 0 ? { kind: "hit", n: i } : i % 3 === 1 ? { kind: "heal", n: i, crit: i > 4 } : { kind: "miss" });
let hp = 20, misses = 0;
for (const e of evs) {
  switch (e.kind) {
    case "hit": hp -= e.n; break;
    case "heal": hp += e.crit ? 2 * e.n : e.n; break;
    default: misses++;
  }
}
const firstKind = evs[0].kind;
console.log(hp, misses, evs.filter((e): boolean => e.kind === firstKind).length, evs[1].kind === "heal", evs[2].kind !== "miss", `${evs[4].kind}`);
class Door {
  state: "shut" | "ajar" | "open" = "shut";
  toggle(): void { this.state = this.state === "shut" ? "ajar" : this.state === "ajar" ? "open" : "shut"; }
}
class Vault extends Door {
  seal: "wax" | "iron" = "wax";
  constructor() { super(); this.state = "ajar"; }
}
const doors: Door[] = [new Door(), new Vault(), new Door()];
for (let i = 0; i < 5; i++) doors[i % 3].toggle();
const v = doors[1] as Vault;
v.seal = v.state === "open" ? "iron" : "wax";
console.log(doors.map((d) => d.state).join(","), doors[0].state === doors[2].state, v.seal, v.seal === "iron", doors[1].state.length);
