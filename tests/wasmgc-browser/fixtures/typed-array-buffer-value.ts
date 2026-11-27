// @native-only: a typed array's buffer as a value (engine dyn has no page form for compiled storage)
// x.buffer as a value: its byteLength over a concrete view and over an
// ArrayBufferView (ArrayBufferLike), and one buffer per storage.
const u = new Uint16Array(4);
console.log(u.buffer.byteLength);
function bufferBytes(v: ArrayBufferView): number { return v.buffer.byteLength; }
console.log(bufferBytes(u), bufferBytes(new Float64Array(new ArrayBuffer(48), 8, 2)), bufferBytes(u.subarray(1, 2)));
console.log(u.buffer === new Uint8Array(u.buffer).buffer, u.buffer === new Uint16Array(4).buffer);
