// @native-any-only: native-any holds a typed array buffer as the raw $Bytes; engine dyn refuses it and plain native `any` is a page value
function pass(x: any): any { return x; }
const u = new Uint8Array([1, 2, 3]);
const y = pass(u.buffer);
console.log(y.byteLength, y.length, y instanceof ArrayBuffer, ArrayBuffer.isView(y));
const z = pass(u);
console.log(z.byteLength, z.length, z instanceof ArrayBuffer, ArrayBuffer.isView(z));
const w: any = u.buffer;
console.log(w.byteLength, w === u.buffer);
