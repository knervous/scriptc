// String literal unions held in locals and module bindings: const and let, reassigned in
// branches and loops, if/else-if chains of three or more arms, and ternary chains. Pins the
// observable string values while the emitter may hold such values as atom ids.
type Mode = "idle" | "walk" | "run" | "swim";

const START: Mode = "idle";
let current: Mode = START;
const order: Mode[] = ["idle", "walk", "run", "swim"];

function label(m: Mode): string {
  if (m === "idle") return "I";
  else if (m === "walk") return "W";
  else if (m === "run") return "R";
  else return "S";
}

function tern(m: Mode): number {
  return m === "idle" ? 0 : m === "walk" ? 1 : m === "run" ? 2 : 3;
}

let trail = "";
for (let i = 0; i < 9; i++) {
  let next: Mode;
  if (i % 4 === 0) next = "walk";
  else if (i % 4 === 1) next = "run";
  else if (i % 4 === 2) next = "swim";
  else next = "idle";
  if (next !== current) trail += label(current) + ">" + label(next) + " ";
  current = next;
}
console.log(trail.trim());
console.log(current, typeof current, current.length);

let m: Mode = "idle";
let steps = 0;
while (m !== "swim") {
  m = m === "idle" ? "walk" : m === "walk" ? "run" : "swim";
  steps++;
}
console.log(m, steps, tern(m));

// A let that starts as one literal, is reassigned from an array, and is compared again.
let picked: Mode = "run";
for (const o of order) if (tern(o) > tern(picked)) picked = o;
console.log(picked, picked === "swim", picked == "swim", picked !== "run");

// A const narrowed to one member still behaves as its string.
const fixed = "walk" as const;
console.log(fixed, fixed + "!", fixed === order[1]);

// Module let read by a function after being reassigned at top level.
function readCurrent(): string { return "current=" + current; }
current = "run";
console.log(readCurrent());

// A local reassigned inside a nested block and read outside it.
let outer: Mode = "idle";
{
  const inner: Mode = order[2];
  if (inner === "run") outer = inner;
}
console.log(outer, label(outer));

// Conditional assignment from two literal sources and a counter loop of states.
const counts: number[] = [0, 0, 0, 0];
let s: Mode = "idle";
for (let i = 0; i < 20; i++) {
  s = (i & 1) === 0 ? (s === "idle" ? "walk" : "idle") : s === "run" ? "swim" : "run";
  counts[tern(s)]++;
}
console.log(counts.join(","), s);
