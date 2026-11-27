// Element stores into `number[] | Float32Array` (Babylon's FloatArray):
// in-range writes, a plain array growing past its length, a typed array
// ignoring an out-of-range write, f32 rounding, and receiver/key/value
// evaluated once each, in order.
type FloatArray = number[] | Float32Array;
function toArray(out: FloatArray, at: number, x: number): void {
  out[at] = x;
  out[at + 1] = x / 3;
}
const plain: number[] = [9];
const typed = new Float32Array(3);
toArray(plain, 2, 1);
toArray(typed, 1, 1);
toArray(typed, 2, 5);
console.log(plain.length, JSON.stringify(plain), Array.from(typed).join(","));
const log: string[] = [];
const pick = (f: FloatArray): FloatArray => (log.push("recv"), f);
const key = (k: number): number => (log.push("key"), k);
const val = (v: number): number => (log.push("val"), v);
pick(typed)[key(0)] = val(0.1);
pick(plain)[key(0)] = val(0.1);
console.log(log.join(" "), typed[0], plain[0]);
