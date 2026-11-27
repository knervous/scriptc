// A constructor-struct object converted by a callee while the caller holds a cached fact about it.
function Node(a, b) { this.a = a; this.b = b; this.n = 0; }
function convertByDelete(o) { delete o.b; }
function convertByAdd(o, k) { o[k] = 7; }
function keepShape(o) { o.n = o.n + 1; }
function use(o, conv) {
  const out = [o.a, o.b, o.n];
  keepShape(o);
  out.push(o.a, o.n);
  conv(o);
  out.push(o.a, String(o.b), o.n, Object.keys(o).join("+"));
  o.a = "w"; o.n = o.n + 10;
  out.push(o.a, o.n);
  return out.join(",");
}
export function probe() {
  const x = new Node(1, 2), y = new Node(3, 4), z = new Node(5, 6);
  return [use(x, keepShape), use(y, convertByDelete), use(z, o => convertByAdd(o, "extra")), use(new Node(8, 9), keepShape)].join(" | ");
}
