// Fixed-width integer contracts on class fields: Uint8/Int8/Uint16/Int16 fields
// are stored packed (WasmGC i8/i16 struct fields), Int32/Uint32 fields in 32 bits.
// Every write is proven in range by construction (masks, shifts, int intrinsics).
import { toInt8, toUint16 } from "../../packages/intrinsics/int.ts";
import type { Int8, Uint8, Int16, Uint16, Int32, Uint32 } from "../../packages/intrinsics/int.ts";
class Pixel { r: Uint8 = 0; g: Uint8 = 0; b: Uint8 = 0; a: Uint8 = 255; d: Int8 = 0; w: Uint16 = 0; s: Int16 = 0; n: Int32 = 0; u: Uint32 = 0; label = "px";
  set(v: number): void { this.r = v & 0xff; this.g = (v >>> 8) & 0xff; this.b = (v >>> 16) & 0xff; this.d = toInt8(v); this.w = toUint16(v); this.s = (v << 16) >> 16; this.n = v | 0; this.u = v >>> 0; }
}
class Big extends Pixel { extra: Uint8 = 7; }
const ps: Pixel[] = [];
for (let i = 0; i < 6; i++) { const p = i % 2 ? new Big() : new Pixel(); p.set(i * 0x9e3779b1); p.a = (p.a - 1) & 0xff; p.n = (p.n + 1) | 0; ps.push(p); }
let sum = 0;
for (const p of ps) sum += p.r + p.g + p.b + p.a + p.d + p.w + p.s + p.n + p.u;
console.log(sum);
const q = ps[3]!; console.log(q.r, q.g, q.b, q.a, q.d, q.w, q.s, q.n, q.u, q.label);
