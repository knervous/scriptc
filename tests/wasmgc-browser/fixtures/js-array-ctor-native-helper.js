// The Array constructor in untyped JS: Array(n) / new Array(n) with holes,
// zero and several arguments, a non-number sole argument, invalid lengths,
// and React's useMemoCache construction verbatim (Array.from({ length }):
// js-array-from-length).
const SENTINEL = Symbol.for("react.memo_cache_sentinel");
var memoState = null;
// react-dom's useMemoCache, minus the fiber plumbing.
export function useMemoCache(size) {
  var memoCache = memoState, updateQueue, current;
  null == memoCache && (memoCache = memoState = { data: [], index: 0 });
  updateQueue = memoCache.data[memoCache.index];
  if (void 0 === updateQueue)
    for (
      updateQueue = memoCache.data[memoCache.index] = Array(size), current = 0;
      current < size;
      current++
    )
      updateQueue[current] = SENTINEL;
  memoCache.index++;
  return updateQueue;
}
export function resetMemo() { memoState.index = 0; }
export function cloneMemo() { return memoState.data.map(function (array) { return array.slice(); }); }
const make = (n) => Array(n), makeNew = (n) => new Array(n);
const holes = (a) => { const out = []; for (let i = 0; i < a.length; i++) out.push(i in a ? "v" : "_"); return out.join(""); };
const err = (f) => { try { const a = f(); return "ok " + a.length; } catch (e) { return `${e.name}: ${e.message} ${e instanceof RangeError}`; } };

export function report() {
  const out = [];
  const a = make(4);
  out.push(`a ${a.length} ${holes(a)} ${a[2] === undefined} ${Object.keys(a).length} ${JSON.stringify(a)} [${a.join("-")}] [${String(a)}]`);
  out.push(`search ${a.indexOf(undefined)} ${a.lastIndexOf(undefined)} ${a.includes(undefined)} ${a.findIndex((x) => x === undefined)} ${a.find((x) => true)}`);
  let visits = 0; a.forEach(() => visits++);
  out.push(`callbacks ${visits} ${a.some(() => true)} ${a.every(() => false)} ${a.filter(() => true).length} ${a.reduce((s) => s + 1, 0)}`);
  const mapped = a.map(() => 1);
  out.push(`map ${mapped.length} ${holes(mapped)}`);
  const spread = [...a]; let iterated = 0; for (const x of a) if (x === undefined) iterated++;
  out.push(`iterate ${spread.length} ${holes(spread)} ${iterated}`);
  out.push(`slice ${a.slice(1).length} ${holes(a.slice(1))} concat ${holes(a.concat([1]))}`);
  out.push(`kind ${Array.isArray(a)} ${typeof a} ${Object.prototype.toString.call(a)}`);
  a[1] = "x";
  out.push(`write ${a.length} ${holes(a)} ${a[1]}`);
  a.push("p");
  out.push(`push ${a.length} ${holes(a)} ${a.join("|")}`);
  a.length = 2;
  out.push(`truncate ${a.length} ${holes(a)}`);
  a.length = 5;
  out.push(`grow ${a.length} ${holes(a)}`);
  a[7] = "far";
  out.push(`sparse ${a.length} ${holes(a)}`);
  const f = makeNew(3).fill(7);
  out.push(`fill ${f.join(",")} ${holes(f)} ${holes(makeNew(4).fill(0, 1, 3))}`);
  const s = make(6); s[0] = "b"; s[1] = undefined; s[3] = "a"; s[4] = 10; s[5] = 9;
  const c = s.slice(); s.sort();
  out.push(`sort ${s.length} ${holes(s)} ${s.map((x) => String(x)).join(",")}`);
  const seen = []; c.sort((p, q) => { seen.push(typeof p, typeof q); return String(p) < String(q) ? -1 : String(p) > String(q) ? 1 : 0; });
  out.push(`sort cmp ${c.length} ${holes(c)} ${c.map((x) => String(x)).join(",")} ${seen.every((t) => t === "string" || t === "number")}`);
  const r = make(3); r[0] = "a";
  r.reverse();
  out.push(`reverse ${holes(r)} ${r.join(",")}`);
  out.push(`zero ${make(0).length} ${makeNew(0).length} ${make(-0).length} ${Array().length} ${new Array().length}`);
  out.push(`elements ${Array(1, 2, 3).join(",")} ${new Array("a", "b").join(",")} ${Array(undefined, undefined).length}`);
  for (const x of ["3", null, undefined, true, { k: 1 }, [2], SENTINEL]) {
    const one = make(x), two = makeNew(x);
    out.push(`single ${typeof x} ${one.length} ${holes(one)} ${one[0] === x} ${two.length} ${two[0] === x}`);
  }
  for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity, -Infinity]) out.push(`bad ${bad} ${err(() => make(bad))} | ${err(() => makeNew(bad))}`);
  // The memo cache: two renders, a cleared index, a clone.
  const c1 = useMemoCache(3);
  out.push(`memo ${c1.length} ${holes(c1)} ${c1.every((v) => v === SENTINEL)} ${c1[3]} ${c1[-1]}`);
  c1[0] = 1; c1[1] = "b"; c1[2] = c1;
  resetMemo();
  const c2 = useMemoCache(3);
  out.push(`memo again ${c1 === c2} ${c2[0]} ${c2[1]} ${c2[2] === c1}`);
  const cloned = cloneMemo()[0];
  out.push(`memo clone ${cloned !== c1} ${cloned.length} ${cloned[1]} ${cloned[2] === c1}`);
  return out.join("\n");
}
// Arrays with holes for the page to observe.
export function holeArrays() { const paged = make(3); paged[0] = 1; paged[2] = 3; return [make(4), paged]; }
