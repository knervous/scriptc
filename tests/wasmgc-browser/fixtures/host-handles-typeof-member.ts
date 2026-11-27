// @options: {"hostHandles": true}
// typeof of a page value's member (js.typeof.member): methods, attributes read
// through their getter, absent members, React's feature test, compiled values
// through dyn, and the TypeError of a member of undefined.
const g = globalThis as any;
const perf = typeof performance === "object" && typeof performance.now === "function" ? "perf" : "none";
console.log(perf, typeof performance.timeOrigin, typeof g.console.log, typeof g.nope, typeof g.performance.nope);
const own: any = { f() { return 1; }, n: 2 };
console.log(typeof own.f, typeof own.n, typeof own.missing);
try {
  console.log(typeof g.nope.x);
} catch (e) {
  console.log(e instanceof TypeError ? "TypeError" : "other");
}
