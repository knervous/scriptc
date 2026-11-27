// glTF-loader-shaped feature objects: optional async methods on an interface
// whose result is a Partial of a container, implemented by unannotated
// object-literal methods that return `{}` or one member, and invoked through
// the interface (a flatMap over the features).
interface Container { meshes: string[]; lights: number[]; label?: string }
interface Ctx { scale: number }
interface Feature {
  id: string;
  applyAsset?(meshes: string[], root: string, ctx: Ctx): Promise<Partial<Container>>;
  decode?(bytes: Uint8Array): Promise<Uint8Array | undefined>;
}
const extras: Feature = {
  id: "extras",
  async applyAsset(_meshes, root, ctx) {
    if (ctx.scale < 0) throw new Error(root);
    return {};
  },
};
const lights: Feature = {
  id: "lights",
  async applyAsset(meshes, _root, ctx) {
    return { lights: meshes.map((_, i) => i * ctx.scale) };
  },
  async decode(bytes) {
    return bytes.subarray(1);
  },
};
const labels: Feature = {
  id: "labels",
  async applyAsset(meshes) {
    if (meshes.length === 0) return { label: undefined };
    return { label: meshes.join("+") };
  },
};
async function main(): Promise<void> {
  const features: Feature[] = [extras, lights, labels];
  const parts = await Promise.all(features.flatMap((f) => (f.applyAsset ? [f.applyAsset(["a", "b"], "root", { scale: 2 })] : [])));
  const merged: Partial<Container> = {};
  for (const part of parts) {
    if (part.meshes) merged.meshes = part.meshes;
    if (part.lights) merged.lights = part.lights;
    if (part.label !== undefined) merged.label = part.label;
  }
  console.log(JSON.stringify(merged));
  const decoded = await Promise.all(features.flatMap((f) => (f.decode ? [f.decode(new Uint8Array([1, 2, 3]))] : [])));
  console.log(decoded.map((d) => (d ? Array.from(d).join(",") : "none")).join(" "));
}
void main();
