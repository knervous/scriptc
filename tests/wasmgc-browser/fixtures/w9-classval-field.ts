// @native-only: class values need the native object model
// Regression (a9083d09): a class field typed as a class value is required while
// reachability runs, before the base type slots: $classval preceded its
// supertype $fnbase in the rec group (TypeBuilder.buildAndDispose failed).
class Shape { n: number; constructor(n: number) { this.n = n; } area(): number { return this.n * 2; } }
class Square extends Shape { area(): number { return this.n * this.n; } }
class Holder {
  count = 0;
  kind: typeof Shape;
  constructor(kind: typeof Shape) { this.kind = kind; }
  make(n: number): Shape { this.count++; return new this.kind(n); }
}
const h = new Holder(Shape), g = new Holder(Square);
console.log(h.make(4).area(), g.make(4).area(), h.count + g.count);
