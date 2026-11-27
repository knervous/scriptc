// Literal-union values inside compiled Maps and class instances (with methods) handed to a JS
// module: JS reads Map entries keyed by literals and a class's literal field as plain strings.
// @native-only: engine dyn has no Map surface for a compiled Map crossing to JS (cf. record-page-slots) and no classval lowering for a class with methods (cf. libs-class-value)
import { makeMode, mapGet, fieldOf, keysOf } from "./lit-js-helper-helper.js";

type Mode = "idle" | "walk" | "run";
const map = new Map<Mode, number>([["run", 3], ["idle", 1]]);
console.log(mapGet(map, "run"), mapGet(map, makeMode(0)), mapGet(map, "walk"), mapGet(map, "ru" + "n"));
map.set(makeMode(1) as Mode, 2);
console.log(mapGet(map, "walk"), map.get("walk"), [...map.keys()].join(","));

// A class instance with a literal field read by JS.
class Door { state: "open" | "shut" = "shut"; toggle() { this.state = this.state === "open" ? "shut" : "open"; } }
const d = new Door();
console.log(fieldOf(d));
d.toggle();
console.log(fieldOf(d), fieldOf(d) === "open", keysOf(d), JSON.stringify(d));

const doors: Door[] = [new Door(), new Door(), new Door()];
doors[1].toggle();
console.log(doors.map((x) => fieldOf(x)).join(","), doors.filter((x) => fieldOf(x) === "shut").length);
