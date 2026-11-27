// @options: {"interfaceClassArms": true}
// Records flowing into a wider structural type are held by reference, as
// classes are: a Standard or PBR material record passed as a Material is the
// same object, so writes through the Material reach it, a downcast gets the
// original back, function fields call per arm, and a field one arm leaves out
// reads undefined.
interface Material {
  name?: string;
  version: number;
  describe: () => string;
}
interface StandardMaterial extends Material {
  diffuse: number;
}
interface PbrMaterial extends Material {
  metallic: number;
  roughness: number;
}
function makeStandard(diffuse: number): StandardMaterial {
  const material: StandardMaterial = { name: "std", version: 0, diffuse, describe: () => `standard ${material.diffuse}` };
  return material;
}
function makePbr(metallic: number): PbrMaterial {
  const material: PbrMaterial = { version: 0, metallic, roughness: 0.5, describe: () => `pbr ${material.metallic}` };
  return material;
}
function bump(material: Material): void {
  material.version += 1;
}
const standard = makeStandard(0.25);
const pbr = makePbr(1);
const materials: Material[] = [standard, pbr, standard];
for (const material of materials) bump(material);
console.log(standard.version, pbr.version);
const byName = new Map<Material, string>();
for (const material of materials) byName.set(material, material.name ?? "unnamed");
console.log(byName.size, byName.get(standard), byName.get(pbr));
const first = materials[0]!;
(first as StandardMaterial).diffuse = 0.75;
console.log(standard.diffuse, first === standard, materials[1] === pbr);
console.log(materials.map((m) => m.describe()).join(", "));
// A record whose own shape leaves out an optional field of the wider type.
const bare = { version: 3, describe: () => "bare" };
const all: Material[] = [standard, bare];
bump(bare);
console.log(all.map((m) => `${m.name ?? "-"}:${m.version}`).join(" "), bare.version);
// A record whose field is narrower than the wider type's (`label: string`
// behind `label?: string`) is held by reference too: reads widen, and a
// write through the wider type narrows into its slot.
interface Options { label?: string; count: number }
function touch(o: Options): string { o.count += 1; return o.label ?? "none"; }
function rename(o: Options, label: string): void { o.label = label; }
const named = { label: "a", count: 0 };
const counted: Options = { count: 5 };
console.log(touch(named), touch(counted), named.count, counted.count);
rename(named, "b");
console.log(named.label);
// A flow-narrowed read of an optional field some arms leave out.
interface Ring { frequency: number; decay: number }
interface Resonant { name: string; ring?: Ring }
const stoneRing = { name: "stone", ring: { frequency: 440, decay: 0.2 } };
const woodRing = { name: "wood" };
const resonant: Resonant[] = [stoneRing, woodRing];
for (const material of resonant) {
  if (material.ring) console.log(material.name, material.ring.frequency * 2);
  else console.log(material.name, "no ring");
}
