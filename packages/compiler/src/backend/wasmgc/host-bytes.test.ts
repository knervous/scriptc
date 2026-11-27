import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { wasmGcHostImports } from "./host.js";

// Byte views at the page boundary: element kinds are checked by brand (any realm), and a view over shared memory
// handed to an unshared-only page position is copied by exactly its range, as the same kind of view.
const host = wasmGcHostImports({}, {}).host as Record<string, (...a: unknown[]) => unknown>;
const isKind = (v: unknown, kind: number) => host["bytes.isKind"]!(v, kind);
const unshared = (v: unknown) => host["bytes.unshared"]!(v);
const lengthOf = (v: unknown, kind: number) => host["bytes.lengthOf"]!(v, kind);
const viewLength = (v: unknown) => host["bytes.viewLength"]!(v);
// Kind numbers as host.ts's kinds table orders them.
const U8 = 0, U16 = 3, F32 = 7;
/** A value made in a second realm (a Node vm context stands for an iframe). */
const foreign = <T>(source: string): T => runInNewContext(source) as T;
const bytesOf = (v: ArrayBufferView) => Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));

describe("bytes.isKind / lengthOf / viewLength: element kind by brand", () => {
  test("same realm: exactly the element kind", () => {
    expect(isKind(new Uint8Array(4), U8)).toBe(1);
    expect(isKind(new Float32Array(4), F32)).toBe(1);
    expect(lengthOf(new Uint16Array(3), U16)).toBe(3);
    expect(viewLength(new Uint16Array(3))).toBe(3);
  });
  test("second realm: the same answers as same realm", () => {
    expect(isKind(foreign("new Uint8Array(4)"), U8)).toBe(1);
    expect(isKind(foreign("new Float32Array(2)"), F32)).toBe(1);
    expect(lengthOf(foreign("new Uint16Array(5)"), U16)).toBe(5);
    expect(viewLength(foreign("new Uint8Array(7)"))).toBe(7);
    expect(viewLength(foreign("new DataView(new ArrayBuffer(8))"))).toBe(-1);
    expect(isKind(foreign("new Uint8Array(4)"), F32)).toBe(0);
  });
  test("wrong kind: never a reinterpretation", () => {
    expect(isKind(new Float32Array(4), U8)).toBe(0);
    expect(isKind(new Uint8ClampedArray(4), U8)).toBe(0);
    expect(isKind(new DataView(new ArrayBuffer(4)), U8)).toBe(0);
    expect(() => lengthOf(new DataView(new ArrayBuffer(4)), U8)).toThrow(TypeError);
    expect(() => lengthOf(new Float32Array(4), U8)).toThrow(TypeError);
    expect(viewLength(new DataView(new ArrayBuffer(4)))).toBe(-1);
  });
  test("a plain object spoofing the tag is not a view", () => {
    const fake = { [Symbol.toStringTag]: "Uint8Array", length: 4 };
    Object.setPrototypeOf(fake, Uint8Array.prototype);
    expect(isKind(fake, U8)).toBe(0);
    expect(viewLength(fake)).toBe(-1);
    expect(() => lengthOf(fake, U8)).toThrow(TypeError);
  });
});

describe("bytes.unshared: a shared view copied by exactly its range, as its own kind", () => {
  const sab = () => { const b = new SharedArrayBuffer(16); new Uint8Array(b).forEach((_, i, a) => { a[i] = i; }); return b; };
  test("unshared views come back as the same object (zero copy)", () => {
    for (const v of [new Uint8Array(4), new DataView(new ArrayBuffer(8), 2, 4), new Float32Array(new ArrayBuffer(16), 4, 2), new Uint8Array(0)]) {
      expect(unshared(v)).toBe(v);
    }
    const second = foreign<Uint8Array>("new Uint8Array(4)");
    expect(unshared(second)).toBe(second);
  });
  test("a shared typed array: same element kind, its bytes, an unshared buffer", () => {
    const v = new Uint16Array(sab(), 4, 3);
    const c = unshared(v) as Uint16Array;
    expect(c).not.toBe(v);
    expect(c).toBeInstanceOf(Uint16Array);
    expect(c.buffer).toBeInstanceOf(ArrayBuffer);
    expect([c.byteOffset, c.length, c.buffer.byteLength]).toEqual([0, 3, 6]);
    expect(bytesOf(c)).toEqual([4, 5, 6, 7, 8, 9]);
  });
  test("a shared DataView subview (nonzero offset, shorter length) stays a DataView over exactly its range", () => {
    const v = new DataView(sab(), 5, 6);
    const c = unshared(v) as DataView;
    expect(c).toBeInstanceOf(DataView);
    expect(c.buffer).toBeInstanceOf(ArrayBuffer);
    expect([c.byteOffset, c.byteLength, c.buffer.byteLength]).toEqual([0, 6, 6]);
    expect(bytesOf(c)).toEqual([5, 6, 7, 8, 9, 10]);
  });
  test("an empty shared view copies to an empty view of its kind", () => {
    const d = unshared(new DataView(sab(), 16, 0)) as DataView;
    expect(d).toBeInstanceOf(DataView);
    expect(d.byteLength).toBe(0);
    const f = unshared(new Float32Array(sab(), 8, 0)) as Float32Array;
    expect(f).toBeInstanceOf(Float32Array);
    expect(f.length).toBe(0);
  });
  test("a second-realm view over a second-realm SharedArrayBuffer is copied too", () => {
    const v = foreign<DataView>("(() => { const b = new SharedArrayBuffer(8); new Uint8Array(b).set([1,2,3,4,5,6,7,8]); return new DataView(b, 2, 3); })()");
    const c = unshared(v) as DataView;
    expect(c).not.toBe(v);
    expect(Object.prototype.toString.call(c)).toBe("[object DataView]");
    expect(Object.prototype.toString.call(c.buffer)).toBe("[object ArrayBuffer]");
    expect(bytesOf(c)).toEqual([3, 4, 5]);
    const t = foreign<Int8Array>("new Int8Array(new SharedArrayBuffer(4), 1, 2)");
    const tc = unshared(t) as Int8Array;
    expect(tc).toBeInstanceOf(Int8Array);
    expect(tc.length).toBe(2);
  });
  test("an array of chunks: shared ones copied, the rest kept", () => {
    const keep = new Uint8Array(2), shared = new DataView(sab(), 1, 2);
    const [a, b] = unshared([keep, shared]) as [unknown, DataView];
    expect(a).toBe(keep);
    expect(b).toBeInstanceOf(DataView);
    expect(bytesOf(b)).toEqual([1, 2]);
  });
});
