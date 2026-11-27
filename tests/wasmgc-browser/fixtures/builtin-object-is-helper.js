// React's own spelling (shared/objectIs.js): the builtin when present, else a polyfill.
function is(x, y) {
  return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
}
var objectIs = "function" === typeof Object.is ? Object.is : is;
var stored = Object.is;
export function sameRow(a, b) { return objectIs(a, b); }
export function pairs(values) {
  var out = [];
  for (var i = 0; i < values.length; i++) for (var j = 0; j < values.length; j++) out.push(objectIs(values[i], values[j]) ? 1 : 0);
  return out.join("");
}
export function shapes() {
  var holder = { eq: Object.is };
  var bound = stored.bind(null, NaN);
  var apply = function (f, a, b) { return f(a, b); };
  return [
    objectIs === Object.is, stored === objectIs, typeof stored, stored.length, stored.name, Object.keys(stored).length,
    stored(), stored(undefined), stored(null, undefined), stored(null, null), stored(1, 1, 2), stored.call({}, -0, -0), stored.apply(null, [0, -0]),
    holder.eq(NaN, NaN), bound(NaN), bound(0), apply(objectIs, "a", "a"), apply(Object.is, "a", "b"),
    [NaN, 1, NaN].findIndex(function (x) { return objectIs(x, NaN); }), [0, -0].filter(function (x) { return stored(x, -0); }).length,
  ].join(",");
}
