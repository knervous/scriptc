// Own-property views of library class instances through untyped values:
// `in` with a constant key, Object.keys/values/entries, hasOwnProperty and
// for-in. A JavaScript class's own properties are the fields it created (in
// creation order, a conditional one only once assigned);
// methods and accessors are inherited, "constructor" and Object.prototype's
// members are inherited too.
class A { constructor(flag) { this.v = 1; if (flag) this.later = "L"; this.s = "s"; } m() { return 2; } get g() { return 3; } }
class B extends A { constructor() { super(false); this.b = [1]; } }
export function run() {
  var out = [];
  var d = JSON.parse("[0, 0, 0]");
  d[0] = new A(false); d[1] = new A(true); d[2] = new B();
  for (var i = 0; i < 3; i++) {
    var x = d[i];
    out.push(("v" in x) + " " + ("later" in x) + " " + ("m" in x) + " " + ("g" in x) + " " + ("constructor" in x) + " " + ("toString" in x) + " " + ("zz" in x));
    out.push(Object.keys(x).join(",") + " " + JSON.stringify(Object.values(x)) + " " + JSON.stringify(Object.entries(x)));
    out.push(Object.prototype.hasOwnProperty.call(x, "v") + " " + Object.prototype.hasOwnProperty.call(x, "later") + " " + Object.prototype.hasOwnProperty.call(x, "m") + " " + Object.hasOwn(x, "s"));
    var ks = []; for (var k in x) ks.push(k); out.push(ks.join(","));
  }
  return out.join("\n");
}
