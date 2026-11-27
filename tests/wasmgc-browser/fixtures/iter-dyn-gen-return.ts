// @native-any-only: compiled generators resumed from untyped code (the engine and plain native lanes keep these values in the page)
// return(value) on a compiled generator resumes it with a return completion: a finally block that yields, or that returns
// its own value, decides the {value, done} result; otherwise the result carries the value passed.
class Plain { *[Symbol.iterator](): Generator<number, number> { try { yield 1; yield 2; } finally { console.log("plain cleanup"); } return 0; } }
class Override { *[Symbol.iterator](): Generator<number, number> { try { yield 1; yield 2; } finally { return 99; } } }
class Yielding { *[Symbol.iterator](): Generator<number, number> { try { yield 1; yield 2; } finally { yield 7; } return 0; } }
const show = (r: any): string => JSON.stringify(r);
const plain: any = new Plain(), over: any = new Override(), yl: any = new Yielding();
const p = plain[Symbol.iterator](), o = over[Symbol.iterator](), y = yl[Symbol.iterator]();
console.log(show(p.next()), show(p.return(5)), show(p.next()));
console.log(show(o.next()), show(o.return(5)), show(o.next()));
console.log(show(y.next()), show(y.return(5)), show(y.next()), show(y.next()));
const fresh = plain[Symbol.iterator]();
console.log(show(fresh.return(3)), show(fresh.next()));
// A break out of for-of closes the generator the same way.
for (const x of over) { console.log(x); break; }
for (const x of yl) { console.log(x); break; }
// Wasm loops (destructuring, new Set) close it too.
const [first] = plain;
console.log(first);
console.log(new Set<any>(over).size);
