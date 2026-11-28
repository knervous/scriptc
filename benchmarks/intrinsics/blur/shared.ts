// The blur for the compiled threads=shared lanes: one instance of this module per thread, every instance working on
// one shared memory. Only memory crosses threads (WasmGC objects can't, and each native thread-instanced runtime has
// its own heap), so the host places the image, the scratch rows and the counter cell in that memory and passes each
// as a byte span: on WasmGC a link export's (address, length) over the imported shared WebAssembly.Memory, natively a
// thread-instanced library's mutable-bytes (pointer, length) over the host's buffers. Each worker's instance claims
// bands through a WorkCounter over the shared cell. Original code, Apache-2.0.
import { WorkCounter } from "../../../packages/intrinsics/atomics.ts";
import { fillGray, runJobs, BANDS } from "./kernel.ts";
import { fnv1a } from "../common/input.ts";

const counter = (cells: Uint8Array): WorkCounter => new WorkCounter(new Int32Array(cells.buffer, cells.byteOffset, 1), 0, BANDS);

export function fill(src: Uint8Array): void { fillGray(src); }
export function reset(cells: Uint8Array): void { counter(cells).reset(); }
/** Blurs bands until none are left; returns how many this thread blurred. */
export function work(src: Uint8Array, dst: Uint8Array, tmp: Uint8Array, cells: Uint8Array): number {
  return runJobs(src, dst, new Uint16Array(tmp.buffer, tmp.byteOffset, tmp.byteLength >> 1), counter(cells));
}
export function checksum(dst: Uint8Array): number { return fnv1a(dst); }
