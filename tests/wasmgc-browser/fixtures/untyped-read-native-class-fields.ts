// @native-only: the native object model hands an untyped reader a compiled field's value itself (a record with methods, an array of class/record arms, a function), so identity holds
import { childAt, describe, sameMaterial } from "./untyped-read-native-class-fields-helper.js";
interface Mat { name: string; bind(): number }
class Mesh {
  material: Mat | null = { name: "steel", bind: () => 7 };
  children: (Mesh | Mat)[] = [];
  onPick: (x: number) => number = (x) => x * 2;
}
const mesh = new Mesh();
const child = new Mesh();
mesh.children.push(child, { name: "leaf", bind: () => 1 });
console.log(describe(mesh), describe(child));
console.log(sameMaterial(mesh, mesh.material), childAt(mesh, 0) === child, (childAt(mesh, 1) as Mat).name);
child.material = null;
console.log(describe(child));
