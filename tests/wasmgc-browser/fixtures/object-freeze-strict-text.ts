"use strict";
// @native-only: the engine dyn model has no runtime freeze of a compiled record (it refuses the freeze loudly)
// In strict code a write to a frozen record throws Node's TypeError, naming the property.
type P = { x: number; tag: string };
const p: P = Object.freeze({ x: 1, tag: "a" }) as P;
for (const key of ["x", "tag"] as const) {
  try {
    if (key === "x") p.x = 2; else p.tag = "z";
    console.log("no throw", key);
  } catch (e) {
    console.log((e as Error).name + ": " + (e as Error).message);
  }
}
const q: P = { x: 1, tag: "q" };
Object.freeze(q);
try { q.x += 1; } catch (e) { console.log((e as Error).message); }
try { q.x++; } catch (e) { console.log((e as Error).message); }
console.log(p.x, p.tag, q.x);
