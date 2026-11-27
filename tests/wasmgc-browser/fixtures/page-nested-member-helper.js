// A page object with nested records and arrays, as an untyped page API hands back.
export function makeStream() {
  return { stats: { _values: [3, 1, 4], phase: "loading", nested: { depth: 2 } }, _manifest: { leaves: ["a", "b"] } };
}
