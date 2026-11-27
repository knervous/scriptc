// Number-key Map/Set lookups first try the entry at (key - first key) (mapRuntime's entry-at-key probe) and hash
// otherwise. Id tables, offset ids, out-of-order inserts, delete/clear/re-insert, growth, SameValueZero (-0, NaN),
// negatives, fractional, large and out-of-range keys, Sets, and iteration order must match Node.

function showNum(label: string, m: Map<number, number>): void {
  const parts: string[] = [];
  for (const [k, v] of m) parts.push((Object.is(k, -0) ? "-0" : String(k)) + "=" + v);
  console.log(label, m.size, parts.join(" "));
}
function probe(label: string, m: Map<number, number>, ks: number[]): void {
  console.log(label, ks.map(k => (m.has(k) ? "y" : "n") + (m.get(k) ?? "u")).join(" "));
}

// A dense id table: key i at entry i.
const ids: Map<number, number> = new Map();
for (let i = 0; i < 40; i++) ids.set(i, i * 10);
let sum = 0;
for (let r = 0; r < 3; r++) for (let i = 0; i < 40; i++) { const v = ids.get(i); ids.set(i, (v ?? 0) + 1); sum += ids.get((i * 7) % 40) ?? 0; }
console.log("ids sum", sum, ids.size);
probe("ids edges", ids, [-0, 0, 39, 40, -1, 0.5, 38.999, 1e300, -1e300, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1]);

// Delete in the middle: the slot dies, its key goes away, a re-insert appends at the end (the probe misses it).
ids.delete(5); ids.delete(0);
probe("after delete", ids, [0, 5, 6, 1]);
ids.set(5, 555); ids.set(0, 1000);
probe("re-inserted", ids, [0, 5, 6, 39]);
console.log("order head", [...ids.keys()].slice(0, 3).join(","), "tail", [...ids.keys()].slice(-3).join(","));
ids.set(5, (ids.get(5) ?? 0) + 1);
console.log("5 now", ids.get(5), "size", ids.size);

// Clear, then re-insert from another base (the first key moves).
ids.clear();
probe("cleared", ids, [0, 1, 5]);
for (let i = 100; i < 120; i++) ids.set(i, i);
probe("base 100", ids, [99, 100, 101, 119, 120, 0, 1]);
for (let i = 100; i < 120; i++) ids.set(i, (ids.get(i) ?? 0) + 0.5);
showNum("base 100 values", ids);

// Offset and negative bases, and keys inserted out of order.
const neg: Map<number, number> = new Map();
for (let i = -10; i < 10; i++) neg.set(i, i);
probe("neg", neg, [-10, -1, -0, 0, 9, 10, -11, -0.5]);
const shuffled: Map<number, number> = new Map();
for (const k of [7, 3, 9, 1, 0, 2, 8, 4, 6, 5]) shuffled.set(k, k * k);
probe("shuffled", shuffled, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) shuffled.set(k, (shuffled.get(k) ?? 0) + 1);
showNum("shuffled", shuffled);

// SameValueZero: -0 stored as +0, NaN keys, fractional keys next to integers.
const mixed: Map<number, number> = new Map();
mixed.set(-0, 1); mixed.set(1, 2); mixed.set(1.5, 3); mixed.set(NaN, 4); mixed.set(2, 5);
mixed.set(0, (mixed.get(-0) ?? 0) + 10);
mixed.set(NaN, (mixed.get(NaN) ?? 0) + 10);
mixed.set(1.5, (mixed.get(1.5) ?? 0) + 10);
showNum("mixed", mixed);
probe("mixed", mixed, [0, -0, 1, 1.5, 1.25, NaN, 2, 3]);
console.log("mixed delete", mixed.delete(-0), mixed.delete(NaN), mixed.delete(1.25), mixed.size);
showNum("mixed after", mixed);

// Growth past many rebuilds keeps ids at their entries; deletes before growth compact.
const big: Map<number, number> = new Map();
for (let i = 0; i < 3000; i++) big.set(i, i);
for (let i = 0; i < 3000; i += 3) big.delete(i);
for (let i = 3000; i < 6000; i++) big.set(i, i);
let s2 = 0;
for (let i = 0; i < 6000; i++) s2 += big.get(i) ?? -1;
console.log("big", big.size, s2, big.has(3), big.has(4), big.has(5999), big.has(6000));

// Sets of numbers take the same probe.
const set: Set<number> = new Set();
for (let i = 0; i < 20; i++) set.add(i);
set.delete(3); set.add(3); set.add(-0); set.add(NaN);
console.log("set", set.size, [...set].join(","), set.has(3), set.has(0), set.has(NaN), set.has(20), set.has(2.5));
set.clear(); set.add(4);
console.log("set cleared", set.size, set.has(0), set.has(4));

// Iteration while updating existing keys keeps order; adding during iteration is seen.
const it: Map<number, number> = new Map([[0, 0], [1, 1], [2, 2]]);
const seen: string[] = [];
for (const [k, v] of it) { seen.push(k + ":" + v); if (k < 2) it.set(k + 1, (it.get(k + 1) ?? 0) + 100); if (k === 2) it.set(3, 3); }
console.log("iter", seen.join(" "));
showNum("iter map", it);
