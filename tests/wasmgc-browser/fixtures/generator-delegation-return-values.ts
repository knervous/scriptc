// @native-only: the engine dyn model keeps the numbered divergence (return()/throw() do not forward through yield*) and fences iterable delegation
// yield* over a generator delegate: forwarded next values, return() through finally blocks, a delegate that yields again.
function* inner(): Generator<number, string, undefined> {
  try { yield 1; yield 2; return "inner-done"; } finally { console.log("inner cleanup"); }
}
function* outer(): Generator<number, string, undefined> {
  try { const r = yield* inner(); return "outer:" + r; } finally { console.log("outer cleanup"); }
}
const a = outer();
a.next();
console.log(JSON.stringify(a.return("early")));
console.log(JSON.stringify(a.next()));
// delegate whose finally yields again: return() re-yields
function* stubborn(): Generator<number, string, undefined> {
  try { yield 1; return "x"; } finally { yield 99; }
}
function* wrap(): Generator<number, string, undefined> { const v = yield* stubborn(); return "w" + v; }
const w = wrap();
w.next();
console.log(JSON.stringify(w.return("r")));
console.log(JSON.stringify(w.next()));
console.log(JSON.stringify(w.next()));
// uncaught throw propagates, outer catch sees it
function* plain(): Generator<number, void, undefined> { yield 1; yield 2; }
function* guard(): Generator<number, void, undefined> {
  try { yield* plain(); } catch (e) { console.log("outer caught", (e as Error).message); yield 50; }
}
const g = guard();
g.next();
console.log(JSON.stringify(g.throw(new Error("bad"))));
console.log(JSON.stringify(g.next()));

function* words1(): Generator<number, string, string> {
  const a = yield 1;
  console.log("words got", a);
  const b = yield 2;
  console.log("words got", b);
  return a + "+" + b;
}
function* sentence1(): Generator<number, string, string> {
  const joined = yield* words1();
  console.log("joined", joined);
  const last = yield 3;
  return joined + "/" + last;
}
const s1 = sentence1();
console.log(JSON.stringify(s1.next("ignored")));
console.log(JSON.stringify(s1.next("x")));
console.log(JSON.stringify(s1.next("y")));
console.log(JSON.stringify(s1.next("z")));
console.log(JSON.stringify(s1.next("after")));
