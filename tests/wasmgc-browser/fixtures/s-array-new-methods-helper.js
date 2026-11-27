var log = [];
const show = (label, f) => { try { log.push(label + "=" + JSON.stringify(f())); } catch (e) { log.push(label + "!" + (e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : String(e))); } };
const holey = (src) => { const a = JSON.parse(src); delete a[1]; return a; };
const mk = () => JSON.parse("[3,1,2,5,4]");
show("at", () => [mk().at(0), mk().at(-1), mk().at(-5), mk().at(-6), mk().at(5), mk().at(1.9), mk().at("2"), mk().at(NaN), mk().at(), mk().at(Infinity), mk().at(-Infinity)]);
show("at-hole", () => { const a = holey("[1,2,3]"); return [a.at(1), a.at(-2)]; });
show("with", () => [mk().with(1, "x"), mk().with(-1, "y"), mk().with(0, undefined)]);
show("with-range", () => mk().with(5, 0));
show("with-range-neg", () => mk().with(-6, 0));
show("with-orig", () => { const a = mk(); a.with(0, 9); return a; });
show("with-hole", () => { const a = holey("[1,2,3]"); const r = a.with(0, 7); return [r, 1 in r]; });
show("toReversed", () => { const a = mk(); return [a.toReversed(), a]; });
show("toReversed-hole", () => { const a = holey("[1,2,3]"); const r = a.toReversed(); return [r, 1 in r]; });
show("toSorted", () => { const a = mk(); return [a.toSorted(), a.toSorted((x, y) => y - x), a]; });
show("toSorted-undefined-last", () => (() => { const a = JSON.parse("[3,0,1,0,2]"); a[1] = undefined; delete a[3]; return a; })().toSorted());
show("toSorted-bad", () => mk().toSorted(5));
show("toSpliced", () => { const a = mk(); return [a.toSpliced(1, 2), a.toSpliced(1, 0, "a", "b"), a.toSpliced(-2), a.toSpliced(), a.toSpliced(1), a.toSpliced(0, 1, 9, 8, 7, 6, 5), a]; });
show("findLast", () => [mk().findLast((x) => x < 3), mk().findLastIndex((x) => x < 3), mk().findLast((x) => x > 9), mk().findLastIndex((x) => x > 9)]);
show("findLast-args", () => { const seen = []; mk().findLast(function (v, i, a) { seen.push([v, i, a.length]); return false; }); return seen; });
show("findLast-bad", () => mk().findLast(5));
show("findLast-hole", () => { const a = holey("[1,2,3]"); const seen = []; a.findLast((v) => { seen.push(v === undefined ? "u" : v); return false; }); return seen; });
show("reduceRight", () => [mk().reduceRight((a, b) => a + "-" + b), mk().reduceRight((a, b) => a + b, ""), [].reduceRight((a, b) => a + b, 7)]);
show("reduceRight-empty", () => [].reduceRight((a, b) => a + b));
show("reduceRight-hole", () => { const a = holey("[1,2,3]"); return a.reduceRight((acc, v) => acc + v); });
show("reduceRight-bad", () => mk().reduceRight(5));
show("flat", () => [JSON.parse("[1,[2,[3,[4]]]]").flat(), JSON.parse("[1,[2,[3,[4]]]]").flat(2), JSON.parse("[1,[2,[3,[4]]]]").flat(Infinity), JSON.parse("[1,[2]]").flat(0), JSON.parse("[1,[2]]").flat(-1), JSON.parse("[1,[2]]").flat("1"), (() => { const a = JSON.parse("[[1],0,[2]]"); delete a[1]; return a; })().flat()]);
show("flat-hole", () => { const a = (() => { const a = JSON.parse("[1,2,[2,5,3]]"); delete a[1]; delete a[2][1]; return a; })(); const r = a.flat(); return [r, r.length]; });
show("flatMap", () => [[1, 2, 3].flatMap((x) => [x, x * 2]), [1, 2].flatMap((x) => [[x]]), [1, 2].flatMap((x) => x), ["a b", "c"].flatMap((s) => s.split(" "))]);
show("flatMap-args", () => { const seen = []; [5, 6].flatMap((v, i, a) => { seen.push([v, i, a.length]); return []; }); return seen; });
show("copyWithin", () => [[1, 2, 3, 4, 5].copyWithin(0, 3), [1, 2, 3, 4, 5].copyWithin(1, 0, 3), [1, 2, 3, 4, 5].copyWithin(-2, -4, -3), [1, 2, 3, 4, 5].copyWithin(2), [1, 2, 3, 4, 5].copyWithin(0, 1, 1)]);
show("copyWithin-self", () => { const a = [1, 2, 3]; return a.copyWithin(0, 1) === a; });
const arr = mk();
const at = arr.at, flat = arr.flat, tos = arr.toSorted, fl = arr.findLast, rr = arr.reduceRight;
show("closures", () => [at.call(mk(), -1), flat.call([[1], [2]]), tos.call(mk()), fl.call(mk(), (x) => x > 3), rr.call(mk(), (a, b) => a - b), typeof at, at.length, flat.length]);


export function run() { return log.join("\n"); }
