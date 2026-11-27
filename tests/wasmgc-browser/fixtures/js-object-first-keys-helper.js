// Objects built from `{}` with computed keys: many distinct first keys (the
// empty shape's transition table grows), the same first key from different
// sites sharing one shape, literals and computed builds of the same layout.
export function build(n) {
  var out = [], i, o, k;
  for (i = 0; i < n; i++) { o = {}; o["k" + i] = i; o.next = i + 1; out.push(o); }
  var sum = 0;
  for (i = 0; i < n; i++) for (k in out[i]) sum += out[i][k];
  return sum + ":" + Object.keys(out[n - 1]).join(",");
}
export function same() {
  var a = {}, b = {}, key = "x";
  a[key] = 1; b.x = 2; a.y = 3; b["y"] = 4;
  var c = { x: 5, y: 6 }, d = {};
  d["x"] = 7; d["y"] = 8;
  return [a, b, c, d].map(function (o) { return Object.keys(o).join("") + (o.x + o.y); }).join(",");
}
