// Closures with record parameters that never reach untyped code or the page: their dyn invokers
// (and the record shapes they would page) are dropped; paged-escape-census.mjs checks the paged count.
interface A { a: number; }
interface B { b: string; }
interface CodecOf<T> { readonly name: string; encode(value: Readonly<T>): number; decode(n: number): T | null; }
interface Msg<T> { readonly name: string; encode(value: T): number; decode(n: number): T; }
const CA: CodecOf<A> = Object.freeze({ name: "A", encode: (v: Readonly<A>) => v.a, decode: (n: number): A | null => ({ a: n }) });
const CB: CodecOf<B> = Object.freeze({ name: "B", encode: (v: Readonly<B>) => v.b.length, decode: (n: number): B | null => ({ b: "x".repeat(n) }) });
function define<T>(binary: CodecOf<T>): Msg<T> {
  return Object.freeze({
    name: binary.name,
    encode(value: T): number { return binary.encode(value); },
    decode(n: number): T { const v = binary.decode(n); if (v === null) throw new TypeError("bad"); return v; },
  });
}
const MA = define(CA), MB = define(CB);
console.log(MA.encode({ a: 3 }), MA.decode(4).a, MB.encode({ b: "yy" }), MB.decode(2).b);
