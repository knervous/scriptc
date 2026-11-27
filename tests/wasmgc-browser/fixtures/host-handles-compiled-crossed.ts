// @options: {"hostHandles": true}
// @hits(native-any): ^\$dyn\.compiledKeys$
// @native-any-only: the any-typed values and Object.* key surfaces meet the page host only in the native any model
// A compiled object, array and function that CROSSED to the page (stored on a page object, read back as any) keep their compiled
// key tables: Object.keys / values / entries / getOwnPropertyNames / Reflect.ownKeys / for-in / Object.assign never ask the host
// to enumerate a value that is ours.
const g = globalThis as any;
function entriesText(x: any): string { let out = ""; for (const e of Object.entries(x)) out += e[0] + "=" + e[1] + ";"; return out; }
const holder = new g.Object();
const obj: any = { a: 1, b: "two", c: true };
const arr: any = [10, 20, 30];
function fn(this: any) { return 1; }
const f: any = fn; f.tag = "t";
holder.obj = obj; holder.arr = arr; holder.fn = f;
const o = holder.obj, a = holder.arr, h = holder.fn;
console.log(Object.keys(o).join(), Object.values(o).join(), entriesText(o));
console.log(Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).join(), Object.getOwnPropertySymbols(o).length);
const seen: string[] = []; for (const k in o) seen.push(k);
console.log(seen.join());
const copy: any = {}; Object.assign(copy, o, a);
console.log(Object.keys(copy).join(), copy.b, copy[1]);
console.log(Object.keys(a).join(), Object.values(a).join(), Object.getOwnPropertyNames(a).join(), Reflect.ownKeys(a).length);
const ak: string[] = []; for (const k in a) ak.push(k);
console.log(ak.join(), Object.keys(h).join(), Object.values(h).join());
// the page adds an own property to the crossed object: compiled code reads the same object
o.d = 4;
console.log(Object.keys(holder.obj).join(), Object.keys(obj).join());
// a typed record that crossed
const rec = { x: 1, y: "z" };
holder.rec = rec;
const r = holder.rec;
console.log(Object.keys(r).join(), Object.values(r).join(), Object.getOwnPropertyNames(r).join());
