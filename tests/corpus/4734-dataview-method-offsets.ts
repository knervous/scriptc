// A layout view's accessors (a DataView held in a class field, read and written by methods taking a record index):
// integer indices from loops and direct calls, and the offsets ToIndex treats specially — fractions, NaN, -0,
// negatives, offsets past the end and beyond int32 — through direct calls and a virtual call.
class Records {
  readonly view: DataView;
  constructor(bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  getX(i: number): number { return this.view.getFloat32(i * 8 + 0, true); }
  setX(i: number, v: number): void { this.view.setFloat32(i * 8 + 0, v, true); }
  getTag(i: number): number { return this.view.getUint8(i * 8 + 4); }
  setTag(i: number, v: number): void { this.view.setUint8(i * 8 + 4, v); }
  getWord(i: number): number { return this.view.getInt16(i * 8 + 6, true); }
}
class Shifted extends Records {
  getX(i: number): number { return this.view.getFloat32(i * 8 + 0, true) + 1000; }
}
const n = 16;
const r = new Records(new Uint8Array(n * 8));
for (let i = 0; i < n; i++) { r.setX(i, i * 1.5); r.setTag(i, (i * 37) & 255); }
let sum = 0;
for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) sum += r.getX(i) + r.getTag(i) + r.getWord(i);
console.log("sum", sum);
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, run()); } catch (e) { console.log(label, (e as Error).name, (e as Error).message); }
};
// Indices that are not exact int32 values: each offset is ToIndex'd (truncated, NaN is 0) or refused.
const odd: number[] = [0.5, 1.25, 2.375, NaN, -0, -0.25, -1, 15, 16, 1e10, 2 ** 31, 2 ** 31 / 8, -(2 ** 31), Infinity, -Infinity];
for (const i of odd) {
  show(`getX(${String(i)})`, () => r.getX(i));
  show(`getTag(${String(i)})`, () => r.getTag(i));
  show(`setTag(${String(i)})`, () => { r.setTag(i, 9); return r.getTag(Math.max(0, Math.min(n - 1, Math.trunc(i * 8 + 4) >> 3))); });
}
// A raw byte offset through a method: the integer and double forms of the same positions.
class Bytes {
  readonly view: DataView;
  constructor(view: DataView) { this.view = view; }
  at(offset: number): number { return this.view.getUint8(offset); }
  put(offset: number, v: number): void { this.view.setUint8(offset, v); }
}
const b = new Bytes(new DataView(new ArrayBuffer(8)));
for (let o = 0; o < 8; o++) b.put(o, o * 11);
for (const o of [0, 3, 7, 7.9, 8, -0, NaN, -1, 0x7fffffff, 0x80000000]) show(`at(${String(o)})`, () => b.at(o));
// The same accessor reached by virtual dispatch.
const records: Records[] = [r, new Shifted(new Uint8Array(n * 8))];
for (const each of records) show("virtual", () => each.getX(3) + each.getX(2.5));
