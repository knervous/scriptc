// @options: {"hostHandles": true}
// @hits(native-any): ^\$dyn\.idHash$
// @native-any-only: the any-typed values meet the page host only in the native any model
// Compiled objects that crossed to the page (stored on a page object, read back as any) are Map/Set/WeakMap keys beside page
// object keys; identity and lookup are right both through the original reference and the read-back one. Compiled references
// hash compiled-side: the host cannot number a GC object.
const g = globalThis as any;
const holder = new g.Object();
const obj: any = { n: 1 };
const arr: any = [1, 2];
const fn: any = function f() { return 1; };
const frozen: any = Object.freeze({ z: 1 });
class Box { v = 1; }
const box: any = new Box();
const pageKey = new g.Object();
const rec = { x: 1 };
holder.obj = obj; holder.arr = arr; holder.fn = fn; holder.frozen = frozen; holder.box = box; holder.rec = rec; holder.page = pageKey;
const back = { obj: holder.obj, arr: holder.arr, fn: holder.fn, frozen: holder.frozen, box: holder.box, rec: holder.rec, page: holder.page };
const map = new Map<any, string>();
const set = new Set<any>();
const weak = new WeakMap<any, string>();
for (const [name, k] of [["obj", obj], ["arr", arr], ["fn", fn], ["frozen", frozen], ["box", box], ["rec", rec], ["page", pageKey]] as [string, any][]) {
  map.set(k, name); set.add(k); weak.set(k, name);
}
const lines: string[] = [];
for (const name of Object.keys(back)) {
  const k = (back as any)[name];
  lines.push(`${name}:${map.get(k)}:${set.has(k)}:${weak.get(k)}:${weak.has(k)}`);
}
console.log(lines.join(" "));
console.log(map.size, set.size, map.has({}), set.has([]), weak.has(new g.Object()), map.get(obj), map.get(holder.obj));
// distinct objects with the same shape stay distinct; delete through the read-back reference removes the original entry
const twin: any = { n: 1 };
console.log(map.has(twin), set.delete(holder.obj), set.has(obj), set.size, weak.delete(holder.arr), weak.has(arr));
// many keys: ids stay distinct
const many: any[] = []; const m2 = new Map<any, number>();
for (let i = 0; i < 200; i++) { const o: any = { i }; many.push(o); m2.set(o, i); }
let ok = true; for (let i = 0; i < 200; i++) if (m2.get(many[i]) !== i) ok = false;
console.log(ok, m2.size, Object.keys(obj).join(), Object.entries(obj).join(";"), Object.getOwnPropertyNames(arr).join());
