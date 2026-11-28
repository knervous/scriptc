// Untyped code: a generic descriptor (no value, get or set) changes only the attributes it names.
export function run() {
  let n = 0;
  const node = { name: "n", get matrix() { return [++n, 2]; }, count: 3 };
  Object.defineProperties(node, { matrix: { enumerable: false } });
  Object.defineProperty(node, "count", { enumerable: false });
  console.log(node.matrix[0], node.matrix[0], node.count, Object.keys(node).join(","));
  const d = Object.getOwnPropertyDescriptor(node, "matrix");
  console.log(typeof d.get, d.set, d.enumerable, d.configurable, "value" in d);
  const c = Object.getOwnPropertyDescriptor(node, "count");
  console.log(c.value, c.writable, c.enumerable, c.configurable);
  Object.defineProperty(node, "count", { writable: false });
  try { node.count = 9; } catch (e) { console.log(e instanceof TypeError); }
  console.log(node.count, Object.getOwnPropertyDescriptor(node, "count").writable);
  // A data descriptor over the accessor replaces it: writable defaults to false.
  Object.defineProperty(node, "matrix", { value: 5 });
  const m = Object.getOwnPropertyDescriptor(node, "matrix");
  console.log(node.matrix, m.writable, m.enumerable, m.configurable, typeof m.get);
}
