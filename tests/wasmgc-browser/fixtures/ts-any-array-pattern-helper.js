export function arr(...xs) { return xs; }
export function holes() { const a = Array(3); a[1] = "b"; return a; }
export function pageSet(...xs) { return new Set(xs); }
export function fnPair(f) { return [f, () => 2]; }
