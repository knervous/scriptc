// Untyped code given a typed tuple (and a typed array of tuples).
export function poke(t) { t[1] = t[1] + 10; return t; }
export function same(a, b) { return a === b; }
let held;
export function keep(t) { held = t; }
export function kept() { return held; }
export function walk(list) { let n = 0; list.forEach((e, i, arr) => { if (arr === list && e === list[i]) n++; }); return n + " " + list.map((e) => e[0]).join(",") + " " + JSON.stringify(list) + " " + Array.isArray(list[0]); }
export function grow(t) { try { t.push(1); return "grew " + t.length; } catch (e) { return e.constructor.name; } }
export function spread(t) { return t[0] + "/" + t[1] + " " + [...t].length + " " + t.length + " " + (1 in t) + " " + (2 in t); }
