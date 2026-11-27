// @native-only: class values (a class chosen at run time) need the native dyn model
// Methods of a class no reachable code constructs are not compiled (rapid type analysis, closed world): the call sits behind a
// null receiver, so the body can never run. A class constructed by `new`, through a subclass, or through a class value keeps
// every method; statics of a never-constructed class still run.
class Ghost {
  static label(): string { return "ghost-static"; }
  run(f: any, xs: any): any { return f(...xs); }
  twice(f: any, xs: any): any { return [this.run(f, xs), this.run(f, xs)]; }
}
function useGhost(g: Ghost | null, f: any, xs: any): string {
  return g === null ? "no ghost" : String(g.twice(f, xs));
}
console.log(useGhost(null, Math.max, [1, 2]), Ghost.label());

class Shape {
  area(): number { return 0; }
  describe(): string { return `${this.name()}:${this.area()}`; }
  name(): string { return "shape"; }
}
class Square extends Shape {
  s: number;
  constructor(s: number) { super(); this.s = s; }
  area(): number { return this.s * this.s; }
  name(): string { return "square"; }
}
class Circle extends Shape {
  r: number;
  constructor(r: number) { super(); this.r = r; }
  area(): number { return Math.round(3.14159 * this.r * this.r); }
}
class Unused extends Shape {
  area(): number { return -1; }
}
function show(s: Shape): string { return s.describe(); }
console.log(show(new Square(3)), show(new Circle(2)));
const Kind = Math.random() > 2 ? Square : Circle;
console.log(show(new Kind(1)));
function pick(u: Unused | null): string { return u === null ? "none" : u.describe(); }
console.log(pick(null));
class Counter { n = 0; inc(): number { return ++this.n; } }
function make(): Counter { return new Counter(); }
const c = make();
c.inc();
console.log(c.inc());
