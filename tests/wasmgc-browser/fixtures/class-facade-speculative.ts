// @profile: a page-visible class's methods are compiled speculatively (the page may call any of them); one that does not compile is left out and the page's call throws a TypeError naming it, instead of failing the build
// @expect: 3 function
// @expect: lock TypeError Odd.prototype.lock is not available to JavaScript (the compiled class does not carry it)
// @expect: 3
const h: any = globalThis;
class Odd {
  n = 2;
  *lock(): Generator<number> { yield this.n; }
  ok(): number { return this.n + 1; }
}
const o = new Odd();
const page: any = o;
console.log(h.auditCallWith(h.Reflect.get(page, "ok"), page), typeof h.Reflect.get(page, "lock"));
try { h.auditCallWith(h.Reflect.get(page, "lock"), page); console.log("locked"); } catch (e) { console.log("lock", (e as Error).name, (e as Error).message); }
console.log(o.ok());
