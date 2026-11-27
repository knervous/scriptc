// @native-only: an untyped `new Map()` (typed Map<any, any> by the checker) is the engine's own map under engine dyn; the native model dispatches on the stored compiled map
// Map and Set methods on receivers stored with an absent arm that the checker
// proves present at the call: `??=` results, chained set/add, narrowed fields.
class Engine {
  buffers: Set<number> | undefined;
  names: Map<string, number> | null = null;
}
const engine = new Engine();
(engine.buffers ??= new Set()).add(1).add(2);
(engine.buffers ??= new Set()).add(3);
const named = (engine.names ??= new Map()).set("a", 1).set("b", 2);
console.log(engine.buffers.size, named.size, named.get("b"));
if (engine.names) {
  engine.names.set("c", 3);
  console.log(engine.names.has("c"), engine.names.get("a"));
}
let cache: Map<number, string> | undefined;
const remember = (k: number, v: string): string => (cache ??= new Map<number, string>()).set(k, v).get(k) ?? "?";
console.log(remember(7, "seven"), cache?.size);
