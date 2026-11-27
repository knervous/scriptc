// performance.now() is one typed clock read and `typeof performance` one typed probe, both answered live by the page: a replaced
// now(), a non-callable now and an absent global behave as they do in JavaScript.
const g = globalThis as any;
const stamp = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());
const t0 = performance.now();
let spin = 0;
for (let i = 0; i < 5000; i++) spin += i;
const t1 = performance.now();
console.log(typeof t0, t1 >= t0, t0 >= 0, spin, typeof performance, typeof performance === "undefined", typeof performance !== "undefined");
console.log(stamp() >= t1, typeof stamp(), (() => performance.now())() >= t1);
// each read asks the page: a replaced now() is what runs
const real = g.performance.now;
let calls = 0;
g.performance.now = () => { calls++; return 1000 + calls; };
console.log(performance.now(), performance.now(), stamp(), calls);
g.performance.now = 5;
try { performance.now(); } catch (e) { console.log("not callable:", (e as Error).name); }
g.performance.now = real;
console.log(performance.now() >= t1);
// the page's global absent, then back
const saved = g.Object.getOwnPropertyDescriptor(globalThis, "performance")!;
g.Reflect.deleteProperty(globalThis, "performance");
console.log(typeof performance, typeof performance === "undefined", stamp() > 1e12);
try { performance.now(); } catch (e) { console.log("absent:", (e as Error).name); }
g.Object.defineProperty(globalThis, "performance", saved);
console.log(typeof performance, performance.now() >= t1);
