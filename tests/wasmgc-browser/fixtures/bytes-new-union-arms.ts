// new TypedArray(union) constructs by the active arm (gltf-ext-basisu.ts preMesh:
// `new Uint32Array(accessor._data as Uint16Array | Uint32Array | Uint8Array)`): typed-array arms copy element-wise
// with the target's conversion and a number array copies. The source is evaluated once.
let reads = 0;
function indices(kind: number): Uint16Array | Uint32Array | Uint8Array {
  reads++;
  return kind === 0 ? new Uint16Array([1, 2, 65535]) : kind === 1 ? new Uint32Array([4294967295, 7]) : new Uint8Array([9, 255]);
}
const widened = [0, 1, 2].map((k) => Array.from(new Uint32Array(indices(k))).join(","));
console.log(widened.join(" | "), reads);
function floats(data: Float64Array | Uint8ClampedArray | Int8Array): string {
  return Array.from(new Float32Array(data)).join(",") + " / " + Array.from(new Int16Array(data)).join(",");
}
console.log(floats(new Float64Array([1.5, -2.25, 70000])), floats(new Uint8ClampedArray([300, 4])), floats(new Int8Array([-128, 127])));
function sized(source: number[] | Uint8Array): string {
  const out = new Uint16Array(source);
  return `${out.length}:${Array.from(out).join(",")}`;
}
console.log(sized([1, 70000, -1]), sized(new Uint8Array([5, 6])), sized([]));
const view = new Float32Array(new Float32Array([1, 2, 3, 4]).subarray(1, 3) as Float32Array | Uint8Array);
console.log(Array.from(view).join(","));
