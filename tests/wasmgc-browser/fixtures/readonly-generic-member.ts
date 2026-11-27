// Readonly<T> on a type parameter inside a function-typed member of a generic interface: it maps like T,
// whatever T is (records, a union of records, arrays), at every instantiation.
interface Codec<T> {
  readonly schemaId: number;
  encode(value: Readonly<T>): Uint8Array;
  decode(bytes: Uint8Array): T | null;
}
type A = { count: number };
type B = { name: string; tags: string[] };
type U = A | B;
const UC: Codec<U> = {
  schemaId: 1,
  encode: (v: Readonly<U>): Uint8Array => new Uint8Array([("count" in v) ? v.count : v.tags.length]),
  decode: (bytes: Uint8Array): U | null => bytes.length === 0 ? null : bytes[0] > 5 ? { count: bytes[0] } : { name: "n", tags: ["a"] },
};
const AC: Codec<number[]> = {
  schemaId: 2,
  encode: (v: Readonly<number[]>): Uint8Array => new Uint8Array(v),
  decode: (bytes: Uint8Array): number[] | null => Array.from(bytes),
};
function parse<T>(c: Codec<T>, b: Uint8Array): T {
  const v = c.decode(b);
  if (v === null) throw new Error("bad");
  return v;
}
function on<T>(c: Codec<T>, h: (v: T) => void): (b: Uint8Array) => void {
  return (b) => h(parse(c, b));
}
on(UC, (v) => console.log("count" in v ? v.count : v.name))(new Uint8Array([9]));
on(UC, (v) => console.log("count" in v ? v.count : v.name))(new Uint8Array([2]));
on(AC, (v) => console.log(v.length))(new Uint8Array([1, 2, 3]));
console.log(UC.encode({ count: 4 }).length, AC.encode([1, 2]).length);
interface Item { id: number; tags: string[] }
interface Store { status: Item | null; list: Item[] | null }
const SC: Codec<Store> = Object.freeze({
  schemaId: 1,
  encode: (value: Readonly<Store>): Uint8Array => new Uint8Array([value.list === null ? 0 : value.list.length]),
  decode: (bytes: Uint8Array): Store | null => bytes.length === 0 ? null : { status: null, list: bytes[0] === 0 ? null : [{ id: bytes[0], tags: ["t"] }] },
});
function reader<T>(codec: Codec<T>, fallback: T): (b: Uint8Array) => T {
  let held: T = fallback;
  return (b) => { held = parse(codec, b); return held; };
}
const rd = reader(SC, { status: null, list: null });
console.log(rd(new Uint8Array([2])).list?.length, rd(new Uint8Array([0])).list, SC.encode({ status: null, list: [{ id: 1, tags: [] }] })[0]);
