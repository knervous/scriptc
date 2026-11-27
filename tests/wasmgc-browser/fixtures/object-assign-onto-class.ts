// @options: {"interfaceClassArms": true}
// Object.assign(target, { ... }) onto a class instance runs each key's
// [[Set]]: setters fire, plain fields store; values are evaluated in order
// before any write; the call returns the target. Also onto a union.
interface Vec { x: number; y: number; z: number }
class ObservableVec3 {
  private _x = 0;
  private _y = 0;
  private _z = 0;
  sets = 0;
  get x(): number { return this._x; }
  set x(v: number) { this._x = v; this.sets++; }
  get y(): number { return this._y; }
  set y(v: number) { this._y = v; this.sets++; }
  get z(): number { return this._z; }
  set z(v: number) { this._z = v; this.sets++; }
}
class Mesh { position = new ObservableVec3(); visible = true; }
const order: string[] = [];
const at = (label: string, v: number): number => { order.push(label); return v; };
const mesh = new Mesh();
const back = Object.assign(mesh.position, { x: at("x", 1), y: at("y", 2), z: at("z", 3) });
console.log(back === mesh.position, mesh.position.x, mesh.position.y, mesh.position.z, mesh.position.sets, order.join(""));
Object.assign(mesh, { visible: false });
console.log(mesh.visible);
function place(target: Vec, x: number): void { Object.assign(target, { x, z: x * 2 }); }
const plain: Vec = { x: 0, y: 0, z: 0 };
place(plain, 4);
place(mesh.position, 5);
console.log(plain.x, plain.z, mesh.position.x, mesh.position.z, mesh.position.sets);
