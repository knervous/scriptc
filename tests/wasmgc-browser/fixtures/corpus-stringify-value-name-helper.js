export function stringifyValue() {
  const stringify = JSON.stringify;
  return [stringify === JSON.stringify, stringify.name, stringify.length, stringify({ a: 1 })].join(" ");
}
