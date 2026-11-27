// The JS side for atom-string-fields: reads and writes literal fields of compiled records and instances.
export function poke(r, k) { r.kind = k; }
export function peek(r) { return r.kind + ":" + r.id; }
export function renameUnit(u, t) { u.tier = t; }
export function keysOf(o) { return Object.keys(o).join(","); }
