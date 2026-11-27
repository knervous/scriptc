// Bitwise operators on untyped values: ToNumber of every kind, ToInt32 wrapping,
// shift counts, evaluation and coercion order, and React's flag-bubbling shape.
var log = [];
function v(name, n) { return { valueOf: function () { log.push(name); return n; } }; }
export function grid(values) {
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var x = values[i];
    out.push([x & 65011712, x | 0, x ^ -1, ~x, x << 3, x >> 1, x >>> 0, x >>> 28, 1 << x, -8 >> x, -1 >>> x].join(","));
  }
  return out.join(" | ");
}
export function order() {
  log = [];
  var r = [v("a", 6) & v("b", 3), v("c", 1) << v("d", 33), ~v("e", 0), v("f", -1) >>> v("g", 0)];
  return r.join(",") + " " + log.join("");
}
export function bubble(root) {
  var newChildLanes = 0, subtreeFlags = 0;
  for (var child = root.child; null !== child; )
    (newChildLanes |= child.lanes | child.childLanes),
      (subtreeFlags |= child.subtreeFlags & 65011712),
      (subtreeFlags |= child.flags & 65011712),
      (child = child.sibling);
  root.subtreeFlags |= subtreeFlags;
  root.childLanes = newChildLanes;
  return [subtreeFlags, newChildLanes, root.subtreeFlags, (root.flags & 4) !== 0, root.flags >>> 31].join(",");
}
export function unsigned(a) { var u = 0; for (var i = 0; i < a.length; i++) u = (u + a[i]) >>> 0; return u; }
