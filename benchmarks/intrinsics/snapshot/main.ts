// A world-snapshot delta codec, as a networked simulation sends it: 2000 entities (position, velocity, health, flags),
// 300 ticks. Each tick changes some entities; the encoder writes, per changed entity, its index, a change mask and the
// changed fields into a packet; the decoder applies packets to a mirror, which must equal the world at the end.
// This version keeps the world, the last sent state and the mirror as fixed-layout records in three byte buffers,
// through the view class the layout intrinsic library generates (entity.gen.ts, from gen.mjs). Original code, Apache-2.0.
import { EntityView, ENTITY_STRIDE } from "./entity.gen.ts";
import { Lcg, fnv1a } from "../common/input.ts";

const N = 2000, TICKS = 300;
const records = (): EntityView => new EntityView(new Uint8Array(N * ENTITY_STRIDE), N);
const world = records(), prev = records(), mirror = records();
const rng = new Lcg(5);
for (let i = 0; i < N; i++) { world.setX(i, rng.unit() * 1000); world.setY(i, rng.unit() * 1000); world.setHp(i, 100); }
for (let i = 0; i < N; i++) { prev.setHp(i, 100); mirror.setHp(i, 100); }
const packetBytes = new Uint8Array(N * 32 + 16);
const packet = new DataView(packetBytes.buffer);
let totalBytes = 0, packets = 0;

function simulate(): void {
  for (let k = 0; k < 200; k++) {
    const i = rng.below(N);
    world.setVx(i, world.getVx(i) + (rng.unit() - 0.5)); world.setVy(i, world.getVy(i) + (rng.unit() - 0.5));
    world.setX(i, world.getX(i) + world.getVx(i)); world.setY(i, world.getY(i) + world.getVy(i));
    if (rng.below(4) === 0) world.setHp(i, (world.getHp(i) + rng.below(21) - 10) & 0xff);
    if (rng.below(8) === 0) world.setFlags(i, world.getFlags(i) ^ (1 << rng.below(8)));
  }
}
function encode(): number {
  let p = 2, count = 0;
  for (let i = 0; i < N; i++) {
    const x = world.getX(i), y = world.getY(i), vx = world.getVx(i), vy = world.getVy(i), hp = world.getHp(i), flags = world.getFlags(i);
    const mask = (x !== prev.getX(i) || y !== prev.getY(i) ? 1 : 0) | (vx !== prev.getVx(i) || vy !== prev.getVy(i) ? 2 : 0)
      | (hp !== prev.getHp(i) ? 4 : 0) | (flags !== prev.getFlags(i) ? 8 : 0);
    if (mask === 0) continue;
    packet.setUint16(p, i, true); packet.setUint8(p + 2, mask); p += 3;
    if (mask & 1) { packet.setFloat32(p, x, true); packet.setFloat32(p + 4, y, true); p += 8; prev.setX(i, x); prev.setY(i, y); }
    if (mask & 2) { packet.setFloat32(p, vx, true); packet.setFloat32(p + 4, vy, true); p += 8; prev.setVx(i, vx); prev.setVy(i, vy); }
    if (mask & 4) { packet.setUint8(p, hp); p += 1; prev.setHp(i, hp); }
    if (mask & 8) { packet.setUint8(p, flags); p += 1; prev.setFlags(i, flags); }
    count++;
  }
  packet.setUint16(0, count, true);
  return p;
}
function decode(size: number): void {
  const count = packet.getUint16(0, true);
  let p = 2;
  for (let c = 0; c < count; c++) {
    const i = packet.getUint16(p, true), mask = packet.getUint8(p + 2);
    p += 3;
    if (mask & 1) { mirror.setX(i, packet.getFloat32(p, true)); mirror.setY(i, packet.getFloat32(p + 4, true)); p += 8; }
    if (mask & 2) { mirror.setVx(i, packet.getFloat32(p, true)); mirror.setVy(i, packet.getFloat32(p + 4, true)); p += 8; }
    if (mask & 4) { mirror.setHp(i, packet.getUint8(p)); p += 1; }
    if (mask & 8) { mirror.setFlags(i, packet.getUint8(p)); p += 1; }
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
  h = Math.imul(h ^ fnv1a(packetBytes, size), 16777619);
}
const ms = performance.now() - t0;
let same = true;
for (let i = 0; i < N; i++)
  if (world.getX(i) !== mirror.getX(i) || world.getY(i) !== mirror.getY(i) || world.getVx(i) !== mirror.getVx(i) || world.getVy(i) !== mirror.getVy(i)
    || world.getHp(i) !== mirror.getHp(i) || world.getFlags(i) !== mirror.getFlags(i)) same = false;
console.log("packets", packets, "bytes", totalBytes, "per packet", Math.round(totalBytes / packets), "hash", h >>> 0, "mirror", same ? "equal" : "DIFFERS");
console.log(`time ${ms.toFixed(1)}`);
