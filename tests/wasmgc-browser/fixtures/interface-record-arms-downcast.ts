// @options: {"interfaceClassArms": true}
// @expect: mesh-a 3
// @expect: mesh-b 2
// @expect: threw true
// @expect: 0
// A structural supertype narrowed to a structural subtype with `as`: the
// source union's arms are not a subset of the destination's. The assertion
// checks the arm at runtime: arms the destination has retag, others throw.
interface SceneNode { name: string; visible?: boolean }
interface MeshNode extends SceneNode { positions: number[] }
class MeshObject implements MeshNode {
  name: string;
  positions: number[];
  constructor(name: string, positions: number[]) { this.name = name; this.positions = positions; }
}
class LightObject implements SceneNode {
  name: string;
  constructor(name: string) { this.name = name; }
}
const meshB: MeshNode = { name: "mesh-b", positions: [4, 5] };
const nodes: SceneNode[] = [
  new MeshObject("mesh-a", [1, 2, 3]),
  meshB,
  new LightObject("light"),
];
let thrown = false;
for (const node of nodes) {
  try {
    const mesh = node as MeshNode;
    console.log(mesh.name, mesh.positions.length);
  } catch (e) {
    thrown = e instanceof TypeError;
  }
}
console.log("threw", thrown);
const bare: SceneNode[] = [{ name: "bare" }];
let count = 0;
for (const node of bare) {
  if ("positions" in node) count += 1;
}
console.log(count);
