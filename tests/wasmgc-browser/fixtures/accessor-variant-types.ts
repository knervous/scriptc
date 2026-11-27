// @options: {"interfaceClassArms": true}
// TS 5.1 variant accessors: the getter type is narrower than the setter type.
interface Material { name: string; }
interface Mesh {
  get material(): Material;
  set material(v: Material | null);
  id: number;
}
class MeshImpl implements Mesh {
  id = 1;
  private _m: Material | null = { name: "default" };
  get material(): Material { return this._m ?? { name: "fallback" }; }
  set material(v: Material | null) { this._m = v; }
}
function describe(m: Mesh): string { return m.id + ":" + m.material.name; }
const impl = new MeshImpl();
const mesh: Mesh = impl;
console.log(describe(mesh));
mesh.material = { name: "steel" };
console.log(describe(mesh), impl.material.name);
mesh.material = null;
console.log(describe(mesh));
impl.material = { name: "wood" };
console.log(describe(impl));
impl.material = null;
console.log(impl.material.name);
