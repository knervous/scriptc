// Untyped helpers for the fourth-round boundary probes (compiled as JavaScript).
export function ordinary() { return { x: 1 }; }
export function hidden() { const o = { x: 1 }; Object.defineProperty(o, 'h', { value: 2, enumerable: false, writable: false, configurable: false }); return o; }
export function bare() { const o = { x: 1 }; Object.setPrototypeOf(o, null); return o; }
export function fn() { return function () { return 7; }; }
export function call(f) { return f(); }
export function first(x) { for (const v of x) return v; return 0; }
export function readClass(o) { return '' + o.n; }
export function readCompositeArray(a) { return '' + a.length + '|' + a[0].n; }
// A typed list of records handed to untyped code: reads, writes through the
// shared elements, push, iteration, nested arrays, and the page.
export function editList(list, grid, pageKeys) {
  const out = [];
  out.push(list.length + ":" + list[1].label);
  list[0].n = list[0].n + 10;
  list.push({ n: 3, label: "c" });
  let total = 0;
  for (const item of list) total += item.n;
  out.push(total + ":" + list.map(function (x) { return x.label; }).join(""));
  out.push(grid.length + ":" + grid[1][0] + ":" + grid[1].length);
  grid[0].push(9);
  out.push(pageKeys(list[1]));
  return out.join(" ");
}
// Typed class instances seen by untyped code: fields, overridden methods, writes.
export function useShapes(shapes) {
  const out = [];
  for (const s of shapes) out.push(s.name + ":" + s.area() + ":" + s.describe());
  shapes[1].name = "renamed";
  return out.join(" | ");
}
// Reflection over a typed class instance.
export function reflectShape(s) {
  return [("sides" in s), ("greet" in s), ("label" in s), ("toString" in s), ("nope" in s), Object.keys(s).join("+"),
    Object.prototype.hasOwnProperty.call(s, "name"), Object.prototype.hasOwnProperty.call(s, "greet"), Object.hasOwn(s, "side")].join(",");
}
