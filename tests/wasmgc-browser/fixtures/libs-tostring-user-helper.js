// toString() is an ordinary method call: an expando or class method may
// return anything; builtins dispatch by kind.
var util = {}; (function (u) { u.toString = (m) => typeof m == "string" ? m : m?.message; u.valueOf = () => 41; })(util);
class Plain { toString() { return "plain!"; } }
class Odd { toString() { return 42; } }
function str(x) { return x.toString(); }
function str2(x, r) { return x.toString(r); }
export function run() {
  return [String(util.toString(undefined)), util.toString("s"), util.toString({ message: "m" }), util.valueOf() === 41,
    str(5), str2(255, 16), str("abc"), str(true), str([1, 2]), str({}), str(new Plain()), typeof str(new Odd()), str(new Error("e"))].join("|");
}
