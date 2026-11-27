// @options: {"hostHandles": true}
// @native-any-only: untyped collections as TS any (the engine and plain native lanes keep these values in the page)
// Map/Set iteration is live: entries added during the walk are visited, deleted ones are not,
// clear() mid-walk keeps later additions, a large churn (table compaction) loses no position,
// and an exhausted iterator stays done.
const m: any = new Map<any, any>([[1, "a"], [2, "b"], [3, "c"]]);
const seen: any[] = [];
for (const [k] of m) {
  seen.push(k);
  if (k === 1) { m.delete(2); m.set(4, "d"); }
  if (k === 3) m.set(5, "e");
}
console.log(JSON.stringify(seen));
const s: any = new Set<any>([1, 2, 3]);
const it = s.values();
console.log(JSON.stringify(it.next()));
s.clear();
s.add(10);
console.log(JSON.stringify(it.next()), JSON.stringify(it.next()));
s.add(11);
console.log(JSON.stringify(it.next()));
// Compaction while an iterator is mid-walk: delete and re-add enough to rebuild the table twice.
const big: any = new Map<any, any>();
for (let i = 0; i < 6; i++) big.set(i, i);
const bi = big.keys();
console.log(bi.next().value, bi.next().value);
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 6; i++) big.delete(i + round * 10);
  for (let i = 0; i < 40; i++) big.set(100 + round * 100 + i, i);
  for (let i = 0; i < 40; i++) big.delete(100 + round * 100 + i);
  for (let i = 0; i < 6; i++) big.set(i + (round + 1) * 10, i);
}
const rest: any[] = [];
for (let r = bi.next(); !r.done; r = bi.next()) rest.push(r.value);
console.log(JSON.stringify(rest));
// Array iteration reads the live length.
const arr: any = [1, 2, 3];
const out: any[] = [];
for (const x of arr) { out.push(x); if (x === 1) arr.push(4); if (x === 2) arr.length = 3; }
console.log(JSON.stringify(out));
const ai = arr.entries();
console.log(JSON.stringify(ai.next()), JSON.stringify([...arr.keys()]));
// Map and Set from each other's iterators.
const src: any = new Set<any>([["x", 1], ["y", 2]]);
console.log(JSON.stringify([...new Map<any, any>(src.values())]), JSON.stringify([...new Set<any>(new Map<any, any>([["p", 1]]).keys())]));
console.log(JSON.stringify(Array.from(new Map<any, any>([["q", 7]]).entries() as any)));
