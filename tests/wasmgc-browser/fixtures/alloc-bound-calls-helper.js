// Bound functions called with every split of bound and call arguments around four.
function show() { var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i])); return (this && this.tag || "-") + "(" + arguments.length + ":" + a.join(",") + ")"; }
function three(x, y, z) { return [String(this && this.tag), x, y, z].join("/"); }
function mk(x) { return x; }
export function run() {
  var out = [], self = { tag: "T" }, f = mk(show);
  var b0 = f.bind(self), b1 = f.bind(self, 1), b2 = f.bind(null, 1, 2), b4 = f.bind(self, 1, 2, 3, 4), b5 = f.bind(self, 1, 2, 3, 4, 5);
  out.push(b0(), b0("a"), b0("a", "b", "c", "d"), b0("a", "b", "c", "d", "e"));
  out.push(b1(), b1("a", "b", "c"), b1("a", "b", "c", "d"), b2("a", "b"), b2("a", "b", "c"), b4(), b4("a"), b5(), b5("a"));
  out.push(b2(undefined, "x"), b1(undefined));
  var t = mk(three).bind(self, "p"); out.push(t(), t("q"), t("q", "r", "s"));
  var bb = b1.bind({ tag: "ignored" }, 2); out.push(bb(3), bb(3, 4, 5));
  var dispatch = mk(function (fiber, queue, action) { return fiber.id + ":" + queue.n + ":" + action; }).bind(null, { id: 7 }, { n: 2 });
  var log = []; for (var i = 0; i < 3; i++) log.push(dispatch(i)); out.push(log.join(","));
  var b6 = f.bind(self, 1, 2, 3, 4, 5, 6); out.push(b6(), b6("a", "b", "c", "d", "e"), b4("a", "b", "c", "d", "e", "f"), b2("a", "b", "c", "d", "e"));
  var b3 = f.bind(undefined, "x", "y", "z"); out.push(b3(), b3("w"), b3("w", "v"), b3.bind(self, "u")("t"));
  var page = mk(Math.max).bind(null, 3); out.push(page(9, 1), page());
  return out.join(" ");
}
