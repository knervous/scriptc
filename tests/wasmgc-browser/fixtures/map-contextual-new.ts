// `new Map()` with no type arguments takes the checker's non-generic
// overload (Map<any, any>); its destination's type decides the Map: an
// annotated binding, a record field, a return value, a parameter default and
// an assignment all build a typed Map that set/get/has/delete/iterate as such.
interface Entry { id: number; tags: string[] }
interface Registry { byName: Map<string, Entry>; counts: Map<number, number> }
const named: Map<string, number> = new Map();
named.set("a", 1).set("b", 2);
const registry: Registry = { byName: new Map(), counts: new Map() };
function makeIndex(): Map<number, string> {
  return new Map();
}
function fill(into: Map<string, boolean> = new Map()): Map<string, boolean> {
  into.set("seen", true);
  return into;
}
let later: Map<number, Entry[]>;
later = new Map();
registry.byName.set("first", { id: 1, tags: ["x"] });
registry.counts.set(7, (registry.counts.get(7) ?? 0) + 1);
registry.counts.set(7, (registry.counts.get(7) ?? 0) + 1);
const index = makeIndex();
index.set(3, "three");
later.set(1, [{ id: 2, tags: [] }]);
console.log(named.get("b"), named.size, [...named.keys()].join(","));
console.log(registry.byName.get("first")?.tags.join("|"), registry.counts.get(7), registry.byName.has("second"));
console.log(index.get(3), fill().get("seen"), later.get(1)?.length);
named.delete("a");
for (const [key, value] of named) console.log(key, value);
