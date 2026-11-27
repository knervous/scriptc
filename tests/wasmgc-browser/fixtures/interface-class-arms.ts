// @options: {"interfaceClassArms": true}
// Structural types accept classes, by reference: a vector class whose x/y/z
// are accessors flows into `{ x; y; z }`, an entity with computed getters
// into a body interface, streamer classes into a method interface. Writes
// through the interface reach the class; literals stay plain records.
interface Vec3Like { x: number; y: number; z: number }
class Vector3 {
  private _x: number;
  private _y: number;
  private _z: number;
  dirty = 0;
  constructor(x: number, y: number, z: number) {
    this._x = x;
    this._y = y;
    this._z = z;
  }
  get x(): number { return this._x; }
  set x(v: number) { this._x = v; this.dirty++; }
  get y(): number { return this._y; }
  set y(v: number) { this._y = v; this.dirty++; }
  get z(): number { return this._z; }
  set z(v: number) { this._z = v; this.dirty++; }
}
interface Body {
  readonly spawnPosition: Vec3Like;
  readonly visualCenterY: number;
  readonly lifecycleDisposed?: boolean;
}
class Entity {
  spawnPosition = new Vector3(1, 2, 3);
  height = 4;
  disposed = false;
  get visualCenterY(): number { return this.spawnPosition.y + this.height / 2; }
  get lifecycleDisposed(): boolean { return this.disposed; }
}
interface Region { minX: number; maxX: number }
interface Streamer { applyRegion(regions: Region[]): void }
class PhysicsStreamer { applied = 0; applyRegion(regions: Region[]): void { this.applied += regions.length; } }

function lift(v: Vec3Like, by: number): void { v.y += by; }
function centre(body: Body): number {
  return body.lifecycleDisposed ? -1 : body.visualCenterY + body.spawnPosition.x;
}
function total(points: readonly Vec3Like[]): number {
  let sum = 0;
  for (const p of points) sum += p.x + p.y + p.z;
  return sum;
}
function nearest(points: readonly Vec3Like[]): Vec3Like {
  return points[0]!;
}

const v = new Vector3(1, 1, 1);
lift(v, 5);
const plain: Vec3Like = { x: 0, y: 0, z: 0 };
lift(plain, 2);
console.log(v.y, v.dirty, plain.y);
const e = new Entity();
console.log(centre(e), centre({ spawnPosition: { x: 10, y: 0, z: 0 }, visualCenterY: 1 }));
e.spawnPosition.y = 20;
console.log(centre(e));
e.disposed = true;
console.log(centre(e));
console.log(total([v, plain, { x: 1, y: 1, z: 1 }]));
const first = nearest([v, plain]);
first.x = 9;
console.log(v.x, v.dirty);
const layers: Streamer[] = [new PhysicsStreamer(), { applyRegion: (r) => console.log("literal", r.length) }];
for (const layer of layers) layer.applyRegion([{ minX: 0, maxX: 1 }]);
console.log((layers[0] as PhysicsStreamer).applied);
// An interface only one class implements and no literal builds: the class.
interface Clock {
  readonly label: string;
  now(): number;
  advance(by: number): void;
}
class FrameClock {
  readonly label = "frame";
  private t = 100;
  now(): number { return this.t; }
  advance(by: number): void { this.t += by; }
}
function tick(clock: Clock): number {
  clock.advance(5);
  return clock.now();
}
const clocks: Clock[] = [new FrameClock()];
console.log(tick(clocks[0]!), clocks[0]!.label);
// A base class and its subclass both flow into one interface: the base is
// the one arm, and the subclass's override dispatches virtually.
interface Shape { area(): number; readonly name: string }
class Square { readonly side: number; constructor(side: number) { this.side = side; } readonly name: string = "square"; area(): number { return this.side * this.side; } }
class Cube extends Square { override readonly name: string = "cube"; override area(): number { return 6 * super.area(); } }
const shapes: Shape[] = [new Square(2), new Cube(2)];
for (const s of shapes) console.log(s.name, s.area());
