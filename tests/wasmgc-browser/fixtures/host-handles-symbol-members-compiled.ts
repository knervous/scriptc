// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled values meet symbol-keyed members only in the native any model
// Symbol-keyed get / has / hasOwn / descriptor / set on compiled values of every kind (class instances, typed records, class
// values, arrays, collections, functions, plain objects) read the compiled property table: the host is never asked about a
// compiled receiver (React: `maybeIterable[Symbol.iterator]`, `$$typeof`-style symbol brands, Symbol.toStringTag probes).
const g = globalThis as any;
const brand = g.Symbol.for("brand");
class Box { n = 1; [Symbol.iterator]() { return this.n; } }
interface Rec { a: number }
const inst: any = new Box();
const rec: any = { a: 1 } as Rec;
const cls: any = Box;
const arr: any = [1, 2];
const mp: any = new Map([[1, 2]]);
const st: any = new Set([1]);
const fn: any = function f() { return 1; };
const plain: any = { x: 1 };
const all: any[] = [inst, rec, cls, arr, mp, st, fn, plain];
let out = "";
for (const v of all) {
  out += (typeof v[Symbol.iterator]) + "," + (v[brand] === undefined) + "," + (Symbol.iterator in v) + "," + (brand in v) + ";";
}
console.log(out);
console.log(inst[Symbol.iterator](), Object.getOwnPropertySymbols(rec).length);
for (const v of [inst, arr, fn, plain, cls]) { try { v[brand] = "tagged"; } catch { /* a frozen or typed target */ } }
console.log(inst[brand], arr[brand], fn[brand], plain[brand], cls[brand], brand in plain, Object.prototype.hasOwnProperty.call(plain, brand));
console.log(Object.getOwnPropertySymbols(plain).length, Object.getOwnPropertySymbols(arr).length, (Object.getOwnPropertyDescriptor(plain, brand) as any).value);
