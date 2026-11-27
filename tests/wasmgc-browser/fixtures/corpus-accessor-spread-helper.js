export function accessorSpread() {
  let calls = 0;
  const key = JSON.parse('"x"');
  const spread = { get x() { return 0; }, set x(value) { calls++; }, ...JSON.parse('{"x":10}') };
  const d = Object.getOwnPropertyDescriptor(spread, "x");
  const before = spread.x;
  spread.x = 11;
  const getterOnly = { get [key]() { throw new Error("replaced"); }, ...JSON.parse('{"x":12}') };
  return [before, d.writable, d.enumerable, d.configurable, "get" in d, calls, spread.x, getterOnly.x].join(" ");
}
