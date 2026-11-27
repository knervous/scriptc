// @native-any-only: an any-typed argument stays untyped only in the native any model
// new Float32Array(x) over every kind of untyped x (ECMAScript 23.2.5.1): a non-object is ToIndex's length
// (a symbol or bigint is a TypeError), a typed array copies with element conversion, an ArrayBuffer is a
// shared view, any other object is iterated (Set, Map, generators) or read as an array-like.
function attempt(f: () => unknown): string {
  try { return String(f()); } catch (e: any) { return `${e.constructor.name}: ${e.message}`; }
}
const lengths: any[] = [3, "3", true, false, 1.9, "abc", NaN, -1, "-2", undefined, null, 0];
for (let i = 0; i < lengths.length; i++) { const x = lengths[i]; console.log(attempt(() => new Float32Array(x).length)); }
const sym: any = Symbol("s"), big: any = 3n;
console.log(attempt(() => new Float32Array(sym)));
console.log(attempt(() => new Int8Array(big)));

const ints: any = new Int8Array([1, -2, 127, -128]);
console.log(Array.from(new Float32Array(ints)).join(","), Array.from(new Uint8Array(ints)).join(","));
const floats: any = new Float64Array([1.5, -2.5, 300, NaN]);
console.log(Array.from(new Int8Array(floats)).join(","), Array.from(new Uint8ClampedArray(floats)).join(","), Array.from(new Float32Array(floats)).join(","));
const copy = new Float32Array(ints);
(ints as Int8Array)[0] = 9;
console.log(copy[0], ints[0]);

const buf: any = new ArrayBuffer(8), six: any = new ArrayBuffer(6);
const viaBuf = new Float32Array(buf);
viaBuf[1] = 2.5;
console.log(viaBuf.length, new Uint8Array(buf).join(","), new Float32Array(buf)[1]);
console.log(attempt(() => new Float64Array(buf).length), attempt(() => new Float32Array(six)));

const set: any = new Set([1, 2, 2, 3]);
console.log(Array.from(new Float64Array(set)).join(","));
const map: any = new Map([[1, 2]]);
console.log(Array.from(new Float64Array(map)).join(","));
function* gen() { yield 10; yield "11"; yield 12.5; }
const g: any = gen();
console.log(Array.from(new Int16Array(g)).join(","));
const plain: any = {};
const like: any = { length: 3, 0: 7, 1: "8", 2: true };
console.log(Array.from(new Float32Array(like)).join(","), new Float32Array(plain).length);
const custom: any = { *[Symbol.iterator]() { yield 4; yield 5; } };
console.log(Array.from(new Float32Array(custom)).join(","));
const fn: any = (a: number, b: number) => a + b;
console.log(attempt(() => new Float32Array(fn).length));
