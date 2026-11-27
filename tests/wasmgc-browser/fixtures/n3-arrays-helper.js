// Untyped arrays: Array.prototype methods (compiled as JavaScript).
// list() returns a dynamic array (a rest parameter), never a typed literal.
function list(...xs) { return xs; }
export function run() {
  const a = list(3, 1, 2);
  let out = "" + a.push(4, 5) + ":" + a.join("-");
  out += " " + a.pop() + ":" + a.shift() + ":" + a.unshift(9, 8) + ":" + a.join();
  out += " " + a.slice(1).join() + "|" + a.slice(-2).join() + "|" + a.slice(1, -1).join() + "|" + a.slice(5).length;
  const removed = a.splice(1, 2, "x", "y", "z");
  out += " " + removed.join() + ":" + a.join() + ":" + a.splice(-1).join() + ":" + a.join();
  out += " " + a.indexOf("y") + ":" + a.indexOf("q") + ":" + a.includes("x") + ":" + list(NaN).includes(NaN) + ":" + list(NaN).indexOf(NaN) + ":" + list(1, 2, 1).lastIndexOf(1);
  const nums = list(5, 3, 8, 1);
  out += " " + nums.map(function (v, i) { return v * 10 + i; }).join() + ":" + nums.filter(function (v) { return v > 2; }).join();
  out += ":" + nums.some(function (v) { return v > 7; }) + ":" + nums.every(function (v) { return v > 0; }) + ":" + nums.find(function (v) { return v < 4; }) + ":" + nums.findIndex(function (v) { return v === 8; });
  let seen = "";
  nums.forEach(function (v, i, arr) { seen += v + "/" + i + "/" + arr.length + ";"; });
  out += " " + seen;
  out += " " + nums.reduce(function (s, v) { return s + v; }) + ":" + nums.reduce(function (s, v) { return s + v; }, 100) + ":" + list().reduce(function (s, v) { return s + v; }, "init");
  out += " " + list(1, list(2, 3)).concat(list(4), 5, list(list(6))).length + ":" + list(1, 2, 3).reverse().join() + ":" + list(1, 2, 3, 4).fill(0, 1, 3).join();
  out += " " + list(3, 1, 10, 2).sort().join() + ":" + list(3, 1, 10, 2).sort(function (x, y) { return x - y; }).join() + ":" + list("b", undefined, "a").sort().join();
  const recs = list({ k: 2, n: "a" }, { k: 1, n: "b" }, { k: 2, n: "c" }, { k: 1, n: "d" });
  out += " " + recs.sort(function (x, y) { return x.k - y.k; }).map(function (r) { return r.n; }).join("");
  out += " " + list(null, undefined, 1).join("+") + ":" + String(list(1, list(2, 3)));
  let threw = "no";
  try { list().reduce(function (s, v) { return s + v; }); } catch (e) { threw = "yes"; }
  return out + " " + threw + " " + "abc".toUpperCase() + "abcdef".slice(2, 4) + "a,b".split(",").length;
}
