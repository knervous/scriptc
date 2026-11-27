export function make(F, a) { return new F(a); }
export function keysOf(o) { return Object.keys(o).join(""); }
export function probe() {
  function P(x) { this.x = x; this.y = 2; }
  const a = make(P, 1);
  return keysOf(a) + "/" + JSON.stringify(a);
}
