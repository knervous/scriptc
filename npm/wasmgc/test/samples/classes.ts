abstract class Shape {
  name: string;
  constructor(name: string) { this.name = name; }
  abstract area(): number;
  describe(): string { return `${this.name} ${this.area().toFixed(3)}`; }
}
class Circle extends Shape {
  r: number;
  constructor(r: number) { super("circle"); this.r = r; }
  area(): number { return Math.PI * this.r * this.r; }
}
class Rect extends Shape {
  w: number;
  h: number;
  constructor(w: number, h: number) { super("rect"); this.w = w; this.h = h; }
  area(): number { return this.w * this.h; }
}
const shapes: Shape[] = [new Circle(1.5), new Rect(2, 3), new Circle(0.5)];
shapes.sort((a, b) => a.area() - b.area());
for (const s of shapes) console.log(s.describe());
const byName = new Map<string, number>();
for (const s of shapes) byName.set(s.name, (byName.get(s.name) ?? 0) + 1);
console.log(JSON.stringify([...byName]));
