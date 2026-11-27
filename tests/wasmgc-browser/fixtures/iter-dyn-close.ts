// @options: {"hostHandles": true}
// @native-any-only: untyped iteration as TS any (the engine and plain native lanes keep these values in the page)
// IteratorClose on untyped iteration: `return` runs on break, on a throw in the body, on an
// early-stopping destructuring pattern and on a refused Map entry, and never on exhaustion.
let log: string[] = [];
function counting(n: number, closeThrows = false): any {
  return {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { log.push("next"); return i < n ? { value: i++, done: false } : { value: undefined, done: true }; },
        return() { log.push("return"); if (closeThrows) throw new Error("close failed"); return {}; },
      };
    },
  };
}
const flush = (label: string) => { console.log(label, log.join(",")); log = []; };
for (const x of counting(3)) { if (x === 1) break; }
flush("break");
for (const x of counting(2)) { void x; }
flush("exhaust");
try { for (const x of counting(3)) { if (x === 1) throw new Error("body"); } } catch (e) { console.log((e as Error).message); }
flush("throw");
try { for (const x of counting(3, true)) { if (x === 1) throw new Error("body"); } } catch (e) { console.log((e as Error).message); }
flush("throw-and-close-throws");
try { for (const x of counting(3, true)) { if (x === 1) break; } } catch (e) { console.log((e as Error).message); }
flush("break-and-close-throws");
const [a, b] = counting(5);
console.log(a, b);
flush("destructure");
const [c, d, e2] = counting(2);
console.log(c, d, e2);
flush("destructure-short");
try { new Map<any, any>(counting(3)); } catch (e) { console.log((e as Error).name, (e as Error).message); }
flush("map-bad-entry");
console.log(new Set<any>(counting(3)).size);
flush("set");
console.log(JSON.stringify(Array.from(counting(2) as any)));
flush("array-from");
console.log(JSON.stringify([...counting(2)]));
flush("spread");
// A class iterator and a generator's finally clause run on break.
class Bag {
  *[Symbol.iterator](): Generator<number> { try { yield 1; yield 2; yield 3; } finally { console.log("generator closed"); } }
}
const bag: any = new Bag();
for (const x of bag) { if (x === 2) break; }
// Built-in iterators have no `return`, and are not the prototype's own.
const m: any = new Map<any, any>([["k", 1]]);
const mi = m.entries();
console.log(typeof mi.return, Object.getOwnPropertyNames(mi).length, typeof mi.next, typeof mi[Symbol.iterator]);
console.log(Object.prototype.toString.call(mi), Object.prototype.toString.call([].values()));
console.log(JSON.stringify(mi.next()), JSON.stringify(mi.next()), JSON.stringify(mi.next()));
const si = (new Set<any>([1, 2]) as any).values();
console.log(Object.getPrototypeOf(si) === Object.getPrototypeOf((new Set<any>([9]) as any).values()), Object.getPrototypeOf(si) !== Object.getPrototypeOf(mi));
try { mi.next.call(si); } catch (e) { console.log((e as Error).name); }
try { mi.next.call({}); } catch (e) { console.log((e as Error).name); }
