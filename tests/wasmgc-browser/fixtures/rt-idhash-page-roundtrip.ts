// A compiled object that crossed to the page and came back is the same key: its hash does not depend on which side numbered it.
// Instances, typed records, dyn objects and arrays go through page functions (identity, array and Map storage, a page Map keyed by
// them) and return; a Map filled before the crossing finds them after, and one filled after finds the originals.
// @hits(native,native-any): ^\$hash\.
class Actor { readonly name: string; constructor(name: string) { this.name = name; } }
interface Stat { hp: number }
const g = globalThis as any;
const identity = new g.Function("x", "return x");
const stash = new g.Function("x", "var m = new Map([[x, 1]]); var a = [x, {inner: x}]; return {m: m, a: a, first: m.keys().next().value, same: a[0] === x}");
const actors = [new Actor("a"), new Actor("b"), new Actor("c")];
const stats: Stat[] = [{ hp: 1 }, { hp: 2 }, { hp: 3 }];
const dyns: any[] = [{ d: 1 }, { d: 2 }, { d: 3 }];
const arrs: any[] = [[1], [2], [3]];
const keys: any[] = [];
actors.forEach((a) => keys.push(a)); stats.forEach((s) => keys.push(s)); dyns.forEach((d) => keys.push(d)); arrs.forEach((a) => keys.push(a));
const before = new Map<unknown, number>();
keys.forEach((k, i) => before.set(k, i));
const typedBefore = new Map<Actor, string>(), recBefore = new Map<Stat, string>();
actors.forEach((a) => typedBefore.set(a, a.name)); stats.forEach((s, i) => recBefore.set(s, "s" + i));
// out and back
const back: any[] = keys.map((k) => identity(k));
console.log(back.map((k, i) => k === keys[i]).join());
console.log(back.map((k) => before.get(k)).join());
// a typed value returned from the page
const backActors = actors.map((a): Actor => identity(a));
const backStats = stats.map((s): Stat => identity(s));
console.log(backActors.map((a) => typedBefore.get(a)).join(), backStats.map((s) => recBefore.get(s)).join(), backActors[0] === actors[0], backStats[1] === stats[1]);
// a Map filled after the crossing
const after = new Map<unknown, number>(), afterTyped = new Map<Actor, number>();
back.forEach((k, i) => after.set(k, i)); backActors.forEach((a, i) => afterTyped.set(a, i));
console.log(keys.map((k) => after.get(k)).join(), actors.map((a) => afterTyped.get(a)).join());
// stored in page containers, then read back out
const kept = stash(actors[1]);
const keptActor: Actor = kept.a[0];
console.log(kept.same, kept.first === actors[1], before.get(kept.first), typedBefore.get(keptActor), kept.m.get(actors[1]), kept.a[1].inner === actors[1]);
const keptDyn = stash(dyns[2]);
console.log(keptDyn.first === dyns[2], before.get(keptDyn.first), before.get(keptDyn.a[0]), keptDyn.m.get(dyns[2]));
// a page Map keyed by compiled objects agrees with a compiled Map
const pageMap = new g.Map(); const pageSet = new g.Set();
keys.slice(0, 9).forEach((k, i) => { pageMap.set(k, i); pageSet.add(k); });
console.log(keys.slice(0, 9).map((k) => pageMap.get(k) + ":" + before.get(k) + ":" + pageSet.has(k)).join());
// delete and re-insert after the crossing; iteration order is insertion order
before.delete(actors[0]); before.set(back[0], 100);
console.log([...before.values()].slice(-2).join(), before.size, before.get(actors[0]));
// a WeakMap / WeakSet keyed by an object that crossed
const weak = new WeakMap<object, string>(), weakSet = new WeakSet<object>();
back.forEach((k, i) => { weak.set(k, "w" + i); weakSet.add(k); });
console.log(keys.map((k) => weak.get(k)).join(), keys.every((k) => weakSet.has(k)));
// an object hashed first from the page side, as a key of a page function's result
const fresh = new Actor("fresh");
const viaPage: Actor = identity(fresh);
const late = new Map<Actor, string>();
late.set(viaPage, "page-first");
console.log(late.get(fresh), late.has(viaPage), late.size);
late.set(fresh, "again");
console.log(late.size, late.get(viaPage), late.get(fresh));
