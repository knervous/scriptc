// @native-only: the native object model holds a typed array in dyn as its view over module memory, so `ArrayBufferView | ArrayBuffer` (BufferSource, WebGPU's writeBuffer data) collapses to dyn exactly
type BufferSource = ArrayBufferView | ArrayBuffer;
type AllowShared = ArrayBufferView | ArrayBuffer | SharedArrayBuffer;
const staging = new Uint8Array(64);
function bytesOf(data: BufferSource): Uint8Array {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
function writeBuffer(offset: number, data: AllowShared, dataOffset = 0, size?: number): string {
  // (a SharedArrayBuffer never exists as a value here)
  const view = data as ArrayBufferView;
  const src = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const n = size ?? src.byteLength - dataOffset;
  staging.set(src.subarray(dataOffset, dataOffset + n), offset);
  return `${data instanceof ArrayBuffer ? "buffer" : `view@${view.byteOffset}`} ${src.byteLength} -> ${offset}+${n}`;
}
const f = new Float32Array([1, 2, 3]);
console.log(writeBuffer(0, f));
console.log(writeBuffer(12, f.buffer, 4, 8));
const u16 = new Uint16Array([0x0102, 0x0304, 0x0506]);
console.log(writeBuffer(20, u16.subarray(1)));
const ab = new ArrayBuffer(4);
new Uint8Array(ab).set([9, 8, 7, 6]);
console.log(writeBuffer(30, ab));
console.log(Array.from(staging.subarray(0, 44)).join(","));
const view = bytesOf(f);
view[0] = 0; view[3] = 0x40;
console.log(f[0], view.byteLength, bytesOf(ab).byteLength, bytesOf(ab)[2]);
const kept: BufferSource[] = [f, ab, u16];
console.log(kept[0] === f, kept[1] === ab, kept.map((k) => k.byteLength).join(","));
