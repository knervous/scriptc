// @native-only: the engine dyn model has no runtime freeze of a compiled record (it refuses the freeze loudly)
// Object.freeze sets the record's own integrity level: writes through any alias are ignored (sloppy) or throw (strict), the value is frozen.
type P = { x: number; tag: string };
type Holder = { inner: P; run: () => number; n: number };
const attempt = (write: () => void): void => {
  try {
    write();
  } catch {
    // strict mode throws a TypeError; sloppy mode ignores the write: the state below is what Node shows either way
  }
};
const cast = Object.freeze({ x: 1, tag: "a" }) as P;
attempt(() => { cast.x = 2; });
console.log(cast.x, Object.isFrozen(cast), Object.isSealed(cast), Object.isExtensible(cast));
const annotated: P = Object.freeze({ x: 3, tag: "b" });
attempt(() => { annotated.tag = "z"; });
console.log(annotated.tag, Object.isFrozen(annotated));
function make(): P {
  return Object.freeze({ x: 5, tag: "c" });
}
const made = make();
attempt(() => { made.x = 6; });
console.log(made.x, Object.isFrozen(made));
function take(p: P): number {
  attempt(() => { p.x = 99; });
  return p.x;
}
console.log(take(Object.freeze({ x: 7, tag: "d" })));
// Freeze is shallow and keeps identity; a record with a method freezes too.
const holder: Holder = Object.freeze({ inner: { x: 1, tag: "i" }, run: () => 4, n: 0 });
attempt(() => { holder.n = 1; });
holder.inner.x = 42;
console.log(holder.n, holder.inner.x, holder.run(), Object.isFrozen(holder), Object.isFrozen(holder.inner));
const original: P = { x: 1, tag: "o" };
const returned = Object.freeze(original);
attempt(() => { original.x = 9; });
console.log(returned === original, original.x, Object.isFrozen(original));
// A later freeze of a record already in use.
const live: P = { x: 1, tag: "l" };
live.x = 2;
Object.freeze(live);
attempt(() => { live.x = 3; });
attempt(() => { live.tag = "m"; });
console.log(live.x, live.tag);
const list = Object.freeze([1, 2, 3]) as number[];
attempt(() => { list[0] = 9; });
attempt(() => { list.push(4); });
console.log(list.join(","), Object.isFrozen(list));
// Records never frozen stay ordinary.
const plain: P = { x: 1, tag: "f" };
plain.x = 2;
console.log(plain.x, Object.isFrozen(plain), Object.isExtensible(plain));
const readonlyConfig: Readonly<P> = Object.freeze({ x: 8, tag: "e" });
console.log(readonlyConfig.x, readonlyConfig.tag);
