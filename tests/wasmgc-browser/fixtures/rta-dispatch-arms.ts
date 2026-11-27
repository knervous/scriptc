// Virtual dispatch keeps an arm only where a constructed class still reaches its implementation: an unconstructed
// override whose constructed subclass inherits it keeps its arm; an override nothing constructs drops its arm; an
// abstract base with one constructed implementation calls it directly.
class Shape {
  name(): string { return "shape"; }
  area(): number { return 0; }
}
class Square extends Shape {
  side: number;
  constructor(side: number) { super(); this.side = side; }
  name(): string { return "square"; }
  area(): number { return this.side * this.side; }
}
// Never constructed itself; its constructed subclass inherits name() from it.
class Polygon extends Shape {
  name(): string { return "polygon"; }
}
class Triangle extends Polygon {
  base: number;
  height: number;
  constructor(base: number, height: number) { super(); this.base = base; this.height = height; }
  area(): number { return (this.base * this.height) / 2; }
}
// Never constructed, and nothing under it is.
class Ghost extends Shape {
  name(): string { return "ghost"; }
  area(): number { return -1; }
}
void Ghost;

abstract class Codec {
  abstract encode(n: number): string;
  wrap(n: number): string { return `[${this.encode(n)}]`; }
}
class Hex extends Codec {
  encode(n: number): string { return n.toString(16); }
}
class Unused extends Codec {
  encode(n: number): string { return `unused ${n}`; }
}
void Unused;

const shapes: Shape[] = [new Shape(), new Square(3), new Triangle(4, 5)];
for (const s of shapes) console.log(s.name(), s.area());
const codecs: Codec[] = [new Hex()];
for (const c of codecs) console.log(c.encode(255), c.wrap(4096));
