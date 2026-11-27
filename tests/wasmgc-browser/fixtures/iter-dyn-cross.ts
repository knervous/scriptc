// @options: {"hostHandles": true}
// @native-sim-skip: page JS iterates and mutates a crossed compiled Map; the native host has no page code (a crossed collection stays a compiled value there)
// @native-any-only: untyped collections as TS any (the engine and plain native lanes keep these values in the page)
// A Map/Set whose iterator is mid-walk when the collection crosses to the page keeps its position.
const g: any = globalThis;
const m: any = new Map<any, any>([[1, "a"], [2, "b"], [3, "c"]]);
const it = m.keys();
console.log(it.next().value);
const copy = g.structuredClone(m);
console.log(copy.size);
console.log(it.next().value, it.next().value, JSON.stringify(it.next()));
const s: any = new Set<any>(["x", "y", "z"]);
const si = s.values();
si.next();
g.structuredClone(s);
console.log(JSON.stringify([...si]));
