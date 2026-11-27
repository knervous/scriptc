// A class instance assigned to an interface that a method satisfies: the interface holds the instance by reference, so
// its methods dispatch to the class and later writes through either view are seen by both.
interface Shape {
  area(): number;
  name: string;
}
class Sq implements Shape {
  name = "sq";
  s = 2;
  area(): number {
    return this.s * this.s;
  }
}
class Rect implements Shape {
  name: string;
  w: number;
  h: number;
  constructor(name: string, w: number, h: number) {
    this.name = name;
    this.w = w;
    this.h = h;
  }
  area(): number {
    return this.w * this.h;
  }
}
const sq = new Sq();
const x: Shape = sq;
console.log(x.area(), x.name);
sq.s = 5;
x.name = "big";
console.log(x.area(), sq.name);
const shapes: Shape[] = [new Sq(), new Rect("r", 2, 3), { name: "lit", area: () => 7 }];
let sum = 0;
for (const s of shapes) sum += s.area();
console.log(sum, shapes.map((s) => s.name).join(","));
function describe(s: Shape): string {
  return `${s.name}=${s.area()}`;
}
console.log(describe(new Rect("q", 4, 4)), describe(sq));
