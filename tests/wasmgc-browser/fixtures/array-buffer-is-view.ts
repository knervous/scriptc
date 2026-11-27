// @native-only: ArrayBuffer values (engine dyn has no page form for compiled storage)
// ArrayBuffer.isView: typed arrays and DataViews (compiled, any element type, subarrays) are views; an
// ArrayBuffer (fresh or a view's .buffer) is not; neither are compiled objects, page values, primitives,
// null or undefined. (shader-vb.ts setMeshVertexBuffer: `data: GPUBuffer | ArrayBufferView | null`.)
const f32 = new Float32Array(4), u8 = new Uint8Array(f32.buffer), dv = new DataView(f32.buffer, 4);
const fresh = new ArrayBuffer(8);
const values: [string, unknown][] = [
  ["f32", f32], ["u8 over f32", u8], ["sub", u8.subarray(2, 6)], ["i16", new Int16Array(2)],
  ["f32.buffer", f32.buffer], ["u8.buffer", u8.buffer], ["fresh", fresh], ["view of fresh", new Uint32Array(fresh)],
  ["object", { byteLength: 4 }], ["array", [1, 2]], ["page", performance], ["number", 3], ["string", "x"], ["null", null], ["undefined", undefined],
];
console.log(values.map(([name, v]) => `${name}:${ArrayBuffer.isView(v)}`).join(" "));
console.log(f32.buffer === u8.buffer, u8.buffer === dv.buffer);
function upload(data: Performance | ArrayBufferView | null): string {
  if (data && ArrayBuffer.isView(data)) return `bytes ${data.byteLength}`;
  return data ? "page" : "none";
}
console.log(upload(f32), upload(performance), upload(null), upload(u8.subarray(4)));
