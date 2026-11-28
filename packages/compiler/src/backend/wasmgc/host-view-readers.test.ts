import { describe, expect, test } from "vitest";
import { callMethodWith, wasmGcHostImports } from "./host.js";

// A platform method that reads a byte view during the call and refuses a resizable buffer (GPUQueue.writeBuffer) gets
// a copy of a module view's bytes; every other method, and every view the page made itself, crosses as it is.
class GPUQueue {
  written: number[][] = [];
  writeBuffer(_buffer: unknown, _offset: number, data: ArrayBufferView): void {
    if ((data.buffer as ArrayBuffer & { resizable?: boolean }).resizable) throw new TypeError("The provided ArrayBufferView value must not be resizable.");
    this.written.push(Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }
}
(globalThis as Record<string, unknown>)["GPUQueue"] = GPUQueue;

// A module memory whose views follow growth (memBuffer's resizable buffer).
const rab = new (ArrayBuffer as unknown as new (n: number, o: { maxByteLength: number }) => ArrayBuffer)(65536, { maxByteLength: 1 << 20 });
const host = wasmGcHostImports({}, { memory: { buffer: rab, toResizableBuffer: () => rab } } as never).host as Record<string, (...a: unknown[]) => unknown>;
const F32 = 7;

describe("view-reading platform methods over module memory", () => {
  test("GPUQueue.writeBuffer reads a copy of a module view's bytes", () => {
    const view = host["bytes.toJs"]!({}, F32, 64, 2) as Float32Array;
    expect((view.buffer as ArrayBuffer & { resizable?: boolean }).resizable).toBe(true);
    view[0] = 1.5; view[1] = -2;
    const queue = new GPUQueue();
    callMethodWith(queue, "writeBuffer", [null, 0, view]);
    expect(queue.written).toEqual([Array.from(new Uint8Array(new Float32Array([1.5, -2]).buffer))]);
  });
  test("a resizable buffer the page made is not ours: refused as the platform refuses it", () => {
    const own = new Float32Array(new (ArrayBuffer as unknown as new (n: number, o: { maxByteLength: number }) => ArrayBuffer)(8, { maxByteLength: 16 }));
    expect(() => callMethodWith(new GPUQueue(), "writeBuffer", [null, 0, own])).toThrow(TypeError);
  });
  test("any other method receives the module view itself", () => {
    const view = host["bytes.toJs"]!({}, F32, 128, 1);
    const seen: unknown[] = [];
    callMethodWith({ writeBuffer: (_b: unknown, _o: unknown, d: unknown) => { seen.push(d); } }, "writeBuffer", [null, 0, view]);
    expect(seen[0]).toBe(view);
  });
  test("a member that is not callable throws as `o[k]()` does", () => {
    expect(() => callMethodWith({ writeBuffer: 1 }, "writeBuffer", [])).toThrow("o[k] is not a function");
  });
});
