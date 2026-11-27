// @expect: free 3
// @expect: orbit 3
// @expect: node 1
// A union of classes flowing into a union holding their ancestors: each
// source arm upcasts to the destination's ancestor arm.
class SceneNode { name: string; constructor(name: string) { this.name = name; } id(): number { return 1; } }
class CameraNode extends SceneNode { id(): number { return 2; } }
class FreeCamera extends CameraNode { id(): number { return 3; } }
class OrbitCamera extends CameraNode { id(): number { return 3; } }
type Camera = FreeCamera | OrbitCamera;
type Provider = CameraNode | SceneNode | null;
function asProvider(cam: Camera): Provider { return cam; }
const list: Provider[] = [asProvider(new FreeCamera("free")), asProvider(new OrbitCamera("orbit")), new SceneNode("node"), null];
for (const p of list) if (p) console.log(p.name, p.id() === 1 ? 1 : 3);
