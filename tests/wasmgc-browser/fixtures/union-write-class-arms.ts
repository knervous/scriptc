// @options: {"interfaceClassArms": true}
// Field writes through an interface that classes flow into: a record arm
// stores its field, a class arm its field, an accessor arm runs its setter
// (counted); the RHS evaluates once, before the dispatch.
interface Vec3 { x: number; y: number; z: number }
class ObservableVec3 {
  private _x = 0;
  private _y = 0;
  private _z = 0;
  changes = 0;
  get x(): number { return this._x; } set x(v: number) { this._x = v; this.changes++; }
  get y(): number { return this._y; } set y(v: number) { this._y = v; this.changes++; }
  get z(): number { return this._z; } set z(v: number) { this._z = v; this.changes++; }
}
class Vector3 { x = 0; y = 0; z = 0; }
interface DragOptions { dragAxis?: Vec3 }
function orient(options: DragOptions, src: Vec3): void {
  const dragAxis = options.dragAxis;
  if (dragAxis) { dragAxis.x = src.x; dragAxis.y = src.y; dragAxis.z = src.z; }
}
const obs = new ObservableVec3();
const opts: DragOptions[] = [{ dragAxis: obs }, { dragAxis: new Vector3() }, { dragAxis: { x: 0, y: 0, z: 0 } }, {}];
for (const o of opts) orient(o, { x: 1, y: 2, z: 3 });
console.log(obs.changes, obs.x, opts[1]!.dragAxis!.y, opts[2]!.dragAxis!.z);
let evaluated = 0;
const target: Vec3 = obs;
target.x = (evaluated++, 9);
console.log(evaluated, obs.x, obs.changes);
