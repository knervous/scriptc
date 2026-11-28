// A particle system feeding a GPU vertex buffer: 20000 particles, 120 frames. Each frame moves the particles and
// writes the 32-byte vertex records (position, velocity, packed colour, size, life) a WebGPU or WebGL upload takes.
// This version keeps particles as objects and serializes them into the upload buffer with DataView every frame.
// Original code, Apache-2.0.
import { Lcg, fnv1a } from "../common/input.ts";

class Particle { x = 0; y = 0; vx = 0; vy = 0; rgba = 0; size = 1; life = 0; }
const N = 20000, FRAMES = 120, STRIDE = 32;
const rng = new Lcg(9);
const ps: Particle[] = [];
for (let i = 0; i < N; i++) {
  const p = new Particle();
  // Every field holds what its f32 vertex slot would.
  p.x = Math.fround(rng.unit() * 800); p.y = Math.fround(rng.unit() * 600); p.vx = Math.fround(rng.unit() - 0.5); p.vy = Math.fround(rng.unit() * -2);
  p.life = Math.fround(rng.unit() * 4); p.rgba = (rng.next() & 0xffffff00) | 0xff; p.size = Math.fround(1 + rng.unit() * 3); ps.push(p);
}
const upload = new Uint8Array(N * STRIDE);
const view = new DataView(upload.buffer);
let h = 0;
const t0 = performance.now();
for (let f = 0; f < FRAMES; f++) {
  for (let i = 0; i < N; i++) {
    const p = ps[i]!;
    p.vy = Math.fround(p.vy + 0.05); p.x = Math.fround(p.x + p.vx); p.y = Math.fround(p.y + p.vy); p.life = Math.fround(p.life - 1 / 60);
    if (p.life < 0 || p.y > 600) { p.y = 0; p.vy = Math.fround(-2 * (i % 7) / 7); p.life = 4; }
    p.size = Math.fround(1 + p.life * 0.5);
    const at = i * STRIDE;
    view.setFloat32(at, p.x, true); view.setFloat32(at + 4, p.y, true); view.setFloat32(at + 8, p.vx, true); view.setFloat32(at + 12, p.vy, true);
    view.setUint32(at + 16, p.rgba >>> 0, true); view.setFloat32(at + 20, p.size, true); view.setFloat32(at + 24, p.life, true);
  }
  if (f % 30 === 29) h = Math.imul(h ^ fnv1a(upload), 16777619);
}
const ms = performance.now() - t0;
console.log("vertex bytes", upload.length, "frames", FRAMES, "hash", h >>> 0);
console.log(`time ${ms.toFixed(1)}`);
