// A world-snapshot delta codec, as a networked simulation sends it: 2000 entities (position, velocity, health, flags),
// 300 ticks. Each tick changes some entities; the encoder writes, per changed entity, its index, a change mask and the
// changed fields into a packet; the decoder applies packets to a mirror, which must equal the world at the end.
// This version keeps entities as objects and writes packets with DataView. Original code, Apache-2.0.
import { Lcg, fnv1a } from "../common/input.ts";

class Entity { x = 0; y = 0; vx = 0; vy = 0; hp = 100; flags = 0; }
const N = 2000, TICKS = 300;
const world: Entity[] = [], prev: Entity[] = [], mirror: Entity[] = [];
for (let i = 0; i < N; i++) { world.push(new Entity()); prev.push(new Entity()); mirror.push(new Entity()); }
const rng = new Lcg(5);
for (const e of world) { e.x = Math.fround(rng.unit() * 1000); e.y = Math.fround(rng.unit() * 1000); }
const f32 = Math.fround;
const packet = new DataView(new ArrayBuffer(N * 32 + 16));
let totalBytes = 0, packets = 0;

function simulate(): void {
  for (let k = 0; k < 200; k++) {
    const e = world[rng.below(N)]!;
    e.vx = f32(e.vx + (rng.unit() - 0.5)); e.vy = f32(e.vy + (rng.unit() - 0.5));
    e.x = f32(e.x + e.vx); e.y = f32(e.y + e.vy);
    if (rng.below(4) === 0) e.hp = (e.hp + rng.below(21) - 10) & 0xff;
    if (rng.below(8) === 0) e.flags ^= 1 << rng.below(8);
  }
}
function encode(): number {
  let p = 2, count = 0;
  for (let i = 0; i < N; i++) {
    const a = world[i]!, b = prev[i]!;
    const mask = (a.x !== b.x || a.y !== b.y ? 1 : 0) | (a.vx !== b.vx || a.vy !== b.vy ? 2 : 0) | (a.hp !== b.hp ? 4 : 0) | (a.flags !== b.flags ? 8 : 0);
    if (mask === 0) continue;
    packet.setUint16(p, i, true); packet.setUint8(p + 2, mask); p += 3;
    if (mask & 1) { packet.setFloat32(p, a.x, true); packet.setFloat32(p + 4, a.y, true); p += 8; b.x = a.x; b.y = a.y; }
    if (mask & 2) { packet.setFloat32(p, a.vx, true); packet.setFloat32(p + 4, a.vy, true); p += 8; b.vx = a.vx; b.vy = a.vy; }
    if (mask & 4) { packet.setUint8(p, a.hp); p += 1; b.hp = a.hp; }
    if (mask & 8) { packet.setUint8(p, a.flags); p += 1; b.flags = a.flags; }
    count++;
  }
  packet.setUint16(0, count, true);
  return p;
}
function decode(size: number): void {
  const count = packet.getUint16(0, true);
  let p = 2;
  for (let c = 0; c < count; c++) {
    const e = mirror[packet.getUint16(p, true)]!, mask = packet.getUint8(p + 2);
    p += 3;
    if (mask & 1) { e.x = packet.getFloat32(p, true); e.y = packet.getFloat32(p + 4, true); p += 8; }
    if (mask & 2) { e.vx = packet.getFloat32(p, true); e.vy = packet.getFloat32(p + 4, true); p += 8; }
    if (mask & 4) { e.hp = packet.getUint8(p); p += 1; }
    if (mask & 8) { e.flags = packet.getUint8(p); p += 1; }
  }
  if (p !== size) throw new Error("decode: size mismatch");
}

let h = 0;
const t0 = performance.now();
for (let t = 0; t < TICKS; t++) {
  simulate();
  const size = encode();
  decode(size);
  totalBytes += size; packets++;
  h = Math.imul(h ^ fnv1a(new Uint8Array(packet.buffer, 0, size)), 16777619);
}
const ms = performance.now() - t0;
let same = true;
for (let i = 0; i < N; i++) { const a = world[i]!, b = mirror[i]!; if (a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy || a.hp !== b.hp || a.flags !== b.flags) same = false; }
console.log("packets", packets, "bytes", totalBytes, "per packet", Math.round(totalBytes / packets), "hash", h >>> 0, "mirror", same ? "equal" : "DIFFERS");
console.log(`time ${ms.toFixed(1)}`);
