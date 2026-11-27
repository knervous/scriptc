export function holey() { const h = [1, , 3]; h.length = 4; return h; }
export function arrayLike() { return { 0: "x", 1: "y", length: 2 }; }
// The same reads from JS source (native dyn in every native lane).
export function joinIdx(a, n) { var out = []; for (var i = 0; i < n; i++) out.push(String(a[i])); return out.join(","); }
export function sumOdd(a) { var s = 0; for (var i = 1; i < a.length; i += 2) s += a[i]; return s; }
