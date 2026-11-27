// Reading a member through a union whose arms answer it differently: a
// record field, a class field, a class getter over private state, and a
// getter a subclass overrides. Each arm is read its own way, live.
interface Vec { x: number; y: number; z: number }
class Vector3 {
  private _x: number;
  private _y: number;
  private _z: number;
  constructor(x: number, y: number, z: number) {
    this._x = x;
    this._y = y;
    this._z = z;
  }
  get x(): number { return this._x; }
  set x(v: number) { this._x = v; }
  get y(): number { return this._y; }
  get z(): number { return this._z; }
}
class Body {
  x = 1;
  z = 3;
  protected h = 2;
  get y(): number { return this.h * 10; }
}
class TallBody extends Body {
  override get y(): number { return this.h * 100; }
}
function sum(v: Vec | Vector3 | Body): number {
  return v.x + v.y + v.z;
}
const a = new Vector3(1, 2, 3);
console.log(sum(a), sum({ x: 1, y: 1, z: 1 }), sum(new Body()), sum(new TallBody()));
a.x = 40;
console.log(sum(a));
const all: Array<Vec | Vector3 | Body> = [a, { x: 0, y: 5, z: 0 }, new TallBody()];
let total = 0;
for (const v of all) total += v.y;
console.log(total);
