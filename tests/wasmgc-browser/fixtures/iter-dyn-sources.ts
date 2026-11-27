// @options: {"hostHandles": true}
// @native-any-only: untyped collections and iterators as TS any (the engine and plain native lanes keep these values in the page)
// The iteration protocol over untyped (dyn) values: arrays, strings, Map/Set,
// generators, iterator objects and objects with a Symbol.iterator method.
function collect(src: any): any[] {
  const out: any[] = [];
  for (const x of src) out.push(x);
  return out;
}
class Bag { items = [1, 2, 3]; *[Symbol.iterator](): Generator<number> { for (const x of this.items) yield x; } }
const gen = (): any => new Bag();
const arr: any = [1, 2, 3];
console.log(JSON.stringify(collect(arr)));
console.log(JSON.stringify(collect("a\u{1F600}b")));
const m: any = new Map<any, any>([["a", 1], ["b", 2]]);
console.log(JSON.stringify(collect(m)));
const s: any = new Set<any>([1, 2, 2, 3]);
console.log(JSON.stringify(collect(s)));
console.log(JSON.stringify(collect(m.keys())));
console.log(JSON.stringify(collect(s.values())));
console.log(JSON.stringify(collect(m.entries())));
const g: any = new Bag();
console.log(JSON.stringify(collect(g)));
const custom: any = { [Symbol.iterator]() { let i = 0; return { next: () => (i < 3 ? { value: i++ * 10, done: false } : { value: undefined, done: true }) }; } };
console.log(JSON.stringify(collect(custom)));
// live Map: entries added during iteration are visited
const live: any = new Map<any, any>([[1, "x"]]);
const seen: any[] = [];
for (const [k] of live) { seen.push(k); if (k < 3) live.set(k + 1, "y"); }
console.log(JSON.stringify(seen));
const liveSet: any = new Set<any>([1]);
const seen2: any[] = [];
for (const v of liveSet) { seen2.push(v); if (v < 4) { liveSet.add(v + 1); } if (v === 2) liveSet.delete(3); }
console.log(JSON.stringify(seen2));
// Array.from
const af = (x: any): any => Array.from(x);
console.log(JSON.stringify(af(m.keys())));
console.log(JSON.stringify(af(s)));
console.log(JSON.stringify(af("héllo")));
console.log(JSON.stringify(af(gen())));
console.log(JSON.stringify(af({ length: 2, 0: "p", 1: "q" })));
// spread
console.log(JSON.stringify([...(m as any), ...(s as any), ...(custom as any)]));
// new Map / new Set from dyn sources
const ents: any = new Set<any>([["k1", 1], ["k2", 2]]);
console.log(JSON.stringify([...new Map<any, any>(ents as any)]));
console.log(JSON.stringify([...new Set<any>("abca" as any)]));
console.log(JSON.stringify([...new Set<any>(gen() as any)]));
console.log(JSON.stringify([...new Map<any, any>(m as any)]));
console.log(JSON.stringify([...new Map<any, any>(m.entries() as any)]));
// destructuring
const [d0, d1, ...drest] = s as any;
console.log(d0, d1, JSON.stringify(drest));
const [e0, e1] = gen() as any;
console.log(e0, e1);
