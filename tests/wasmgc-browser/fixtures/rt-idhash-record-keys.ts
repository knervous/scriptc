// Typed records, tuples, arrays, closures and collections as Map / Set / WeakMap keys on the browser. A browser typed record carries
// its own id slot; the kinds without one (tuples, arrays, closures) still hash consistently through every path. Keys compare by identity: an equal-looking value is another key. Deletion and re-insertion keep insertion order.
interface Frame { id: number; label: string }
type Pair = [number, number];
const frames: Frame[] = [];
for (let i = 0; i < 200; i++) frames.push({ id: i, label: "f" + i });
const byFrame = new Map<Frame, number>();
const frameSet = new Set<Frame>();
const weakFrames = new WeakMap<Frame, string>();
frames.forEach((f, i) => { byFrame.set(f, i); frameSet.add(f); weakFrames.set(f, f.label); });
let ok = byFrame.size === 200 && frameSet.size === 200;
frames.forEach((f, i) => { if (byFrame.get(f) !== i || !frameSet.has(f) || weakFrames.get(f) !== f.label) ok = false; });
console.log(ok, byFrame.has({ id: 0, label: "f0" }), frameSet.has({ id: 1, label: "f1" }), weakFrames.has({ id: 2, label: "f2" }));
console.log(byFrame.delete(frames[10]!), byFrame.has(frames[10]!), byFrame.size, frameSet.delete(frames[11]!), frameSet.size);
byFrame.set(frames[10]!, -10); frameSet.add(frames[11]!);
console.log([...byFrame.keys()].slice(-2).map((f) => f.id).join(), [...frameSet].slice(-2).map((f) => f.id).join(), byFrame.get(frames[10]!));
// a record mutated after it became a key is the same key
frames[20]!.label = "renamed";
console.log(byFrame.get(frames[20]!), frameSet.has(frames[20]!), weakFrames.get(frames[20]!));
// tuples have no id slot: still found by identity, not by value
const pairs: Pair[] = [[1, 2], [1, 2], [3, 4]];
const byPair = new Map<Pair, string>();
pairs.forEach((p, i) => byPair.set(p, "p" + i));
console.log(byPair.size, byPair.get(pairs[0]!), byPair.get(pairs[1]!), byPair.get(pairs[2]!), byPair.get([1, 2]), byPair.delete(pairs[1]!), byPair.size);
// arrays and closures as keys
const arrays: number[][] = [[1], [1], [2]];
const fns: (() => number)[] = [() => 1, () => 1, () => 2];
const byArray = new Map<number[], number>(), byFn = new Map<() => number, number>();
arrays.forEach((a, i) => byArray.set(a, i)); fns.forEach((f, i) => byFn.set(f, i));
console.log(byArray.size, byArray.get(arrays[1]!), byArray.get([1]), byFn.size, byFn.get(fns[1]!), byFn.get(fns[2]!));
byArray.delete(arrays[0]!); byArray.set(arrays[0]!, 9);
console.log([...byArray.values()].join(), [...byArray.keys()].map((a) => a[0]).join());
// a record whose instances are built in a loop: all distinct keys
const made = new Set<Frame>();
for (let i = 0; i < 1000; i++) made.add({ id: i % 10, label: "x" });
console.log(made.size);
