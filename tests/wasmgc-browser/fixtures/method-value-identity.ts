// @native-any-only: method-value identity through `any` needs native any (plain native reads a page wrapper there; the engine refuses a compiled method value)
class Counter {
  n = 0;
  inc(): number { this.n++; return this.n; }
}
const c = new Counter();
const d = new Counter();
const a = c.inc, b = c.inc;
console.log(a === b, c.inc === c.inc, c.inc === d.inc, Counter.prototype.inc === c.inc);
const bound = c.inc.bind(c);
console.log(bound(), bound(), bound === c.inc.bind(c));
const any: any = c;
console.log(any.inc === any.inc, any.inc === d.inc, typeof any.inc);
const fns = [c.inc, d.inc, c.inc];
console.log(fns[0] === fns[2], fns[0] === fns[1], new Set(fns).size);
