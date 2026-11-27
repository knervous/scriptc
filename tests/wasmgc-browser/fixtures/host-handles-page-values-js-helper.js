// Untyped consumers of page iterables: call-argument spread, destructuring, Map/Set construction, array spread.
export function spread(fn, list) { return fn(...list); }
export function spreadMixed(fn, list) { return fn(0, ...list, 1); }
export function first2(it) { var [a, b] = it; return [a, b]; }
export function first5(it) { var [a, b, c, d, e] = it; return [a, b, c, d, e]; }
export function toSet(it) { return new Set(it); }
export function toMap(it) { return new Map(it); }
export function toArray(it) { return [...it]; }
export function keysOf(o) { var out = []; for (var k in o) out.push(k); return out; }
export function holes(fn) { var h = new Array(3); h[2] = 5; return fn(...h); }
