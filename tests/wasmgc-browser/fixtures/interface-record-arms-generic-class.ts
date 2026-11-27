// @options: {"interfaceClassArms": true}
// A generic class instantiation flows into a structural slot by reference,
// like a plain class: the slot's methods dispatch to the instance, and a
// write through one view is seen through the other.
class Observable<T> {
  private subs: ((arg: T) => void)[] = [];
  add(cb: (arg: T) => void): () => void {
    this.subs.push(cb);
    return () => { const i = this.subs.indexOf(cb); if (i >= 0) this.subs.splice(i, 1); };
  }
  notify(arg: T): void { for (const s of this.subs) s(arg); }
  get size(): number { return this.subs.length; }
}
interface Subscribable { add: (cb: () => void) => unknown }
interface Counter { size: number }
const moves = new Observable<number>();
const names = new Observable<string>();
const parts: { name: string; changed: Subscribable }[] = [
  { name: "move", changed: moves },
  { name: "name", changed: names },
];
let fired = 0;
for (const part of parts) part.changed.add(() => { fired += 1; });
moves.notify(1);
names.notify("a");
names.notify("b");
console.log(fired, moves.size, names.size);
const sized: Counter[] = [moves, names, { size: 9 }];
console.log(sized.map((c) => c.size).join(","));
// A subclass of an instantiation next to the instantiation itself.
class Doubled extends Observable<number> { notify(arg: number): void { super.notify(arg * 2); } }
const d = new Doubled();
const seen: number[] = [];
d.add((v) => seen.push(v));
const slots: Subscribable[] = [moves, d];
slots[1]!.add(() => { fired += 10; });
d.notify(4);
console.log(seen.join(","), fired);
