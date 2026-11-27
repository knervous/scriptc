// @options: {"hostHandles": true}
// @native-any-only: the any-typed page receivers meet the untyped helper only in the native any model
// Call-argument spread, destructuring (with IteratorClose), Map/Set construction and for-in over page iterables in untyped
// code: the iteration protocol runs in Wasm; no page array crosses.
import { spread, spreadMixed, first2, first5, toSet, toMap, toArray, keysOf, holes } from './host-handles-page-values-js-helper.js';
const g = globalThis as any;
function pageSet(a: number, b: number): any { const s = new g.Set(); s.add(a); s.add(b); return s; }
function pageSet2(): any { const m = new g.Map(); m.set("z", 1); return m; }
const arr = new g.Array(); arr.push(10, 20, 30);
const max: any = g.Math.max;
console.log(spread(max, arr), spread(max, pageSet(4, 9)), spread(max, [1, 5]), spread(max, new g.Array()), spreadMixed(max, arr));
const closed: string[] = [];
const iterable = new g.Object();
iterable[g.Symbol.iterator] = () => {
  let n = 0;
  return { next() { n++; return n > 3 ? { done: true } : { done: false, value: n * 10 }; }, return() { closed.push("closed"); return {}; } };
};
console.log(first2(iterable).join(), closed.join(), first5(iterable).join(), closed.length);
console.log(toSet(new g.Array(1, 2, 2)).size, toSet(iterable).size, toMap(new g.Array(["a", 1], ["b", 2])).size, toMap(pageSet2()).get("z"));
console.log(toArray(arr).join(), toArray(pageSet(7, 8)).join(), toArray("ab").join(), toArray(iterable).length);
try { toSet(5); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
try { spread(max, 5); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
const proto = new g.Object(); proto.p = 1;
const o = g.Object.create(proto); o.own = 2;
{ const d = new g.Object(); d.value = 3; d.enumerable = false; g.Object.defineProperty(o, "p", d); }
console.log(keysOf(o).join(), keysOf(arr).join(), keysOf(new g.Map()).length, keysOf(g.Object.create(null)).length);
console.log(holes((a: any, b: any, c: any) => [typeof a, a === undefined, typeof b, c].join()));
