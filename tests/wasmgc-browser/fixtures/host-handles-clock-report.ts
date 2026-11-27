// @options: {"hostHandles": true}
// performance.now() (Performance -> f64), Date.now() (-> f64) and reportError(x) (window member).
const h: any = globalThis;
const reports: string[] = [];
h.reportError = (e: unknown) => { reports.push(String(e)); };
const t0 = performance.now(), d0 = Date.now();
let spin = 0;
for (let i = 0; i < 2000; i++) spin += i;
const t1 = performance.now(), d1 = Date.now();
console.log(typeof t0, t1 >= t0, d1 >= d0, Math.abs(d1 - Date.now()) < 1000, spin);
console.log(typeof performance.now(), performance.now() >= t1);
reportError("first");
reportError(42);
reportError(undefined);
console.log(reports.join("|"));
h.reportError = undefined;
try { reportError("gone"); } catch (e) { console.log((e as Error).name); }
