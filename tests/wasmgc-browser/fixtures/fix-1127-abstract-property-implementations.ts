// Abstract properties read and written through base-typed receivers: each concrete subclass implements them with a
// field (or an accessor), and base-typed reads and writes reach that implementation.
abstract class Shape {
  abstract readonly kind: string;
  abstract size: number;
  abstract get label(): string;
  describe(): string { return `${this.kind}(${this.size}) ${this.label}`; }
  grow(by: number): void { this.size += by; }
}
abstract class Polygon extends Shape {
  abstract sides: number;
  get label(): string { return `${this.sides}-gon`; }
}
class Square extends Polygon { readonly kind = "square"; size = 2; sides = 4; }
class Cube extends Square { depth = 3; }
class Circle extends Shape {
  readonly kind: string = "circle";
  #r = 1;
  get size(): number { return this.#r; }
  set size(v: number) { this.#r = v; }
  label = "round";
}
const shapes: Shape[] = [new Square(), new Circle(), new Cube()];
for (const s of shapes) {
  s.grow(10);
  s.size = s.size * 2;
  console.log(s.kind, s.size, s.label, s.describe());
}
const p: Polygon = new Cube();
p.sides += 2;
console.log(p.sides, p.label, p.kind);
const sq = new Square();
sq.size = 7;
console.log(sq.size, (sq as Shape).size, sq.kind);
let kinds = "";
for (const s of shapes) kinds += s.kind + "|";
console.log(new Circle().label, kinds);
