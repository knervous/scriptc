// A 2D rigid-body step: 320 spinning discs under gravity and a swirl field, wall and pairwise collisions with
// restitution and friction, 400 frames. The state's bits are hashed every 100 frames, so any difference in any
// double shows. This version calls Math. Original code, Apache-2.0.
import { Lcg } from "../common/input.ts";

// helpers:begin
function sin(v: number): number { return Math.sin(v); }
function cos(v: number): number { return Math.cos(v); }
function atan2(a: number, b: number): number { return Math.atan2(a, b); }
function exp(v: number): number { return Math.exp(v); }
function sqrt(v: number): number { return Math.sqrt(v); }
function pow(a: number, b: number): number { return Math.pow(a, b); }
// helpers:end

const N = 320, W = 100, H = 100, DT = 1 / 120;
const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
const angle = new Float64Array(N), spin = new Float64Array(N), radius = new Float64Array(N);
const rng = new Lcg(11);
for (let i = 0; i < N; i++) {
  radius[i] = 0.8 + rng.unit() * 1.6; x[i] = 5 + rng.unit() * (W - 10); y[i] = 5 + rng.unit() * (H - 10);
  vx[i] = (rng.unit() - 0.5) * 20; vy[i] = (rng.unit() - 0.5) * 20; angle[i] = rng.unit() * 6.283185307179586; spin[i] = (rng.unit() - 0.5) * 4;
}
const bits = new DataView(new ArrayBuffer(8));
let h = 0x811c9dc5 | 0;
const mix = (v: number): void => { bits.setFloat64(0, v, true); h = Math.imul(h ^ bits.getInt32(0, true), 16777619); h = Math.imul(h ^ bits.getInt32(4, true), 16777619); };
const hashes: string[] = [];

function step(t: number): void {
  for (let i = 0; i < N; i++) {
    // Swirl around the centre and drag that decays with speed.
    const dx = x[i]! - W / 2, dy = y[i]! - H / 2;
    const theta = atan2(dy, dx), r = sqrt(dx * dx + dy * dy);
    const swirl = 3 * sin(t * 0.7 + r * 0.05);
    vx[i] = vx[i]! - sin(theta) * swirl * DT;
    vy[i] = vy[i]! + cos(theta) * swirl * DT - 9.81 * DT;
    const drag = exp(-0.02 * DT * pow(vx[i]! * vx[i]! + vy[i]! * vy[i]! + 1, 0.25));
    vx[i] = vx[i]! * drag; vy[i] = vy[i]! * drag;
    x[i] = x[i]! + vx[i]! * DT; y[i] = y[i]! + vy[i]! * DT;
    angle[i] = angle[i]! + spin[i]! * DT;
    const rr = radius[i]!;
    if (x[i]! < rr) { x[i] = rr; vx[i] = -vx[i]! * 0.8; } else if (x[i]! > W - rr) { x[i] = W - rr; vx[i] = -vx[i]! * 0.8; }
    if (y[i]! < rr) { y[i] = rr; vy[i] = -vy[i]! * 0.8; spin[i] = spin[i]! * 0.95 + vx[i]! * 0.01; } else if (y[i]! > H - rr) { y[i] = H - rr; vy[i] = -vy[i]! * 0.8; }
  }
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const dx = x[j]! - x[i]!, dy = y[j]! - y[i]!, min = radius[i]! + radius[j]!;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = sqrt(d2), nx = dx / d, ny = dy / d, overlap = (min - d) / 2;
      x[i] = x[i]! - nx * overlap; y[i] = y[i]! - ny * overlap; x[j] = x[j]! + nx * overlap; y[j] = y[j]! + ny * overlap;
      const rel = (vx[j]! - vx[i]!) * nx + (vy[j]! - vy[i]!) * ny;
      if (rel < 0) {
        const imp = -1.6 * rel / 2;
        vx[i] = vx[i]! - imp * nx; vy[i] = vy[i]! - imp * ny; vx[j] = vx[j]! + imp * nx; vy[j] = vy[j]! + imp * ny;
        // Friction turns the tangential speed into spin, through the contact angle.
        const tangent = atan2(-nx, ny), kick = 0.05 * rel * cos(tangent - angle[i]!);
        spin[i] = spin[i]! + kick; spin[j] = spin[j]! - kick;
      }
    }
}

const t0 = performance.now();
for (let f = 0; f < 400; f++) {
  step(f * DT);
  if ((f + 1) % 100 === 0) {
    for (let i = 0; i < N; i++) { mix(x[i]!); mix(y[i]!); mix(vx[i]!); mix(vy[i]!); mix(angle[i]!); mix(spin[i]!); }
    hashes.push((h >>> 0).toString(16));
  }
}
const ms = performance.now() - t0;
console.log("state hashes", hashes.join(" "));
console.log("body 0", x[0], y[0], angle[0]);
console.log(`time ${ms.toFixed(1)}`);
