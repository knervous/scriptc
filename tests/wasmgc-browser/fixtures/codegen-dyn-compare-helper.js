// Relational operators and ++/-- on untyped values: two numbers compare inline,
// a statically numeric operand is never boxed, ToNumeric keeps a number box;
// every other pairing (strings, objects with valueOf, BigInts, null, NaN, -0,
// numbers beyond int32) and the left-to-right ToPrimitive order are unchanged.
export function loops(arr, n) {
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  var current = arr; current = 0;
  for (; current < n; current++) s += current;
  var k = 10; var x = arr.length;
  return [s, i < x, i <= x, i > x, i >= x, k < n, n > k, current];
}
export function cmpAll(a, b) { return [a < b, a <= b, a > b, a >= b].map(v => v ? 1 : 0).join(""); }
export function cmpNum(a) { var two = 2; return [two < a, two <= a, two > a, two >= a, a < two, a <= two, a > two, a >= two].map(v => v ? 1 : 0).join(""); }
export function incs(o) { var r = []; var x = o.v; x++; r.push(x); o.v++; r.push(o.v); ++o.v; r.push(o.v); o.v--; r.push(o.v); var y = o.s; y++; r.push(y); var z; z++; r.push(z); var w = null; w--; r.push(w); var q = o.v; q = q * 2; q++; r.push(q); var t = o.t; t++; r.push(t); var neg = -0; neg++; r.push(neg); var u = o.u; u--; r.push(Object.is(u, -0) ? "-0" : u); return r.join(","); }
export function values(big) { return [1, 2, -0, 0, NaN, 2 ** 40, -(2 ** 40), "1", "10", "9", "a", "", null, undefined, true, false, { valueOf() { return 3; } }, [2], [10], big, big, Infinity, -Infinity]; }
export function bigObj(n) { return { v: 5, s: "7", big: n, t: { valueOf() { return 41; } }, u: 1 }; }
