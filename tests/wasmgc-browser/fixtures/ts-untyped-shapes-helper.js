// JS helpers for ts-untyped-shapes: the shapes React Compiler output reaches
// once it strips annotations (untyped params and `new Map()` without arguments).
let total = 0;
async function post(a, b) { total += a + b; return total; }
export const Service = { instance: { loot: { decide: (a, b) => post(a, b), name: "svc" } } };
export function totalSoFar() { return total; }
export function mapPairs(pairs) { return pairs.map((p) => `${p[0]}=${p[1]}`).join(","); }
export function first(xs) { return xs[0]; }
