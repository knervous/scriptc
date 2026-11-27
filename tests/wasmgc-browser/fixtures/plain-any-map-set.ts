// @plain-native-only: a typed Map / Set held as `any` reaches page-typed dispatch only in the plain native lane (native-any holds it as a dyn collection)
// A typed Map / Set (with class-instance values) stored in a page-typed `any`: methods, size, iteration and write-through are exact (they used to
// fail with "x.get is not a function" unless some untyped code in the program happened to call the same method), and the collection
// comes back to a typed binding as itself.
class Item { n: number; constructor(n: number) { this.n = n; } label(): string { return "item" + this.n; } }
const m = new Map<string, number>([["a", 1], ["b", 2]]);
const s = new Set<number>([1, 2]);
const mi = new Map<string, Item>([["k", new Item(7)]]);
const si = new Set<Item>([new Item(3)]);
const mx: any = m, sx: any = s, mix: any = mi, six: any = si;
console.log(mx.get("a"), mx.size, [...mx.keys()].join(), sx.has(2), sx.size, [...sx].join());
mx.set("c", 5); sx.add(9);
console.log(m.get("c"), m.size, s.has(9), s.size);
console.log(mix.get("k").n, mix.get("k").label());
for (const it of six) console.log(it.n, it.label());
const back: Map<string, number> = mx;
console.log(back === m, mx === (m as any));
