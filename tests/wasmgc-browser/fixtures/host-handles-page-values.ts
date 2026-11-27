// @options: {"hostHandles": true}
// @native-any-only: Object.values/entries/getOwnPropertyDescriptors, for-in and iteration lower natively only for TS any receivers
// Page-value receivers through typed host members only (no page array crosses): Object.values/entries, for-in keys,
// Object.getOwnPropertyDescriptors, spread, destructuring, Array.from, Map/Set construction.
const g = globalThis as any;
// Descriptors are page objects: the page's defineProperty reads them through the host members.
function def(o: any, k: any, value: any, enumerable: boolean): void { const d = new g.Object(); d.value = value; d.enumerable = enumerable; g.Object.defineProperty(o, k, d); }
function defGet(o: any, k: any, get: any, enumerable: boolean, configurable: boolean): void { const d = new g.Object(); d.get = get; d.enumerable = enumerable; d.configurable = configurable; g.Object.defineProperty(o, k, d); }
function hide(o: any, k: any): void { const d = new g.Object(); d.enumerable = false; g.Object.defineProperty(o, k, d); }
const proto = new g.Object();
proto.inherited = 1; proto.shadowed = "proto";
def(proto, "hiddenProto", 2, false);
const page = g.Object.create(proto);
page.b = 2; page.a = 1; page[1] = "one"; page[0] = "zero"; page.shadowed = "own";
def(page, "hidden", 3, false);
def(page, "hiddenProto", 4, true);
const sym = g.Symbol("s");
def(page, sym, 5, true);
console.log(Object.values(page).join(), JSON.stringify(Object.entries(page)));
const seen: string[] = [];
for (const k in page) seen.push(k);
console.log(seen.join());
const descs = Object.getOwnPropertyDescriptors(page) as any;
console.log(Object.keys(descs).join(), descs.hidden.enumerable, descs.a.value, descs.b.writable, Object.getOwnPropertySymbols(descs).length);
// getters run in key order, once each, when their value is read
const log: string[] = [];
const acc = new g.Object();
defGet(acc, "x", () => { log.push("x"); return 1; }, true, false);
defGet(acc, "y", () => { log.push("y"); return 2; }, true, false);
defGet(acc, "z", () => { log.push("z"); return 3; }, false, false);
console.log(Object.values(acc).join(), log.join(), JSON.stringify(Object.entries(acc)), log.join());
// a getter that deletes a later key: the key is skipped; one that makes it non-enumerable: skipped too
const mut = new g.Object();
mut.first = 1; mut.second = 2; mut.third = 3;
defGet(mut, "first", () => { g.Reflect.deleteProperty(mut, "second"); hide(mut, "third"); return "f"; }, true, true);
console.log(Object.values(mut).join(), Object.entries(mut).length);
// spread / destructuring / Array.from / collections
const arr = new g.Array(); arr.push(10, 20, 30);
console.log([...arr].join(), Array.from(arr).join(), Math.max(...arr));
const [p, q, ...rest] = arr;
console.log(p, q, rest.join());
const set = new g.Set(); set.add(1); set.add(2); set.add(2); set.add(3);
console.log([...set].join(), Array.from(set).length, new Set(set).size);
const map = new g.Map(); map.set("k", 1); map.set("l", 2);
console.log([...map.keys()].join(), JSON.stringify([...map]), map.size);
for (const [k, v] of map) console.log(k, v);
let none = 0; for (const k in new g.Map()) none += k.length; console.log(none);
console.log(Object.values("ab").join(), Object.entries(arr).length, Object.values(g.Math).length);
try { Object.values(null as any); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
// compiled receivers keep their paths
const own: any = { u: 1, v: 2 };
console.log(Object.values(own).join(), JSON.stringify(Object.entries(own)), Object.keys(Object.getOwnPropertyDescriptors(own) as any).join());
const ks: string[] = []; for (const k in own) ks.push(k); console.log(ks.join());
// sparse page arrays, typed arrays, null-prototype objects, class instances
const sparse = new g.Array(3); sparse[1] = "x";
console.log(Object.values(sparse).join(), Object.entries(sparse).length, JSON.stringify(Object.values(new g.Uint8Array(3))));
const bare = g.Object.create(null); bare.k = 1; bare.j = 2;
const bareKeys: string[] = []; for (const k in bare) bareKeys.push(k);
console.log(bareKeys.join(), Object.values(bare).join());
const gp: any = { x: 1, y: 2 };
const gk: string[] = []; for (const k in Object.assign(new g.Object(), gp)) gk.push(k);
console.log(gk.join());
const arrKeys: string[] = []; for (const k in arr) arrKeys.push(k);
console.log(arrKeys.join(), Object.values(new g.Date(0)).length);
// Object.assign from a page source copies its own enumerable string keys, getters run in key order
const target: any = { pre: 0 };
Object.assign(target, page, acc);
console.log(Object.keys(target).join(), target.a, target.x, target.y, log.length);
