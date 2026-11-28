// @native-only
// Computed keys on plain objects next to class instances that also reach the same `o[k]` sites: reads, writes, probes,
// numeric keys, a getter on a plain object and Reflect with a receiver all keep their meaning.
class Point {
  x = 1;
  y = 2;
  get sum(): number { return this.x + this.y; }
}
function read(o: any, k: any): any { return o[k]; }
function write(o: any, k: any, v: any): void { o[k] = v; }
function has(o: any, k: any): boolean { return k in o; }

const plain: any = { a: 1, b: "two", 3: "three" };
const p = new Point();
const withGetter: any = { base: 5, get twice() { return 10; } };
const child: any = { inherited: "yes", mine: "own" };

const keys = ["a", "b", "3", "x", "sum", "missing"];
for (const o of [plain, p, withGetter, child]) {
  console.log(keys.map((k) => String(read(o, k))).join(","), String(read(o, 3)), String(read(o, "twice")), String(read(o, "inherited")));
}
write(plain, "c", 10);
write(p, "x", 7);
write(plain, 4, "four");
console.log(plain.c, p.x, p.sum, read(plain, "4"), String(read(p, "4")));
console.log(has(plain, "c"), has(plain, "zz"), has(p, "y"), has(child, "inherited"), has(p, "sum"));
console.log(Object.keys(plain).join(","));
let total = 0;
const bag: any = {};
for (let i = 0; i < 100; i++) write(bag, "k" + (i % 7), i);
for (const k in bag) total += read(bag, k);
console.log(total, Object.keys(bag).length);
console.log(Reflect.get(withGetter, "twice"), Reflect.get(plain, "b", p), Reflect.set(plain, "r", 1), plain.r);
