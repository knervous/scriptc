// @native-only: engine-dyn cannot box a class-instance array/Set across the Iterable parameter
// @options: {"interfaceClassArms": true}
// A parameter typed Iterable<Class> accepting an array, a Set and Map views,
// walked with for-of; elements are checked to the class on the way in.
class Mesh {
  name: string;
  hit: number;
  constructor(name: string, hit: number) { this.name = name; this.hit = hit; }
}
function pick(meshes: Iterable<Mesh>, limit: number = 5): string {
  let best: Mesh | null = null;
  for (const m of meshes) { if (m.hit < limit && (!best || m.hit < best.hit)) best = m; }
  return best ? best.name : "none";
}
const list = [new Mesh("a", 3), new Mesh("b", 1), new Mesh("c", 9)];
console.log(pick(list), pick(new Set(list)), pick([], 2), pick(list, 0));
const byName = new Map(list.map((m) => [m.name, m] as [string, Mesh]));
console.log(pick(byName.values()), pick(new Set<Mesh>()));
let early = "";
for (const m of byName.values()) { early += m.name; if (m.hit === 1) break; }
console.log(early);
