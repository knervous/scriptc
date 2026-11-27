// Untyped helpers: they see the compiled values as JavaScript does.
export function describe(v) { return v === null ? "null" : v === undefined ? "undef" : typeof v === "object" ? "obj:" + (v.id ?? v.name ?? v.length) : typeof v; }
export function roundTrip(v) { return v; }
export function make(kind, id) { return kind === 0 ? null : kind === 1 ? undefined : { id, name: "n" + id }; }
export function nth(list, i) { return list[i]; }
export function callIf(f, x) { return f == null ? "nofn" : f(x); }
