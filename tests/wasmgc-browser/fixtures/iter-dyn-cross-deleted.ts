// @options: {"hostHandles": true}
// @native-sim-skip: page JS iterates and mutates a crossed compiled Map; the native host has no page code (a crossed collection stays a compiled value there)
// @native-any-only: untyped collections as TS any (the engine and plain native lanes keep these values in the page)
// @native-refuses: a native Map/Set iterator whose collection crossed to the page resumes by key; when the page deleted the entry it last yielded, the position is unknown and the step throws instead of guessing
// @expect-native: 1
// @expect-native: TypeError a Map changed on the page while compiled code was iterating it
// @expect-native: 2
// @expect-native: TypeError a Set changed on the page while compiled code was iterating it
// Resuming after the last key still works while that key is present (iter-dyn-cross); a deleted one is refused.
const g: any = globalThis;
const m: any = new Map<any, any>([[1, "a"], [2, "b"], [3, "c"]]);
const it = m.keys();
console.log(it.next().value);
g.structuredClone(m);
m.delete(1);
try { console.log(JSON.stringify(it.next())); } catch (e) { console.log((e as Error).name, (e as Error).message); }
const s: any = new Set<any>(["x", "y", "z"]);
const si = s.values();
si.next();
console.log(2);
g.structuredClone(s);
s.delete("x");
try { console.log(JSON.stringify(si.next())); } catch (e) { console.log((e as Error).name, (e as Error).message); }
