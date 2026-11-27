// Closures of different arities stored together in one array, then called through it.
export function make() {
  let step = 1;
  const get = () => step;
  const setStep = (v) => { step = v; };
  return [get, setStep];
}
export function probe() {
  const out = [];
  const a = make();
  out.push(String(a[0]()));
  a[1](5);
  out.push(String(a[0]()));
  const b = make(), g = b[0], s = b[1];
  s(7);
  out.push(String(g()));
  const fns = [x => x + 1, (x, y) => x * y, () => 42, function (a, b, c) { return [a, b, c].join("/"); }];
  out.push(fns.map((f, i) => String(f(i + 1, 3))).join(","));
  const pair = [() => "zero", (n) => "one:" + n];
  out.push(pair[0]() + " " + pair[1](9) + " " + pair[0].length + pair[1].length);
  out.push(counters());
  return out.join(" ");
}
// Function expressions over shared mutable captures, mixed arities (0 and 1).
function counters() {
  function counter(start) {
    var n = start, step = 1, log = [];
    var inc = function () { n += step; log.push(n); return n; };
    var setStep = function (s) { step = s; };
    var get = function () { return n + ":" + step + ":" + log.join("/"); };
    start = -1;
    var peek = function () { return start; };
    return [inc, setStep, get, peek];
  }
  var a = counter(10), b = counter(100);
  a[0](); a[1](5); a[0](); b[0]();
  return [a[2](), b[2](), a[3](), b[3](), typeof a[0](), a[1](2)].join(" ");
}
