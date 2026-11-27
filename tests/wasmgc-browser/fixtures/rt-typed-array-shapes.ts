// Typed-array code shapes the runtime pass changed (agent RT, 10-28): a safe element read compared against a number
// (no union box: past the end it is undefined, strictly equal to no number), stores inlined at the site (integer kinds
// wrap through ToInt32, f32 rounds, out-of-range and non-index writes are ignored, receiver/index/value evaluate in
// order), and Math.abs canonicalizing an out-of-range read to NaN.
const order: string[] = [];
const bytes = new Uint8Array([10, 0, 255, 10, 7]);
function count(b: Uint8Array, v: number): number { let n = 0; for (let i = 0; i < b.length + 2; i++) if (b[i] === v) n++; return n; }
console.log("count", count(bytes, 10), count(bytes, 255), count(bytes, NaN));
const x = 3;
console.log("past end", bytes[9] === x, bytes[9] !== x, x === bytes[-1], bytes[1.5] === 0, bytes[1] === 0, bytes[1] === -0);
const f64s = new Float64Array([NaN, 0, -0, 1.5]);
console.log("f64", f64s[0] === f64s[0], f64s[1] === 0, f64s[2] === 0, f64s[3] === 1.5, f64s[4] === 1.5, f64s[4] !== 1.5);
const nums = [1, 2, 3];
console.log("number[]", nums[0] === 1, nums[5] === 1, nums[5] !== 1);

const i32 = new Int32Array(4), u8 = new Uint8Array(3), i16 = new Int16Array(2), u32 = new Uint32Array(2), f32 = new Float32Array(2), c8 = new Uint8ClampedArray(2);
let acc = 0;
for (let i = 0; i < 4; i++) { acc = (acc + i * 1000000000) | 0; i32[i] = acc; }
console.log("i32", Array.from(i32).join(","));
i32[0] = 2 ** 32 + 5; i32[1] = -1.9; i32[2] = NaN; i32[3] = Infinity;
console.log("i32 wrap", Array.from(i32).join(","));
u8[0] = 256 + 7; u8[1] = -1; u8[2] = 3.99;
i16[0] = 40000; i16[1] = -40000;
u32[0] = -1; u32[1] = 2 ** 33 + 1;
f32[0] = 0.1; f32[1] = 1e40;
c8[0] = 300; c8[1] = 1.5;
console.log("kinds", Array.from(u8).join(","), Array.from(i16).join(","), Array.from(u32).join(","), f32[0], f32[1], Array.from(c8).join(","));
i32[7] = 99; i32[-1] = 99; i32[1.5] = 99; u8[3] = 1;
console.log("ignored", Array.from(i32).join(","), u8.length, i32.length);
const pick = (label: string, v: number) => { order.push(label); return v; };
const target = () => { order.push("recv"); return i32; };
target()[pick("index", 2)] = pick("value", 42);
target()[pick("index", 9)] = pick("value", 43);
console.log("order", order.join(" "), i32[2]);

const halves = new Float32Array([-2.5, 4]);
console.log("abs", Math.abs(halves[0]!), Math.abs(halves[5]!), String(Math.abs(halves[5]!)), Math.abs(halves[5]!) === Math.abs(halves[5]!));
let undef = halves[9]!;
console.log("undefined read", undef === undefined, typeof undef, String(undef));
undef = Math.abs(undef);
console.log("abs of it", typeof undef, String(undef), Number.isNaN(undef));
// Truthiness of a safe element read: zero, NaN and past-the-end reads are falsy, as JS's undefined is.
const mask = new Uint8Array([0, 1, 2]), reals = new Float64Array([NaN, 0, 0.5]), plainNums = [0, NaN, 3];
const truthy: string[] = [];
for (let i = -1; i < 5; i++) truthy.push(`${mask[i] ? 1 : 0}${reals[i] ? 1 : 0}${plainNums[i] ? 1 : 0}${!mask[i] ? "!" : "."}`);
let filledCount = 0;
for (let i = 0; i < 4; i++) { if (mask[i]) filledCount++; if (mask[i] && reals[i]) filledCount += 10; }
console.log("truthy", truthy.join(" "), filledCount);
