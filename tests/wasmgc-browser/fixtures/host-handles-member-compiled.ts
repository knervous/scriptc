// @options: {"hostHandles": true}
// @native-any-only: the any-typed values and page members meet only in the native any model
// Member get / set / `in` / typeof / delete / method calls on a value that is one of ours but reaches the member operation as
// an externref (stored on a page object, read back as any, passed through page-typed parameters): the compiled member path
// answers; the host is asked only about genuine page values.
const g = globalThis as any;
const holder = new g.Object();
class P { n = 1; get twice() { return this.n * 2; } bump() { this.n++; return this.n; } }
const obj: any = { a: 1, f() { return 2; } };
const arr: any = [1, 2, 3];
const inst: any = new P();
const fn: any = function named() { return "n"; };
holder.obj = obj; holder.arr = arr; holder.inst = inst; holder.fn = fn;
const o = holder.obj, a = holder.arr, p = holder.inst, f = holder.fn;
console.log(o.a, o.f(), a[1], a.length, p.n, p.twice, p.bump(), f(), f.name);
o.a = 10; o.z = 5; a[1] = 20; a.push(4); p.n = 7; f.extra = "x";
console.log(obj.a, obj.z, arr.join(), inst.n, fn.extra, o.a, a[1], p.n);
console.log("a" in o, "nope" in o, 1 in a, "twice" in p, "bump" in p, g.Object.prototype.hasOwnProperty.call(o, "z"));
console.log(typeof o.a, typeof o.f, typeof o.missing, typeof a.push, typeof p.bump, typeof p.twice, typeof f.extra);
const key = "dyn" + "key";
o[key] = 3; a[5] = 6;
console.log(o[key], obj[key], a[5], arr.length, o["a"], a["1"]);
