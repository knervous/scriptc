// The scene benchmark's three.js app: N boxes sharing one geometry and material, every transform animated each frame,
// then the world matrices updated and the scene rendered (three.js culls against the camera frustum as it renders).
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three";

let renderer: WebGLRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
const meshes: Mesh[] = [];

/** Builds the scene on the canvas: `n` boxes on a grid, half of them outside the camera's view. */
export function setup(canvas: HTMLCanvasElement, n: number): void {
  renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(canvas.width, canvas.height, false);
  scene = new Scene();
  camera = new PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 500);
  camera.position.set(0, 0, 60);
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial({ color: 0x3366ff });
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set((i % side) * 2 - side, Math.floor(i / side) * 2 - side, 0);
    scene.add(mesh);
    meshes.push(mesh);
  }
}

/** One frame at time `t`: animates every mesh, updates the world matrices and renders. Answers a checksum. */
export function frame(t: number): number {
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]!;
    mesh.rotation.x = t * 0.001 + i * 0.01;
    mesh.rotation.y = t * 0.002 + i * 0.01;
    mesh.position.z = Math.sin(t * 0.001 + i) * 5;
  }
  scene!.updateMatrixWorld();
  renderer!.render(scene!, camera!);
  return renderer!.info.render.calls + Math.round(meshes[meshes.length - 1]!.matrixWorld.elements[12]! * 1000) / 1000;
}
