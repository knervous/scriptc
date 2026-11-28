// The f16, layout and atomics intrinsic libraries on one thread: binary16
// conversion over every pattern and tie, a fixed-layout record array read and
// written in place, and atomic cells, claims and a spin lock. Node, WasmGC and
// native must agree.
import { toF16Bits, fromF16Bits, f16round, packF16, unpackF16, getFloat16, setFloat16 } from "../../packages/intrinsics/f16.ts";
import { layout, RecordView, cStruct, wgslStruct } from "../../packages/intrinsics/layout.ts";
import { AtomicInt32, AtomicUint32, WorkCounter, SpinLock } from "../../packages/intrinsics/atomics.ts";

// f16: every pattern back and forth, and the midpoints between neighbours.
let h = 0;
for (let b = 0; b < 65536; b++) {
  const v = fromF16Bits(b);
  const back = toF16Bits(v);
  h = Math.imul(h ^ back, 16777619);
  if (v === v && b < 0x7c00) h = Math.imul(h ^ toF16Bits((v + fromF16Bits(b + 1)) / 2), 16777619);
}
console.log("f16 patterns", h >>> 0, f16round(0.1), f16round(65519), f16round(65520), toF16Bits(NaN), toF16Bits(-0), fromF16Bits(0x3555));
const src = new Float32Array([0.5, -1.25, 3.14159, 1e-5, 70000, 2.5e-8]);
const packed = new Uint16Array(src.length), unpacked = new Float32Array(src.length);
packF16(src, packed); unpackF16(packed, unpacked);
const dv = new DataView(new ArrayBuffer(4));
setFloat16(dv, 0, 1.337, true); setFloat16(dv, 2, -2.71828);
console.log("f16 pack", Array.from(packed).join(","), Array.from(unpacked).join(","), getFloat16(dv, 0, true), getFloat16(dv, 2));

// layout: 1000 particles in one buffer, updated in place.
const P = layout("Particle", [{ name: "x", type: "f32" }, { name: "y", type: "f32" }, { name: "vx", type: "f32" }, { name: "vy", type: "f32" }, { name: "id", type: "u16" }, { name: "flags", type: "u8" }, { name: "life", type: "i8" }]);
const X = P.fields[0]!.offset, Y = P.fields[1]!.offset, VX = P.fields[2]!.offset, VY = P.fields[3]!.offset, ID = P.fields[4]!.offset, FL = P.fields[5]!.offset, LIFE = P.fields[6]!.offset;
const backing = new Uint8Array(P.stride * 1000 + 8);
const ps = new RecordView(backing.subarray(8), P.stride, 1000);
for (let i = 0; i < ps.length; i++) {
  ps.setF32(i, X, i * 0.5); ps.setF32(i, Y, -i); ps.setF32(i, VX, (i % 7) - 3); ps.setF32(i, VY, 0.25);
  ps.setU16(i, ID, i * 37); ps.setU8(i, FL, i & 0xff); ps.setI8(i, LIFE, (i % 200) - 100);
}
for (let step = 0; step < 10; step++)
  for (let i = 0; i < ps.length; i++) { ps.setF32(i, X, ps.f32(i, X) + ps.f32(i, VX)); ps.setF32(i, Y, ps.f32(i, Y) + ps.f32(i, VY)); }
let lh = 0;
const bytes = backing;
for (let i = 0; i < bytes.length; i++) lh = Math.imul(lh ^ bytes[i]!, 16777619);
console.log("layout", P.size, P.align, P.stride, lh >>> 0, ps.f32(999, X), ps.u16(999, ID), ps.i8(999, LIFE));
console.log(cStruct(P).split("\n").length, wgslStruct(layout("V", [{ name: "pos", type: "f32", count: 3 }, { name: "w", type: "u32" }], { align: 16 })).trim().split("\n").join(" "));

// atomics, one thread: the same operations a worker set would run.
const cells = new Int32Array(8), ucells = new Uint32Array(2);
const a = new AtomicInt32(cells, 1), u = new AtomicUint32(ucells, 0);
console.log("atomics", a.add(5), a.sub(2), a.or(0x10), a.and(0x1f), a.xor(1), a.exchange(-7), a.compareExchange(-7, 42), a.compareExchange(0, 1), a.load(), a.notify());
console.log(u.store(0xffffffff), u.add(2), u.load(), u.compareExchange(1, 9), u.load());
const work = new WorkCounter(cells, 2, 5), lock = new SpinLock(cells, 3);
const claimed: number[] = [];
for (let j = work.claim(); j >= 0; j = work.claim()) { lock.lock(); claimed.push(j); lock.unlock(); }
console.log(claimed.join(","), work.claim(), lock.tryLock(), lock.tryLock(), cells.join(","));
