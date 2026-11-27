// Untyped functions: methods and this, call, arity, closures (compiled as JavaScript).
export function run() {
  const o = { n: 1, get() { return this.n; }, add(k) { this.n = this.n + k; return this; } };
  let out = "" + o.add(2).add(3).get();
  const f = function (a, b) { return a * b + (this === undefined ? 0 : this.n); };
  out = out + " " + f(2, 3) + " " + f.call(o, 2, 3) + " " + f(4);
  const six = function (a, b, c, d, e, g) { return "" + a + b + c + d + e + g; };
  out = out + " " + six(1, 2, 3, 4, 5, 6) + " " + six(1, 2, 3, 4, 5) + " " + six(1, 2, 3, 4, 5, 6, 7);
  const mk = function (k) { let total = k; return function (x) { total = total + x; return total; }; };
  const acc = mk(10);
  acc(1); acc(2);
  out = out + " " + acc(3);
  const apply2 = function (fn, x) { return fn(fn(x)); };
  out = out + " " + apply2(function (v) { return v * 3; }, 2);
  const holder = { fn: f, n: 100 };
  out = out + " " + holder.fn(1, 1);
  let threw = "no";
  try { const notFn = { x: 1 }; notFn.x(); } catch (e) { threw = "yes"; }
  out = out + " " + threw + " " + (f === f) + " " + (mk(1) === mk(1));
  const g = function (a, b, c) { return this.n + ":" + a + b + c; };
  const bound = g.bind({ n: 7 }, 1);
  out = out + " " + bound(2, 3) + " " + g.apply({ n: 8 }, [4, 5, 6]) + " " + g.call({ n: 9 }, 7, 8, 9) + " " + f.apply(undefined, [3, 4]);
  return out;
}
