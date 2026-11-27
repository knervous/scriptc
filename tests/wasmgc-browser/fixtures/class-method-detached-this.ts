// Method values read off an instance: a method that never names `this`
// stays callable detached; one that does (read, write, compound update, a
// nested arrow, a loop) is only called through its receiver.
class Counter {
  n = 0;
  label = "c";
  pure(a: number, b: number): number { return a + b; }
  constant(): string { return "k"; }
  bump(): number { this.n++; return this.n; }
  add(d: number): number { this.n += d; return this.n; }
  later(): () => number { return () => this.n * 2; }
  loop(k: number): number { let s = 0; for (let i = 0; i < k; i++) s += this.n + i; return s; }
  self(): Counter { return this; }
  describe(): string { return `${this.label}:${this.n}`; }
}
const c = new Counter();
const pure = c.pure;
const constant = c.constant;
console.log(pure(2, 3), constant(), pure(10, 20));
const fns: (() => string)[] = [constant, c.constant, () => c.constant()];
console.log(fns.map((f) => f()).join(","));
console.log(c.bump(), c.add(4), c.later()(), c.loop(3), c.self() === c, c.describe());
const bump = c.bump.bind(c);
console.log(bump(), bump(), c.n);
