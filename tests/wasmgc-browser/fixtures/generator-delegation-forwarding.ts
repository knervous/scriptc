// @native-only: the engine dyn model keeps the numbered divergence (return()/throw() do not forward through yield*) and fences iterable delegation
// yield* forwards the consumer's return() and throw() to the delegate (finally blocks, re-yield, uncaught throw) and next(v) values.
function* inner(): Generator<number, string, undefined> {
  try { yield 1; yield 2; return "inner"; } finally { console.log("inner finally"); }
}
function* outer(): Generator<number, void, undefined> {
  try { const r = yield* inner(); console.log("r", r); yield 9; } finally { console.log("outer finally"); }
}
const a = outer();
console.log(JSON.stringify(a.next()));
console.log(JSON.stringify(a.return()));
console.log(JSON.stringify(a.next()));
const b = outer();
b.next();
try { b.throw(new Error("boom")); } catch (e) { console.log("caught", (e as Error).message); }
console.log(JSON.stringify(b.next()));
function* catcher(): Generator<number, void, undefined> {
  try { yield 1; } catch (e) { console.log("inner caught", (e as Error).message); yield 7; }
}
function* wrap(): Generator<number, void, undefined> { yield* catcher(); yield 8; }
const c = wrap();
c.next();
console.log(JSON.stringify(c.throw(new Error("t1"))));
console.log(JSON.stringify(c.next()));
console.log(JSON.stringify(c.next()));
