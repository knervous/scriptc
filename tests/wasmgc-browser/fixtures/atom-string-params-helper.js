// JavaScript helper for atom-string-params.ts: calls a compiled function with a string no literal spells.
export function callWith(f, s) { return String(f(s)); }
export function built(a, b) { return [a, b].join(""); }
