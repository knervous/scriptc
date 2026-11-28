// The intrinsic libraries from the installed package: each subpath imported and used once.
import { popcnt, rotl, mulWrap64, addSat } from "scriptw/int";
import type { Int32, Uint8 } from "scriptw/int";
import { sin, pow } from "scriptw/math";
import { layout, RecordView } from "scriptw/layout";
import { f16round, F16_PATH } from "scriptw/f16";
import { AtomicInt32 } from "scriptw/atomics";
import { f32x4 } from "scriptw/simd";

class Px { r: Uint8 = 0; constructor(v: number) { this.r = v & 0xff; } }
let h: Int32 = 0;
for (let i: Int32 = 0; i < 1000; i++) h = rotl(h ^ popcnt(i * 2654435761), 5);
const L = layout("P", [{ name: "x", type: "f32" }, { name: "id", type: "u16" }]);
const v = new RecordView(new Uint8Array(L.stride * 4), L.stride);
v.setF32(3, 0, 2.5); v.setU16(3, 4, 513);
const a = new AtomicInt32(new Int32Array(1));
a.add(41);
console.log(h, addSat(0x7fffffff, 5), mulWrap64(0xffffffffffffffffn, 3n), sin(1), pow(2, 0.5), f16round(0.1), v.f32(3, 0), v.u16(3, 4), a.load(), new Px(300).r, f32x4.extract_lane(f32x4.splat(1.5), 2));
console.error(F16_PATH === "engine" || F16_PATH === "software" ? "f16 ok" : "f16 ?");
