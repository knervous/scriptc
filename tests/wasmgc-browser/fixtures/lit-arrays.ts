// Literal unions in arrays: Mode[], readonly arrays, `as const` tuples, includes/indexOf/
// lastIndexOf/find on literal arrays, sort (default and comparator), join, map/filter/reduce,
// push/pop/splice/reverse, spread, Array.from, and an array element written with a runtime string.
type Mode = "walk" | "run" | "crawl" | "fly";
const MODES = ["walk", "run", "crawl", "fly"] as const;
const ro: readonly Mode[] = ["fly", "walk"];
const list: Mode[] = ["run", "walk", "fly", "crawl", "walk"];

console.log(MODES.length, MODES[0], MODES.join("+"), ro.join("+"), list.join("+"));
console.log(list.includes("walk"), list.includes("swim" as Mode), ro.includes(list[0]), MODES.includes(list[2]));
console.log(list.indexOf("walk"), list.lastIndexOf("walk"), list.indexOf("swim" as string as Mode), (MODES as readonly string[]).indexOf("cr" + "awl"));
console.log(list.find((m) => m !== "run"), list.findIndex((m) => m === "crawl"), list.some((m) => m === "fly"), list.every((m) => m.length > 2));

const sorted = [...list].sort();
const bylen = [...list].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
console.log(sorted.join(","), bylen.join(","), list.join(","));
console.log([...list].reverse().join(","), list.slice(1, 3).join(","), list.concat(ro).join(","));

const counts = list.reduce((acc, m) => { acc.set(m, (acc.get(m) ?? 0) + 1); return acc; }, new Map<Mode, number>());
console.log(JSON.stringify([...counts]), [...counts.keys()].join(","));

const stack: Mode[] = [];
stack.push("walk", "run");
stack.unshift("fly");
const popped = stack.pop();
stack.splice(1, 0, "crawl", "crawl");
console.log(popped, stack.join(","), stack.length, stack.shift(), stack.join(","));

// Elements written from runtime strings and read back as literals.
const slots: Mode[] = new Array<Mode>(4).fill("walk");
slots[1] = ("r" + "un") as Mode;
slots[2] = "fly".slice(0) as Mode;
slots[3] = JSON.parse('"crawl"');
console.log(slots.join(","), slots.map((m) => MODES.indexOf(m)).join(","), slots[1] === "run", slots[3] === MODES[2]);

// A tuple of literals, destructured, and typed tuples.
const pair: readonly ["on", "off"] = ["on", "off"];
const [first, second] = pair;
const triple: [Mode, Mode, number] = ["fly", "run", 3];
console.log(first, second, first === "on", triple[0], triple[1] === "run", JSON.stringify(triple));

// Array.from, map to literal, filter by literal, nested arrays.
const derived: Mode[] = Array.from({ length: 6 }, (_, i) => MODES[i % 4]);
const grid: Mode[][] = [["walk", "run"], ["fly"], []];
console.log(derived.join(","), derived.filter((m) => m === "walk").length, grid.map((r) => r.join("/")).join("|"), grid.flat().length);
console.log(JSON.stringify(list), JSON.stringify(MODES), String(ro), `${list}`);

// A wrapping-index walk over a literal array.
let idx = 0;
let acc = "";
for (let i = 0; i < 10; i++) { acc += MODES[idx][0]; idx++; if (idx === MODES.length) idx = 0; }
console.log(acc);
