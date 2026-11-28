// The scene benchmark's Babylon.js app: one box and N - 1 instances of it, every transform animated each frame, then
// the scene rendered (`scene.render()`: world matrices, frustum culling and the draw, on WebGL2).
import { Engine, FreeCamera, MeshBuilder, Scene, Vector3, type AbstractMesh } from "@babylonjs/core";

let engine: Engine | null = null;
let scene: Scene | null = null;
const meshes: AbstractMesh[] = [];

/** Builds the scene on the canvas: `n` boxes on a grid, half of them outside the camera's view. */
export function setup(canvas: HTMLCanvasElement, n: number): void {
  engine = new Engine(canvas, false);
  scene = new Scene(engine);
  const camera = new FreeCamera("camera", new Vector3(0, 0, -60), scene);
  camera.setTarget(Vector3.Zero());
  const box = MeshBuilder.CreateBox("box", { size: 1 }, scene);
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const mesh = i === 0 ? box : box.createInstance(`box${i}`);
    mesh.position.set((i % side) * 2 - side, Math.floor(i / side) * 2 - side, 0);
    meshes.push(mesh);
  }
}

/** One frame at time `t`: animates every mesh and renders. Answers a checksum. */
export function frame(t: number): number {
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]!;
    mesh.rotation.x = t * 0.001 + i * 0.01;
    mesh.rotation.y = t * 0.002 + i * 0.01;
    mesh.position.z = Math.sin(t * 0.001 + i) * 5;
  }
  scene!.render();
  const last = meshes[meshes.length - 1]!;
  return meshes.length + Math.round(last.getWorldMatrix().m[12]! * 1000) / 1000;
}
