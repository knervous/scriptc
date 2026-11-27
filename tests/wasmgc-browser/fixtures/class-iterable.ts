// @native-only: the engine dyn model keeps its fence for Iterator-typed class members
// Classes implementing Iterable<T> with [Symbol.iterator](): consumed by for-of, spread, Array.from, destructuring, new Set, and manual iteration.
class Bag implements Iterable<string> {
  items = ["x", "y", "z"];
  [Symbol.iterator](): Iterator<string> { return this.items[Symbol.iterator](); }
}
class Range implements Iterable<number> {
  lo: number; hi: number;
  constructor(lo: number, hi: number) { this.lo = lo; this.hi = hi; }
  *[Symbol.iterator](): Generator<number> { for (let n = this.lo; n < this.hi; n++) yield n; }
}
class Counter implements Iterable<number> {
  private n = 0;
  [Symbol.iterator](): Iterator<number> {
    return { next: () => (this.n < 3 ? { value: this.n++, done: false } : { value: undefined, done: true }) };
  }
}
for (const item of new Bag()) console.log(item);
console.log([...new Bag()].join(), Array.from(new Bag()).join(), Array.from(new Bag(), (s) => s + s).join());
console.log([...new Range(2, 5)].join(), Array.from(new Range(0, 3)).join());
const [first, ...rest] = new Bag();
console.log(first, rest.join());
console.log(new Set(new Bag()).size, new Map([...new Range(0, 2)].map((n) => [n, n * n] as [number, number])).get(1));
const it = new Bag()[Symbol.iterator]();
console.log(it.next().value, it.next().value);
console.log([...new Counter()].join());
