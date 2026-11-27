// Array(x) with an untyped sole argument (React's useMemoCache: Array(size)
// filled with a symbol sentinel): a number sets the length (holes), any other
// value becomes the single element; an invalid length is a RangeError.
const SENTINEL = Symbol.for("react.memo_cache_sentinel");
export function filled(n) { const a = Array(n); for (let i = 0; i < n; i++) a[i] = SENTINEL; return a; }
export function make(x) { return Array(x); }
export function report() {
  const out = [];
  const f = filled(3);
  out.push(`filled ${f.length} ${f.every((v) => v === SENTINEL)}`);
  const holes = make(4);
  out.push(`holes ${holes.length} ${0 in holes} ${holes[2] === undefined}`);
  for (const x of ["7", null, true, { k: 1 }]) { const a = make(x); out.push(`${typeof x}: length ${a.length} same ${a[0] === x}`); }
  out.push(`zero ${make(0).length}`);
  for (const bad of [-1, 1.5, 2 ** 32]) { try { make(bad); out.push("no error"); } catch (e) { out.push(`${bad}: ${e.name}: ${e.message}`); } }
  return out.join("\n");
}
