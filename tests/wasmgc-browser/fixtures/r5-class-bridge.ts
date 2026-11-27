// The class bridge: a typed class hierarchy handed to untyped code (exact
// class dispatch — a subclass must not answer as its base).
import { useShapes } from './r5-helper.js';
class Shape {
  name: string;
  constructor(name: string) { this.name = name; }
  area(): number { return 0; }
  describe(): string { return "shape " + this.name; }
}
class Square extends Shape {
  sides: number;
  side: number;
  constructor(side: number) { super("square"); this.side = side; this.sides = 4; }
  area(): number { return this.side * this.side; }
}
class Circle extends Shape {
  r: number;
  constructor(r: number) { super("circle"); this.r = r; }
  area(): number { return Math.round(3.14159 * this.r * this.r); }
  describe(): string { return "round " + this.name; }
}
const shapes: Shape[] = [new Square(3), new Circle(2), new Shape("plain")];
console.log(useShapes(shapes));
console.log(shapes[1]!.name, shapes[1]!.area());
