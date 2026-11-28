// Vertex data packing: a 160000-vertex mesh (position, normal, uv: 8 floats) packed to binary16 for a GPU upload,
// halving its size, and unpacked again, four times. Reports the size, the largest position error and a checksum of
// the packed bits. This version uses the f16 intrinsic library's packF16/unpackF16 (WasmGC: conversion in wasm at
// load and store; native: the runtime's binary16 conversion; plain JavaScript: its software conversion here).
// Original code, Apache-2.0.
import { packF16, unpackF16 } from "../../../packages/intrinsics/f16.ts";
import { Lcg, fnv1a } from "../common/input.ts";

const V = 160000, F = 8;
const rng = new Lcg(21);
const mesh = new Float32Array(V * F);
for (let v = 0; v < V; v++) {
  const a = rng.unit() * 6.283185307179586, b = rng.unit() * 3.141592653589793, r = 10 + rng.unit() * 0.5;
  const nx = Math.cos(a) * Math.sin(b), ny = Math.cos(b), nz = Math.sin(a) * Math.sin(b);
  const at = v * F;
  mesh[at] = nx * r; mesh[at + 1] = ny * r; mesh[at + 2] = nz * r; mesh[at + 3] = nx; mesh[at + 4] = ny; mesh[at + 5] = nz;
  mesh[at + 6] = a / 6.283185307179586; mesh[at + 7] = b / 3.141592653589793;
}
const packed = new Uint16Array(V * F);
const back = new Float32Array(V * F);
const t0 = performance.now();
for (let r = 0; r < 4; r++) {
  packF16(mesh, packed);
  unpackF16(packed, back);
}
const ms = performance.now() - t0;
let err = 0;
for (let v = 0; v < V; v++) for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(back[v * F + k]! - mesh[v * F + k]!));
console.log("bytes", mesh.byteLength, "->", packed.byteLength, "max position error", err, "packed", fnv1a(new Uint8Array(packed.buffer)));
console.log(`time ${ms.toFixed(1)}`);
