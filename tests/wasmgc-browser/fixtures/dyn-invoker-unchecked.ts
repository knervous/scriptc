// @options: {"hostHandles": true}
// @native-any-only: `any` is a checked dyn value only in the native-any lane
// @profile: a closure whose parameter has no checked conversion from untyped code (a record with an accessor slot) is still a function; the call throws a TypeError naming the argument and field (Node just runs it)
// @expect: plain function 1x
// @expect: when function 2026
// @expect: live function TypeError: argument 0.n: a value of type accessor property cannot be checked from untyped code
// @expect: nested function TypeError: argument 0.inner.n: a value of type accessor property cannot be checked from untyped code
interface Live { get n(): number; label: string }
interface Outer { inner: Live }
const withLive = (x: Live): string => x.label + x.n;
const withOuter = (x: Outer): string => x.inner.label;
const plain = (a: number, b: string): string => a + b;
const when = (d: Date): string => String(d.getUTCFullYear());
function tryCall(name: string, f: any, a: any, b?: any): void {
  try { console.log(name + " " + typeof f + " " + f(a, b)); }
  catch (e: any) { console.log(name + " " + typeof f + " " + e.constructor.name + ": " + e.message); }
}
tryCall("plain", plain, 1, "x");
tryCall("when", when, new Date(Date.UTC(2026, 1, 1)));
tryCall("live", withLive, { label: "a", n: 1 });
tryCall("nested", withOuter, { inner: { label: "a", n: 1 } });
