// The JavaScript half of new-collection.ts: Map and Set constructed on untyped sources (dyn.newCollection).
export function build(entries, items) {
  const map = new Map(entries);
  const set = new Set(items);
  const copy = new Map(map);
  const empty = new Set();
  map.set("later", 3);
  return [map.size, map.get("a"), map.has("later"), copy.size, copy.has("later"), set.size, set.has(2), empty.size,
    [...set].join(","), [...map.keys()].join(",")].join(" ");
}
export function refuse(entries) {
  try { return String(new Map(entries).size); } catch (error) { return `${error instanceof TypeError}: ${error.message}`; }
}
