// The reserved undefined read stays distinct from NaN through containers,
// parameters and returns (SameValueZero keys; strict and loose equality).
const u = new Float64Array(1)[2];
const s = new Set<number>([u, NaN, u, NaN, 0, -0]);
console.log(s.size, s.has(u), s.has(NaN));
const m = new Map<string, number>([["a", u], ["b", NaN]]);
const a = m.get("a"), b = m.get("b");
console.log(a === undefined, b !== undefined && Number.isNaN(b), a === a, b === b);
const xs = [u, NaN, 1];
console.log(xs.includes(NaN), xs.indexOf(NaN), xs.includes(u), xs.indexOf(u));
const id = (x: number): number => x;
console.log(id(u) === undefined, Number.isNaN(id(NaN)), Object.is(id(u), NaN));
