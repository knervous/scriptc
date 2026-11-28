// The scene benchmark's Babylon Lite app: N boxes, every transform animated each frame, then one frame rendered
// (`renderFrame`: world matrices, frustum culling and the draw, on WebGPU).
import { addToScene, createBox, createEngine, createFreeCamera, createSceneContext, registerScene, renderFrame, vec3, type EngineContext, type Mesh } from "@babylonjs/lite";

let engine: EngineContext | null = null;
const meshes: Mesh[] = [];

/** Builds the scene on the canvas: `n` boxes on a grid, half of them outside the camera's view. */
export async function setup(canvas: HTMLCanvasElement, n: number): Promise<void> {
  const e = await createEngine(canvas);
  engine = e;
  const scene = createSceneContext(e);
  addToScene(scene, createFreeCamera(vec3(0, 0, -60), vec3(0, 0, 0)));
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const mesh = createBox(e, 1);
    mesh.position.set((i % side) * 2 - side, Math.floor(i / side) * 2 - side, 0);
    addToScene(scene, mesh);
    meshes.push(mesh);
  }
  await registerScene(scene);
}

/** One frame at time `t`: animates every mesh and renders. Answers a checksum. */
export function frame(t: number): number {
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]!;
    mesh.rotation.x = t * 0.001 + i * 0.01;
    mesh.rotation.y = t * 0.002 + i * 0.01;
    mesh.position.z = Math.sin(t * 0.001 + i) * 5;
  }
  renderFrame(engine!, 16);
  const last = meshes[meshes.length - 1]!;
  return meshes.length + Math.round(last.worldMatrix[12]! * 1000) / 1000;
}
