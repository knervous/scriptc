// @options: {"hostHandles": true}
// @native-any-only: Reflect over any-typed compiled objects meets the compiled object model only in the native any model
// Reflect.set / Reflect.defineProperty on compiled receivers return booleans (OrdinarySet, ValidateAndApplyPropertyDescriptor): a
// read-only property, a frozen or sealed or non-extensible object, a setter-less accessor and a non-configurable redefinition are
// false and leave the object unchanged; they do not throw.
const g = globalThis as any;
const out: string[] = [];
const say = (a: any[]): void => { out.push(a.join(":")); };
// plain object
const o: any = { a: 1 };
say(["plain", Reflect.set(o, "a", 2), o.a, Reflect.set(o, "b", 3), o.b]);
// read-only, non-configurable
Object.defineProperty(o, "ro", { value: 1, writable: false, enumerable: true, configurable: false });
say(["ro", Reflect.set(o, "ro", 5), o.ro,
  Reflect.defineProperty(o, "ro", { value: 1 }), Reflect.defineProperty(o, "ro", { value: 2 }), Reflect.defineProperty(o, "ro", { writable: true }),
  Reflect.defineProperty(o, "ro", { enumerable: false }), Reflect.defineProperty(o, "ro", { configurable: true }), Reflect.defineProperty(o, "ro", { get() { return 1; } }), o.ro]);
// read-only but configurable
Object.defineProperty(o, "rc", { value: 1, writable: false, enumerable: true, configurable: true });
say(["rc", Reflect.set(o, "rc", 5), o.rc, Reflect.defineProperty(o, "rc", { value: 7 }), o.rc, Reflect.defineProperty(o, "rc", { writable: true }), Reflect.set(o, "rc", 8), o.rc]);
// writable but non-configurable
Object.defineProperty(o, "wn", { value: 1, writable: true, enumerable: true, configurable: false });
say(["wn", Reflect.set(o, "wn", 2), o.wn, Reflect.defineProperty(o, "wn", { value: 3 }), o.wn, Reflect.defineProperty(o, "wn", { writable: false }), Reflect.set(o, "wn", 4), o.wn, Reflect.defineProperty(o, "wn", { value: 9 })]);
// accessors
let seen = 0;
const acc: any = { get only() { return 1; }, get both() { return 2; }, set both(v: number) { seen = v; } };
say(["acc", Reflect.set(acc, "only", 9), acc.only, Reflect.set(acc, "both", 7), seen]);
// non-extensible, sealed, frozen
const ne: any = { k: 1 }; Object.preventExtensions(ne);
say(["noext", Reflect.set(ne, "k", 2), ne.k, Reflect.set(ne, "n", 3), ne.n, Reflect.defineProperty(ne, "n", { value: 1 }), Reflect.defineProperty(ne, "k", { value: 5 }), ne.k]);
const sealed: any = { k: 1 }; Object.seal(sealed);
say(["sealed", Reflect.set(sealed, "k", 2), sealed.k, Reflect.set(sealed, "n", 3), sealed.n, Reflect.defineProperty(sealed, "k", { value: 6 }), Reflect.defineProperty(sealed, "k", { enumerable: false })]);
const fro: any = { k: 1 }; Object.freeze(fro);
say(["frozen", Reflect.set(fro, "k", 2), fro.k, Reflect.set(fro, "n", 3), fro.n, Reflect.defineProperty(fro, "k", { value: 1 }), Reflect.defineProperty(fro, "k", { value: 2 })]);
// arrays
const arr: any = [1, 2, 3];
say(["arr", Reflect.set(arr, 1, 9), arr[1], Reflect.set(arr, 5, 1), arr.length]);
const sarr: any = [1, 2]; Object.seal(sarr);
say(["sealedarr", Reflect.set(sarr, 0, 5), sarr[0], Reflect.set(sarr, 2, 1), sarr.length, Reflect.set(sarr, "x", 1)]);
const farr: any = [1, 2]; Object.freeze(farr);
say(["frozenarr", Reflect.set(farr, 0, 5), farr[0], Reflect.set(farr, "length", 0), farr.length, Reflect.set(farr, "x", 1)]);
// functions and page values
const fn: any = function f() { return 1; };
say(["fn", Reflect.set(fn, "tag", 1), fn.tag, Reflect.set(fn, "name", "z"), fn.name]);
const page = new g.Object(); g.Object.freeze(page);
say(["page", Reflect.set(page, "x", 1), page.x]);
console.log(out.join("\n"));
