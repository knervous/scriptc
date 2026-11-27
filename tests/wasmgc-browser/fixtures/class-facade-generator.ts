// @profile: a generator method of a page-visible class is not compiled for the page (generators are unsupported here); calling it from the page throws a TypeError naming it
// @expect: function 3
// @expect: gen TypeError
const h: any = globalThis;
class Seq {
  n = 2;
  *gen() { yield this.n; }
  next(): number { return this.n + 1; }
}
const page: any = new Seq();
console.log(typeof h.Reflect.get(page, "gen"), h.auditCallWith(h.Reflect.get(page, "next"), page));
try { h.auditCallWith(h.Reflect.get(page, "gen"), page); console.log("called"); } catch (e) { console.log("gen", (e as Error).name); }
