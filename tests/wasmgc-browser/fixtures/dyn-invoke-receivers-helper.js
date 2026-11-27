// One method-call site per method name and arity, reached by every receiver kind.
export function call0(r) { return r.describe(); }
export function call1(r, a) { return r.describe(a); }
export function call5(r) { return r.describe(1, 2, 3, 4, 5); }
export function slice1(r, a) { return r.slice(a); }
export function toS(r) { return r.toString(); }
export function fixed(r) { return r.toFixed(2); }
export function viaCall(f, self, a) { return f.call(self, a); }
export function viaApply(f, self, a) { return f.apply(self, [a, a]); }
export function viaBind(f, self, a) { return f.bind(self, a)(10); }
export function each(r) { var out = []; r.forEach(function (x, i) { out.push(i + ":" + x); }); return out.join(" "); }
export function caught(fn) { try { return "ok " + fn(); } catch (e) { return e.name + ": " + e.message; } }
export function objects() {
  function Child(name) { this.name = name; }
  Child.prototype.describe = function (a) { return "proto(" + this.name + "," + a + ")"; };
  var child = new Child("child");
  var own = { name: "own", describe: function () { return "own " + arguments.length + " " + Array.prototype.slice.call(arguments).join("+"); } };
  return [own, child, { name: "plain" }];
}
export function show(a, b) { return (this ? this.tag : "none") + ":" + String(a) + ":" + String(b); }
