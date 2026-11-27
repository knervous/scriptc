// @options: {"interfaceClassArms": true}
// A page-resident holder (React's useRef: `{ current: T }`, typed by the
// program) written with an interface-typed value whose static type is the
// union of every implementer: the value crosses to the page as the value it is.
interface Pos { x: number; y: number }
class Vec implements Pos { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
class Tagged implements Pos { x: number; y: number; tag: string; constructor(x: number, y: number, tag: string) { this.x = x; this.y = y; this.tag = tag; } }
const h: any = globalThis;
const origin: { current: Pos } = h.auditIdentity({ current: { x: 0, y: 0 } });
const centre: Pos = { x: 3, y: 4 };
origin.current = centre;
console.log(origin.current.x, origin.current.y);
const spots: Pos[] = [new Vec(1, 2), new Tagged(5, 6, "t"), { x: 7, y: 8 }];
for (const s of spots) {
  origin.current = s;
  console.log(origin.current.x + origin.current.y);
}
const read = origin.current;
console.log(read instanceof Tagged, read.x);
