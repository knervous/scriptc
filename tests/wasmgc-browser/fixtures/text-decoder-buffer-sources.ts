// @native-only: the engine dyn model keeps its fence for a non-Uint8Array TextDecoder input
// TextDecoder.decode over every buffer-source shape: an ArrayBuffer, typed arrays of other kinds (their raw bytes), a subarray view.
const dec = new TextDecoder();
const bytes = new Uint8Array([104, 105, 106, 107]);
console.log(dec.decode(bytes.buffer));
console.log(dec.decode(new Uint16Array([0x6968])));
console.log(dec.decode(new Uint32Array([0x6b6a6968])));
console.log(dec.decode(bytes.subarray(1, 3)));
const wide = new Float32Array(1);
new Uint8Array(wide.buffer).set([0x61, 0x62, 0x63, 0x64]);
console.log(dec.decode(wide));
async function text(buf: ArrayBuffer): Promise<string> { return new TextDecoder().decode(buf); }
text(bytes.buffer).then((t) => console.log(t));
