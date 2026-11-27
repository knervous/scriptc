// @profile: `base as Sub` is a checked downcast: a value of another class throws a catchable TypeError at the assertion (JS would continue and read undefined)
// @expect: circle 2 13
// @expect: 3
// @expect: threw true
class Shape { name: string; constructor(name: string) { this.name = name; } }
class Circle extends Shape {
  r: number;
  constructor(r: number) { super("circle"); this.r = r; }
  area(): number { return Math.round(Math.PI * this.r * this.r); }
}
class Square extends Shape { s: number; constructor(s: number) { super("square"); this.s = s; } }
function make(kind: number): Shape { return kind === 0 ? new Circle(2) : new Square(3); }
const c = make(0) as Circle;
console.log(c.name, c.r, c.area());
function first<T extends Shape>(list: Shape[]): T { return list[0]! as T; }
console.log(first<Circle>([new Circle(1)]).area());
try {
  const wrong = make(1) as Circle;
  console.log("no throw", wrong.r);
} catch (e) {
  console.log("threw", e instanceof TypeError);
}
