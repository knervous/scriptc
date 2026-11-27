// @native-only: typed collections reach untyped code as the same struct (native dyn)
// A typed Map/Set handed to untyped code (React state holding a Map): get/has
// with keys the key type cannot hold answer as JS (undefined/false), size,
// set/delete/add write through, forEach walks live in insertion order, and
// the same collection comes back to typed code. A page-typed (`any`) holder
// dispatches the same methods.
import { useMap } from "./ui-typed-collections-dyn-helper.js";
interface Pick { name: string }
const m = new Map<number, Pick>([[1, { name: "ore" }], [2, { name: "coal" }]]);
const s = new Set<string>(["a", "b"]);
console.log(useMap(m, s));
console.log([...m.keys()].join(","), [...s].join(","));
const held: any = m;
console.log(held.get(2).name, held.has(5), held.size);
held.set(4, { name: "gem" });
console.log(m.get(4)?.name, m.size);
