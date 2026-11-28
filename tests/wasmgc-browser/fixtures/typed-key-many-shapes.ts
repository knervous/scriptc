// @native-only
// A key many record shapes declare (`type`, `key`), read through untyped code: each shape answers its own field, a record
// without the key, a class instance, a plain object and a getter answer as JavaScript does.
type A = { type: string; a: number };
type B = { type: number; b: string };
type C = { type: boolean; c: number; key: string };
type D = { type: string | null; d: number[]; key: number };
type E = { type: string; e: { inner: number }; key: string };
type F = { type: string; f: number; g: number };
type G = { other: number; key: string };
class K { type = "class"; key = 7; }
const a: A = { a: 1, type: "a" };
const b: B = { b: "x", type: 2 };
const c: C = { c: 3, type: true, key: "c" };
const d: D = { d: [1, 2], type: null, key: 4 };
const e: E = { e: { inner: 5 }, type: "e", key: "e" };
const f: F = { f: 6, g: 7, type: "f" };
const g: G = { other: 8, key: "g" };
const getter = { get type() { return "got"; }, key: "getter" };
const items: unknown[] = [a, b, c, d, e, f, g, new K(), { type: "plain", key: "plain" }, getter, [1, 2], "str", 5];
function typeOf(x: any): string { return x === null || x === undefined ? "nullish" : String(x.type) + "/" + String(x.key); }
console.log(items.map(typeOf).join(" "));
function bump(x: any): void { if (x.type !== undefined && typeof x.type === "string") x.type = x.type + "!"; }
for (const x of items.slice(0, 8)) bump(x);
console.log(a.type, e.type, f.type, typeOf(new K()), (getter as any).type);
let n = 0;
for (let i = 0; i < 1000; i++) n += String((items[i % items.length] as any).type).length;
console.log(n);
