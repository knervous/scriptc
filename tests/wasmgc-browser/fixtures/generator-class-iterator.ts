// @known-defect(engine): engine dyn has no dynCheck from the page back to a tuple record (the generator pairs() yields [number, string]; the generator itself now crosses as a facade)
// @known-defect-expect: compile: dynCheck to a tuple record
class Bag {
  items: string[] = ["a", "b", "c"];
  *[Symbol.iterator](): Generator<string, void, undefined> {
    for (const it of this.items) yield it;
  }
  *pairs(): Generator<[number, string], void, undefined> {
    let i = 0;
    for (const it of this.items) yield [i++, it];
  }
  static *count(n: number): Generator<number, void, undefined> {
    for (let i = 0; i < n; i++) yield i;
  }
}
const bag = new Bag();
const viaSymbol = bag[Symbol.iterator]();
for (const x of viaSymbol) console.log(x);
for (const p of bag.pairs()) console.log(p[0], p[1]);
for (const n of Bag.count(3)) console.log(n);
const it = bag[Symbol.iterator]();
console.log(JSON.stringify(it.next()), JSON.stringify(it.return()), JSON.stringify(it.next()));
