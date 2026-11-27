// Page builtins read off the page's objects (lodash: objectProto.hasOwnProperty) are the
// module's own native closures: same identity as the direct spelling, same answers as the page's.
var pageHas = Object.getPrototypeOf({}).hasOwnProperty, pageIs = globalThis.Object.is;
function F() {} F.prototype.inherited = 1;
export function run() {
  var f = new F(); f.own = 2;
  var arr = [1, , 3], fn = function named(a, b) {}, m = new Map(); m.set("k", 1);
  var cases = [[{ a: 1 }, "a"], [{ a: 1 }, "b"], [f, "own"], [f, "inherited"], [arr, "0"], [arr, "1"], [arr, "length"], [arr, 2],
    ["str", "length"], ["str", 1], ["str", "x"], [fn, "name"], [fn, "length"], [fn, "prototype"], [m, "k"], [5, "x"], [true, "x"]];
  var out = [pageHas === Object.prototype.hasOwnProperty, pageIs === Object.is, pageIs(NaN, NaN), pageIs(0, -0)];
  for (var i = 0; i < cases.length; i++) out.push(pageHas.call(cases[i][0], cases[i][1]));
  try { pageHas.call(null, "x"); out.push("no throw"); } catch (e) { out.push(e instanceof TypeError); }
  var s = Symbol("q");
  out.push(typeof s, s.description, Object.prototype.toString.call(Promise.resolve(1)));
  return out.join(",");
}
