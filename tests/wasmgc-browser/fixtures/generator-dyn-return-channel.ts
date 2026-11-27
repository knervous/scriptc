// @native-any-only: an any-typed generator stays untyped only in the native any model
// A generator reached through an untyped value: for-of over an untyped array closes its iterator with return(),
// and return(v) on a void-channel generator yields { value: v, done: true } like any other.
function* gen() { yield 1; yield 2; }
const g: any = gen();
console.log(g.next().value);
const r = g.return(7);
console.log(r.value, r.done, g.next().done);
const xs: any[] = [1, 2];
for (const x of xs) console.log(x);
const w: any = gen();
const fresh = w.return("early");
console.log(fresh.value, fresh.done, w.next().done);
const done: any = gen();
done.next(); done.next(); done.next();
console.log(JSON.stringify(done.return({ k: 1 })), JSON.stringify(done.return(undefined)), JSON.stringify(done.return()));
function* guarded() { try { yield 1; } finally { yield -1; } }
const gd: any = guarded();
gd.next();
const mid = gd.return(5);
console.log(mid.value, mid.done);
