// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled objects meet symbol keys only in the native any model
// Symbol-keyed own properties of compiled objects and functions live in the compiled property table (no page store, no facade):
// assignment, literals, defineProperty, reads, `in`, hasOwn, delete, getOwnPropertySymbols, Reflect.ownKeys, spread and assign.
const g = globalThis as any;
const s1 = g.Symbol("one"), s2 = g.Symbol.for("two"), s3 = g.Symbol("hidden");
const o: any = { a: 1 };
o[s1] = "v1";
const lit: any = { [s2]: "v2", b: 2 };
Object.defineProperty(o, s3, { value: "v3", enumerable: false });
console.log(o[s1], lit[s2], o[s3], s1 in o, s2 in lit, Object.prototype.hasOwnProperty.call(o, s3), Object.keys(o).join());
const syms = Object.getOwnPropertySymbols(o);
console.log(syms.length, syms[0] === s1, syms[1] === s3, Reflect.ownKeys(o).length, Reflect.ownKeys(o)[0], Object.getOwnPropertyNames(o).join());
const copy: any = Object.assign(Object.create(null), o); const assigned: any = Object.assign(Object.create(null), o, lit);
console.log(copy[s1], copy[s3], assigned[s1], assigned[s2], Object.getOwnPropertySymbols(assigned).length);
function f() { return 1; }
const fn: any = f; fn[s1] = "fnsym";
console.log(fn[s1], Object.getOwnPropertySymbols(fn).length, s1 in fn);
// the same object crossed to the page: its symbols are unchanged and page code sees them
const holder = new g.Object(); holder.o = o;
const back = holder.o;
back[s1] = "again";
console.log(back === o, o[s1], Object.getOwnPropertySymbols(holder.o).length);
const d = Object.getOwnPropertyDescriptor(o, s3) as any;
console.log(d.value, d.enumerable, d.writable);
