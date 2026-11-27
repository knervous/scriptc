// `x[i] ?? d` on a typed array or a number[] read as the element's f64 form, with no union box (10-29: the seam's
// SeamReader.u32 and Matrix.equals boxed every read). Past the end, at a hole, or at a non-index the read is JS's
// undefined and takes the default; NaN and -0 are numbers and are kept; the default runs only when it is taken, and
// the receiver and index evaluate once, in order.
const order: string[] = [];
class Reader {
  private readonly u32s: Uint32Array;
  constructor(bytes: Uint8Array) { this.u32s = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2); }
  u32(at: number): number { return this.u32s[at >> 2] ?? 0; }
}
const bytes = new Uint8Array(16);
new Uint32Array(bytes.buffer)[1] = 0xdeadbeef;
const r = new Reader(bytes);
console.log("reader", r.u32(4), r.u32(0), r.u32(64), r.u32(-4));
const f64s = new Float64Array([NaN, -0, 2.5]);
const pick = (label: string, v: number) => { order.push(label); return v; };
const recv = () => { order.push("recv"); return f64s; };
console.log("f64", f64s[0] ?? 7, Object.is(f64s[1] ?? 7, -0), f64s[2] ?? 7, f64s[3] ?? 7, f64s[1.5] ?? 7);
console.log("lazy", recv()[pick("index", 2)] ?? pick("default", 9), recv()[pick("index", 5)] ?? pick("default", 9), order.join(" "));
const nums: number[] = [1, NaN];
nums[3] = 4;
console.log("number[]", nums[0] ?? -1, nums[1] ?? -1, nums[2] ?? -1, nums[3] ?? -1, nums[9] ?? -1);
const dense = [1, 2, 3];
let sum = 0;
for (let i = 0; i < 6; i++) sum += (bytes[i + 2] ?? 100) + (dense[i] ?? 0.5);
console.log("loop", sum);
