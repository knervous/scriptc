// @native-only: a BufferSource-style union is dyn under the native object model (engine dyn refuses it)
// A typed array held as `ArrayBufferView` (a union of every typed-array kind) passed on to a BufferSource-style
// slot (WebGPU's GPUAllowSharedBufferSource, which the native object model holds as dyn) keeps its kind: a texture
// level's bytes reach a queue's `instanceof` ladder as the Uint8Array or Float32Array they are, subarrays included.
type Source = ArrayBuffer | SharedArrayBuffer | ArrayBufferView;
interface Level { width: number; data: ArrayBufferView }
function kind(data: Source): string {
  if (data instanceof Uint8Array) return `u8:${data.length}`;
  if (data instanceof Float32Array) return `f32:${data.length}`;
  if (ArrayBuffer.isView(data)) return `view:${data.byteLength}`;
  return `buffer:${data.byteLength}`;
}
interface Queue { write(data: Source): string }
const queue: Queue = { write: (data) => kind(data) };
const base = new Uint8Array([1, 2, 3, 4, 5, 6]);
const levels: Level[] = [
  { width: 2, data: new Uint8Array([1, 2, 3]) },
  { width: 1, data: new Float32Array([1, 2]) },
  { width: 1, data: base.subarray(2, 5) },
];
console.log(levels.map((level) => queue.write(level.data)).join(" "));
const direct: ArrayBufferView = new Float32Array(3);
const maybe: ArrayBufferView | null = Math.random() < 2 ? new Uint8Array(7) : null;
console.log(kind(direct), maybe ? kind(maybe) : "none", kind(new ArrayBuffer(4)));
