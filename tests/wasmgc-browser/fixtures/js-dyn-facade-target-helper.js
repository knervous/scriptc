// Compiled objects and arrays the page inspects through their facades.
export function make() {
  const o = { a: 1, b: "two" }, arr = [1, 2, 3];
  return [o, arr];
}
export function after(o, arr) { return [o.a, o.b, arr.length, Object.keys(o).join("+")].join(" "); }
