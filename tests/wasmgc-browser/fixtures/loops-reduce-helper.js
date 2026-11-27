export function holey() { const h = [1, , 3]; h.length = 5; return h; }
export function sparseHead() { const s = [, , "a", "b"]; return s; }
// The same walks from JS source (native dyn in every native lane).
export function sumBy(rows) { return rows.reduce(function (s, r) { return s + r.v; }, 0); }
export function grow(a) { return [a.reduce((acc, x, i, arr) => { if (i < 2) arr.push(x); return acc + x; }), a.length].join(":"); }
