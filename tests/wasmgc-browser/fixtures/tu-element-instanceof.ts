// Base-class collections read element by element: an element read is
// `T | undefined` (held as the reference itself), and `instanceof` on it,
// for-of variables, overrides and holes behave as in JavaScript.
class Shape { area(): number { return 0; } name(): string { return "shape"; } }
class Circle extends Shape { r: number; constructor(r: number) { super(); this.r = r; } area(): number { return 3 * this.r * this.r; } name(): string { return "circle"; } }
class Rect extends Shape { w: number; h: number; constructor(w: number, h: number) { super(); this.w = w; this.h = h; } area(): number { return this.w * this.h; } }
class Square extends Rect { constructor(s: number) { super(s, s); } name(): string { return "square"; } }

const xs: Shape[] = [new Circle(1), new Rect(2, 3), new Square(2), new Shape(), new Circle(2)];
let circles = 0, rects = 0, area = 0;
const names: string[] = [];
for (const x of xs) {
  if (x instanceof Circle) circles += x.r;
  if (x instanceof Rect) rects++;
  area += x.area();
  names.push(x.name());
}
console.log(circles, rects, area, names.join(","));
console.log(xs[0] instanceof Circle, xs[1] instanceof Circle, xs[2] instanceof Rect, xs[9] instanceof Shape, xs[3] instanceof Shape);
const holes: Shape[] = [];
holes[2] = new Square(1);
let present = 0;
for (let i = 0; i < holes.length; i++) { const h = holes[i]; if (h instanceof Square) present += h.w; else if (h === undefined) present += 100; }
console.log(holes.length, present);
const byId = new Map<number, Shape>();
xs.forEach((s, i) => byId.set(i, s));
const hit = byId.get(2), miss = byId.get(42);
console.log(hit instanceof Square, miss instanceof Shape, hit?.name(), miss?.name());
