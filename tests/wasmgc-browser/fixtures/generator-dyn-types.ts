// @native-any-only: an any-typed generator stays untyped only in the native any model
// Several generator types held untyped (different yield types): next, return, throw, for-of and spread dispatch on each one's own type.
function* nums() { yield 1; yield 2; yield 3; }
function* words() { yield "a"; yield "b"; }
function* flags(): Generator<boolean, string, undefined> { yield true; return "end"; }
const a: any = nums(), b: any = words(), c: any = flags();
console.log(a.next().value, b.next().value, c.next().value);
console.log(a.next().value, b.next().value, c.next().done, c.next().value);
console.log(JSON.stringify(a.return(9)), JSON.stringify(b.return("z")), JSON.stringify(b.next()));
const t: any = words();
t.next();
try { t.throw(new Error("boom")); } catch (e: any) { console.log(e.message, t.next().done); }
const n2: any = nums(), w2: any = words(), f2: any = flags();
const gens: any[] = [n2, w2, f2];
for (const g of gens) { const out: any[] = []; for (const v of g) out.push(v); console.log(out.join(",")); }
const n3: any = nums(), w3: any = words();
console.log([...n3].join(","), [...w3].join(","));
