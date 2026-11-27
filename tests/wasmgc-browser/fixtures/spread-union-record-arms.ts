// @options: {"interfaceClassArms": true}
// Object spread of a source held as one of several record shapes (an
// interface's class arms, a union of two literal shapes): the copy takes
// exactly the held shape's fields; a field that shape lacks keeps the earlier
// contributor (defaults first), and later properties still override.
interface Armor { armorType: string; cut: string }
interface DeclaredArmor extends Armor { declared: boolean }
function appearance(entry: Armor | DeclaredArmor | null): { armorType: string; cut: string; declared: boolean } {
  return entry ? { declared: false, ...entry } : { declared: false, armorType: "cloth", cut: "fitted" };
}
const plain: Armor = { armorType: "plate", cut: "heavy" };
const declared: DeclaredArmor = { armorType: "mail", cut: "light", declared: true };
console.log(JSON.stringify(appearance(plain)), JSON.stringify(appearance(declared)), JSON.stringify(appearance(null)));

interface Node { name: string; visible?: boolean }
interface MeshNode extends Node { vertices: number }
interface LightNode extends Node { intensity: number; visible?: boolean }
type Partial3 = { name: string; visible?: boolean; vertices?: number; intensity?: number };
function describe(node: Node): Partial3 {
  const copy: Partial3 = { visible: true, ...node, name: node.name.toUpperCase() };
  return copy;
}
const nodes: Node[] = [
  { name: "root" },
  { name: "mesh", vertices: 12 } as MeshNode,
  { name: "lamp", intensity: 3, visible: false } as LightNode,
];
for (const node of nodes) {
  const d = describe(node);
  console.log(d.name, d.visible, d.vertices, d.intensity);
}
