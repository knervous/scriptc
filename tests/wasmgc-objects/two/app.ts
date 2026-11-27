import { scale, Shape, Rect } from "./geom";

function report(s: Shape): string {
  return s.describe();
}

const r = new Rect(scale(2, 3), 4);
console.log(report(r));
console.log(report(new Shape("blank")));
console.log("total " + (r.area() + scale(1.5, 2)));
