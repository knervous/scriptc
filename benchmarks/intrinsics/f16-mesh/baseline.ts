// Vertex data packing: a 160000-vertex mesh (position, normal, uv: 8 floats) packed to binary16 for a GPU upload,
// halving its size, and unpacked again, four times. Reports the size, the largest position error and a checksum of
// the packed bits. This version uses the engine's Float16Array (no scriptc lowering: the compiled lanes refuse it).
// Original code, Apache-2.0.
import { Lcg, fnv1a } from "../common/input.ts";

const V = 160000, F = 8;
const rng = new Lcg(21);
const mesh = new Float32Array(V * F);
for (let v = 0; v < V; v++) {
  const a = rng.unit() * 6.283185307179586, b = rng.unit() * 3.141592653589793, r = 10 + rng.unit() * 0.5;
  const nx = Math.cos(a) * Math.sin(b), ny = Math.cos(b), nz = Math.sin(a) * Math.sin(b);
  mesh.set([nx * r, ny * r, nz * r, nx, ny, nz, a / 6.283185307179586, b / 3.141592653589793], v * F);
}
const packed = new Uint16Array(V * F);
const half = new Float16Array(packed.buffer);
const back = new Float32Array(V * F);
const t0 = performance.now();
for (let r = 0; r < 4; r++) {
  for (let i = 0; i < mesh.length; i++) half[i] = mesh[i]!;
  for (let i = 0; i < mesh.length; i++) back[i] = half[i]!;
}
const ms = performance.now() - t0;
let err = 0;
for (let v = 0; v < V; v++) for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(back[v * F + k]! - mesh[v * F + k]!));
console.log("bytes", mesh.byteLength, "->", packed.byteLength, "max position error", err, "packed", fnv1a(new Uint8Array(packed.buffer)));
console.log(`time ${ms.toFixed(1)}`);
