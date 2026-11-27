// Literal-union values crossing to a JS module and back: passed as arguments, returned, stored
// and fetched, inside records, arrays, maps and class instances read by JS, callbacks called by JS
// with literal arguments, and values JS makes typed as the union on the compiled side.
import { echo, describe, same, makeMode, makeRecord, readKind, setKind, keysOf, collect, callWith, store, stored, arrayOf } from "./lit-js-helper-helper.js";

type Mode = "idle" | "walk" | "run";
type Kind = "melee" | "ranged" | "spell";

const m: Mode = "walk";
const back = echo(m) as Mode;
console.log(back, back === "walk", back === m, describe(m), describe(back), same(m, "walk"), same(back, "wa" + "lk"));

// Values JS makes, typed as the union.
const made: Mode[] = [makeMode(0) as Mode, makeMode(1) as Mode, makeMode(2) as Mode, makeMode(3) as Mode];
console.log(made.join(","), made.map((x) => (x === "idle" ? 0 : x === "walk" ? 1 : x === "run" ? 2 : 9)).join(""), made[3] === ("sprint" as string));

// Records crossing both ways.
interface Rec { kind: Kind; n: number; }
const recs: Rec[] = [makeRecord(0) as Rec, makeRecord(1) as Rec];
console.log(recs.map((r) => r.kind).join(","), recs[0].kind === "melee", recs[1].kind === "ranged", JSON.stringify(recs));
const mine: Rec = { kind: "spell", n: 9 };
console.log(readKind(mine), readKind(mine) === "spell", keysOf(mine));
setKind(mine, "melee");
console.log(mine.kind, mine.kind === "melee", mine.kind === recs[0].kind);
setKind(mine, "sp" + "ell");
console.log(mine.kind === "spell", JSON.stringify(mine));

// Arrays of literals read by JS (Maps and class instances crossing: lit-js-cross).
const list: Mode[] = ["idle", "run", "walk"];
console.log(collect(list), collect(arrayOf()), (arrayOf() as Mode[]).includes("run"));

// Callbacks: JS calls compiled code with a literal argument and gets a literal back.
const f = (x: Mode): Mode => (x === "idle" ? "walk" : x === "walk" ? "run" : "idle");
console.log(callWith(f, "idle"), callWith(f, "walk"), callWith(f, makeMode(2)), callWith(f, "sprint"));

// Stored on the JS side, fetched later and compared.
store(m);
const later = stored() as Mode;
console.log(later, later === m, typeof later, later.toUpperCase());
store(list);
console.log((stored() as Mode[]).join("+"), stored() === list);
