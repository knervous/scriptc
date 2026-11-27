// An ArrayBuffer's byteLength: a fresh buffer, and a wasm memory's buffer
// before and after growth (each read sees the buffer it was asked of).
const fresh = new ArrayBuffer(24);
console.log(fresh.byteLength);
const memory = new WebAssembly.Memory({ initial: 1 });
const before: ArrayBuffer = memory.buffer;
console.log(before.byteLength);
memory.grow(1);
console.log(memory.buffer.byteLength);
const maybe: ArrayBuffer | undefined = memory.buffer;
console.log(maybe?.byteLength ?? -1);
