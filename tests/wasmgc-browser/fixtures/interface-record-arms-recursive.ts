// @options: {"interfaceClassArms": true}
// Mutually recursive structural types (a material and the plugins that take
// one) whose narrower records flow in by reference: every path to the plugin
// type maps it to one shape, so a shader material's plugin list is the same
// list read through the base material.
interface Plugin {
  name: string;
  apply: (material: Material) => number;
}
interface Material {
  name: string;
  version: number;
  plugins?: readonly Plugin[];
}
interface ShaderMaterial extends Material {
  code: string;
}
interface StandardMaterial extends Material {
  diffuse: number;
}
const bump: Plugin = { name: "bump", apply: (material) => material.version + 1 };
const shader: ShaderMaterial = { name: "shader", version: 1, code: "fn main() {}", plugins: [bump] };
const standard: StandardMaterial = { name: "standard", version: 5, diffuse: 0.5 };
const materials: Material[] = [shader, standard];
function run(material: Material): number {
  let total = 0;
  const plugins = material.plugins;
  if (plugins) for (const plugin of plugins) total += plugin.apply(material);
  material.version += 1;
  return total;
}
console.log(materials.map(run).join(","), shader.version, standard.version);
console.log(shader.plugins === materials[0]!.plugins, (materials[0] as ShaderMaterial).code);
