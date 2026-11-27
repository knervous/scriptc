// @native-only: the engine dyn model keeps its fences for iterators held as values and class iterables
// Every iterator source (array/typed-array/Map/Set iterators, strings, generators, class iterables) through every consumer: spread, new Set/Map, Object.fromEntries, destructuring, Math.max(...), for-of, Array.from.
function* gen(): Generator<number> { yield 1; yield 2; }
class Bag implements Iterable<number> { items = [7, 8]; [Symbol.iterator](): Iterator<number> { return this.items[Symbol.iterator](); } }
const m = new Map([["a", 1], ["b", 2]]);
const s = new Set([3, 4]);
const sources: Record<string, () => Iterable<any>> = {};
void sources;
const t = (name: string, f: () => unknown) => { try { console.log(name, JSON.stringify(f())); } catch (e) { console.log(name, "threw", (e as Error).name); } };
t("spread arr.keys", () => [...[9, 8].keys()]);
t("spread map.keys", () => [...m.keys()]);
t("spread map.entries", () => [...m.entries()]);
t("spread set.values", () => [...s.values()]);
t("spread str iter", () => [..."hi"[Symbol.iterator]()]);
t("spread gen", () => [...gen()]);
t("spread bag", () => [...new Bag()]);
t("new Set(map.keys())", () => [...new Set(m.keys())]);
t("new Set(arr.values())", () => [...new Set([1, 1, 2].values())]);
t("new Set(gen)", () => [...new Set(gen())]);
t("new Map(map.entries())", () => [...new Map(m.entries())]);
t("new Map(arr.entries())", () => [...new Map(["x", "y"].entries())]);
t("fromEntries(map.entries())", () => Object.fromEntries(m.entries()));
t("fromEntries(arr.entries())", () => Object.fromEntries(["x", "y"].entries()));
t("destructure gen", () => { const [a, b] = gen(); return [a, b]; });
t("destructure arr.keys", () => { const [a, b] = [5, 6].keys(); return [a, b]; });
t("destructure map.keys", () => { const [a] = m.keys(); return a; });
t("math.max(...gen)", () => Math.max(...gen()));
t("for-of set.values", () => { const out: number[] = []; for (const v of s.values()) out.push(v); return out; });
t("for-of gen", () => { const out: number[] = []; for (const v of gen()) out.push(v); return out; });
t("for-of arr.keys", () => { const out: number[] = []; for (const v of [4, 5].keys()) out.push(v); return out; });
t("Array.from(iter, mapper)", () => Array.from(m.values(), (x) => x * 10));
t("Promise.all(iter)", () => Promise.all([1, 2].values()).then(() => 1) !== undefined);
