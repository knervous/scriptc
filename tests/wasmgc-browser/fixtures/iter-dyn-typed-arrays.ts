// @options: {"hostHandles": true}
// @native-any-only: typed arrays held as TS any (the engine and plain native lanes keep these values in the page)
// Typed arrays (Array<T> structs) entering untyped code iterate in Wasm: for-of, spread, destructuring, Array.from,
// new Set / new Map, and the iterators of .values() / .keys() / .entries() (React DOM: new Set("a b c".split(" "))).
interface P { n: number; s: string }
const words = (s: string): any => s.split(" ");
const nums = (): any => [1.5, 2.5, 4];
const flags = (): any => [true, false, true];
const recs = (): any => { const a: P[] = [{ n: 1, s: "x" }, { n: 2, s: "y" }]; return a; };
const pairs = (): any => { const a: [string, number][] = [["k1", 1], ["k2", 2]]; return a; };
const af = (x: any): any => Array.from(x);
for (const kind of [words("abort canplay load"), nums(), flags()]) {
  const seen: any[] = [];
  for (const x of kind) seen.push(x);
  console.log(JSON.stringify(seen), JSON.stringify([...kind]), JSON.stringify(af(kind)));
}
console.log(JSON.stringify([...new Set<any>(words("abort canplay abort load"))]));
console.log(JSON.stringify([...new Map<any, any>(pairs())]), new Set<any>(nums()).size);
console.log(JSON.stringify(af(recs()).map((r: P) => r.s)), JSON.stringify([...recs()].map((r: any) => r.n)));
const [a, b, ...rest] = words("p q r s");
console.log(a, b, JSON.stringify(rest));
const [n0, n1] = nums();
console.log(n0, n1);
const w = words("u v w");
const vi = w.values(), ki = w.keys(), ei = w.entries();
console.log(JSON.stringify(vi.next()), JSON.stringify(ki.next()), JSON.stringify(ei.next()), typeof vi.next, Object.getOwnPropertyNames(vi).length);
console.log(JSON.stringify([...w.keys()]), JSON.stringify([...w.entries()]), JSON.stringify(af(nums().values())));
// live length
const live = words("a b");
const li = live.values();
li.next();
live.push("c");
console.log(JSON.stringify([...li]));
