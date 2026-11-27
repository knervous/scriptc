// Writing a member through a union of a record and classes: a class field,
// a setter over private state, and a record field; plain, compound and
// increment forms, with the receiver evaluated once.
interface Vec { x: number; y: number }
class Vector2 {
  private _x = 0;
  y = 0;
  writes = 0;
  get x(): number { return this._x; }
  set x(v: number) { this._x = v; this.writes++; }
}
class Point { x = 0; y = 0; }
function nudge(v: Vec | Vector2 | Point, by: number): void {
  v.x = v.x + by;
  v.y += by * 2;
  v.y++;
}
const a = new Vector2();
const b = new Point();
const c: Vec = { x: 1, y: 1 };
nudge(a, 1); nudge(b, 2); nudge(c, 3);
console.log(a.x, a.y, a.writes, b.x, b.y, c.x, c.y);
let picks = 0;
const pool: Array<Vec | Vector2 | Point> = [a, b, c];
const pick = (): Vec | Vector2 | Point => pool[picks++ % 3]!;
pick().x += 10;
pick().x = 7;
console.log(picks, a.x, a.writes, b.x, c.x);
