// Module B: uses A's function, class and record, and C's subclass, through A's types.
import { scale, Shape, Rect, Size } from "./geom";
import { Square, squareSize } from "./square";

function report(s: Shape): string {
  return s.describe();
}

function total(shapes: Shape[]): number {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}

function show(size: Size): string {
  return size.w + "x" + size.h;
}

const r = new Rect(scale(2, 3), 4);
const q = new Square(5);
const shapes: Shape[] = [r, q, new Shape("blank")];
for (const s of shapes) console.log(report(s));
console.log("total " + total(shapes));
console.log("sizes " + show(r.size()) + " " + show(squareSize(q)));
