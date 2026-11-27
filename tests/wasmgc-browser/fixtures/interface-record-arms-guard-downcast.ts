// @profile: `node as MeshNode` over another class is a checked downcast that throws a catchable TypeError at the assertion (JS reads on and fails at first use)
// @options: {"interfaceClassArms": true}
// @expect: mesh-a 3 true
// @expect: light false
// @expect: cast mesh-a 3
// @expect: threw true
// A type guard and an assertion narrow a structural supertype whose class
// arm is an ancestor (SceneNodeObject) to a structural subtype whose arm is
// the subclass (MeshObject): the value downcasts, checked by its class.
interface SceneNode { name: string; parent?: SceneNode }
interface MeshNode extends SceneNode { positions: number[] }
class SceneNodeObject implements SceneNode {
  name: string;
  constructor(name: string) { this.name = name; }
}
class MeshObject extends SceneNodeObject implements MeshNode {
  positions: number[];
  constructor(name: string, positions: number[]) { super(name); this.positions = positions; }
}
function isMesh(node: SceneNode): node is MeshNode {
  return node instanceof MeshObject;
}
function sizeOf(mesh: MeshNode): number { return mesh.positions.length; }
const nodes: SceneNode[] = [new MeshObject("mesh-a", [1, 2, 3]), new SceneNodeObject("light")];
for (const node of nodes) {
  if (isMesh(node)) console.log(node.name, sizeOf(node), true);
  else console.log(node.name, false);
}
console.log("cast", (nodes[0]! as MeshNode).name, sizeOf(nodes[0]! as MeshNode));
let threw = false;
try {
  const bad = nodes[1]! as MeshNode;
  console.log(bad.name);
  sizeOf(bad);
} catch (e) {
  threw = e instanceof TypeError;
}
console.log("threw", threw);
