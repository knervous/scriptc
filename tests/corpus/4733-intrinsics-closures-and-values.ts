// Intrinsic library members inside closures and used as function values, mixed with direct calls of the same
// members in the same module. A member used as a value has widened parameters, so its direct calls pass wrapped
// arguments: each lowered call must still give the library's result, and a call that cannot lower runs the
// member's own body. Node, WasmGC and native must agree.
import { sin, cos, atan2, pow, exp } from "../../packages/intrinsics/math.ts";
import { popcnt, clz, rotl, mulWrap, addSat, toInt8, mulWrap64, rotl64, popcnt64 } from "../../packages/intrinsics/int.ts";
import { toF16Bits, fromF16Bits, f16round } from "../../packages/intrinsics/f16.ts";
import { layout, RecordView } from "../../packages/intrinsics/layout.ts";
import { AtomicInt32 } from "../../packages/intrinsics/atomics.ts";

const xs: number[] = [0, 0.5, 1, -2.25, 1e-3, 300.75];

// The release session's repros.
console.log(xs.map((x) => sin(x)).join(" "));
console.log(xs.map((x: number): number => sin(x)).join(" "));
console.log(xs.map((x) => popcnt(x)).join(" "));
let acc = 0;
console.log(xs.map(sin).join(" "));
for (let i = 0; i < 2000; i++) acc += sin(i * 0.37);
console.log(acc);

// math: callbacks, values, two-argument members, and direct calls beside them.
const angles = xs.map((x, i) => atan2(x, i + 1));
console.log(angles.join(" "), xs.map(cos).join(" "), xs.map((x) => pow(Math.abs(x), 1.5)).join(" "));
// (A member both passed to .map and stored in an array of functions hits a WasmGC limit that any imported function
// does: SC3002 "method-style closure call". Here the array holds members .map does not take.)
const unary: ((x: number) => number)[] = [exp, (x: number) => pow(x, 2)];
console.log(unary.map((f) => f(0.25)).join(" "), cos(0.25), exp(-1));
let wave = 0;
for (let i = 0; i < 500; i++) wave += cos(i * 0.01) * exp(-i * 0.001);
console.log(wave);

// int: 32- and 64-bit members as callbacks and values, and direct.
const ints = [0, 1, 255, -1, 0x7fffffff, 12345678];
console.log(ints.map(popcnt).join(" "), ints.map(clz).join(" "), ints.map((v) => rotl(v, 7)).join(" "));
console.log(ints.map((v, i) => mulWrap(v, i * 2654435761)).join(" "), ints.map((v) => addSat(v, 0x7fff0000)).join(" "), ints.map(toInt8).join(" "));
let h = 0;
for (let i = 0; i < 1000; i++) h = rotl(h ^ popcnt(i), 5);
console.log(h, popcnt(0xff), clz(1));
const big: bigint[] = [0n, 1n, 0xdeadbeefcafebaben, -1n];
// 64-bit members over a bigint array: a loop, because a bigint compare in any function a .map callback reaches is
// outside the frontend today (SC1043, with or without the library).
const out64: string[] = [];
for (const b of big) out64.push(`${mulWrap64(b, 0x9e3779b97f4a7c15n).toString(16)}/${rotl64(b, 13).toString(16)}/${popcnt64(b)}`);
console.log(out64.join(" "));
let hb = 1n;
for (let i = 0; i < 50; i++) hb = mulWrap64(rotl64(hb, 31), 0x9e3779b97f4a7c15n);
console.log(hb, popcnt64(hb));

// f16: callbacks, values and direct.
console.log(xs.map(toF16Bits).join(" "), xs.map((x) => fromF16Bits(toF16Bits(x))).join(" "), xs.map(f16round).join(" "));
let hs = 0;
for (let b = 0; b < 4096; b++) hs = (hs + toF16Bits(fromF16Bits(b) * 1.5)) | 0;
console.log(hs, f16round(0.1));

// layout and atomics inside closures.
const L = layout("P", [{ name: "x", type: "f32" }, { name: "id", type: "u16" }]);
const view = new RecordView(new Uint8Array(L.stride * 4), L.stride);
[1.5, 2.5, 3.5, 4.5].forEach((v, i) => { view.setF32(i, 0, v); view.setU16(i, 4, i * 100); });
console.log([0, 1, 2, 3].map((i) => view.f32(i, 0) + view.u16(i, 4)).join(" "));
const cell = new AtomicInt32(new Int32Array(1));
[5, 6, 7].forEach((v) => cell.add(v));
console.log(cell.load(), [1, 2].map((v) => cell.compareExchange(cell.load(), v)).join(" "), cell.load());
