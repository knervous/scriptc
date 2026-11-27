var log = [];
function show(label, f) { try { log.push(label + "=" + JSON.stringify(f())); } catch (e) { log.push(label + "!" + (e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : String(e))); } }
function S(arr) { var s = new Set(); for (var i = 0; i < arr.length; i++) s.add(arr[i]); return s; }
function list(s) { return Array.from(s); }
function setLike(arr, hooks) {
  return { size: arr.length, has: function (v) { if (hooks) hooks.push("has" + v); return arr.indexOf(v) >= 0; },
    keys: function () { var i = 0; return { next: function () { if (hooks) hooks.push("next"); return i < arr.length ? { value: arr[i++], done: false } : { value: undefined, done: true }; }, return: function () { if (hooks) hooks.push("return"); return {}; } }; } };
}
export function run(mkSet) {
  var a = mkSet([1, 2, 3, 4]), b = S([3, 4, 5, 6]);
  show("union", () => list(a.union(b)));
  show("union-order", () => list(S([5, 1]).union(S([9, 1, 3]))));
  show("intersection", () => list(a.intersection(b)));
  show("intersection-order-big-other", () => list(S([1, 2, 3]).intersection(S([3, 2, 9, 1, 7]))));
  show("intersection-order-small-other", () => list(S([1, 2, 3, 4]).intersection(S([4, 2]))));
  show("difference", () => list(a.difference(b)));
  show("difference-small-other", () => list(S([1, 2, 3, 4]).difference(S([4, 2]))));
  show("symmetricDifference", () => list(a.symmetricDifference(b)));
  show("isSubsetOf", () => [S([3, 4]).isSubsetOf(a), a.isSubsetOf(S([3, 4])), a.isSubsetOf(a), S([]).isSubsetOf(a)]);
  show("isSupersetOf", () => [a.isSupersetOf(S([3, 4])), a.isSupersetOf(S([9])), a.isSupersetOf(S([])), S([1]).isSupersetOf(a)]);
  show("isDisjointFrom", () => [a.isDisjointFrom(S([8, 9])), a.isDisjointFrom(b), a.isDisjointFrom(S([])), S([1, 2, 3, 4, 5, 6, 7]).isDisjointFrom(S([9]))]);
  show("map-arg", () => list(a.union(new Map([[7, "x"], [8, "y"]]))));
  show("map-arg-intersect", () => list(a.intersection(new Map([[2, "x"], [9, "y"]]))));
  show("setlike", () => list(a.union(setLike([4, 10, 11]))));
  show("setlike-intersect", () => list(a.intersection(setLike([4, 3, 77]))));
  show("setlike-difference", () => list(a.difference(setLike([1, 2, 99, 100, 101]))));
  show("setlike-sub", () => [a.isSubsetOf(setLike([1, 2, 3, 4, 5])), a.isSubsetOf(setLike([1, 2]))]);
  var h1 = [];
  show("superset-close", () => [S([1, 2, 3]).isSupersetOf(setLike([2, 9, 3], h1)), h1]);
  var h2 = [];
  show("disjoint-close", () => [S([1, 2, 3, 4, 5]).isDisjointFrom(setLike([8, 3], h2)), h2]);
  var h3 = [];
  show("disjoint-small-this", () => [S([1, 2]).isDisjointFrom(setLike([8, 3, 4], h3)), h3]);
  show("receiver-unchanged", () => { var x = S([1, 2]); x.union(S([3])); x.difference(S([1])); return list(x); });
  show("bad-arg-number", () => a.union(5));
  show("bad-arg-undefined", () => a.union(undefined));
  show("bad-arg-array", () => a.union([1, 2]));
  show("bad-size-nan", () => a.union({ size: NaN, has: function () { return true; }, keys: function () { return [].values(); } }));
  show("bad-size-undefined", () => a.union({ has: function () { return true; }, keys: function () { return [].values(); } }));
  show("bad-size-neg", () => a.union({ size: -1, has: function () { return true; }, keys: function () { return [].values(); } }));
  show("size-string-ok", () => list(a.union({ size: "2", has: function () { return true; }, keys: function () { return S([9]).values(); } })));
  show("bad-has", () => a.union({ size: 1, has: 5, keys: function () { return [].values(); } }));
  show("bad-keys", () => a.union({ size: 1, has: function () { return true; }, keys: 5 }));
  show("keys-nonobject", () => a.union({ size: 1, has: function () { return true; }, keys: function () { return 5; } }));
  show("incompatible-receiver", () => { var f = a.union; return f.call({}, S([1])); });
  show("map-receiver", () => new Map().union);
  show("arraylike-keys-iter", () => list(a.union({ size: 1, has: function () { return true; }, keys: function () { return [42, 43][Symbol.iterator](); } })));
  show("is-set", () => [a.union(b) instanceof Set, a.union(b) === a, a.union(b).size]);
  show("zero", () => { var r = S([0]).union(S([-0])); return [r.size, Object.is(list(r)[0], 0)]; });
  return log.join("\n");
}
export var mkNative = function (arr) { return S(arr); };
