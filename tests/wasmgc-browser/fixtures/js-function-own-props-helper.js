// A compiled function's own name, length and prototype as JS defines them.
function named(a, b = 1, ...rest) { this.a = a + b + rest.length; }
const arrow = (x, y) => x + y;
const obj = { meth(a) { return a; } };
const set = (o, k, v) => { o[k] = v; }, make = (C, x, y) => new C(x, y);
export function probe() {
  const out = [];
  out.push([named.name, named.length, arrow.name, arrow.length, obj.meth.name, obj.meth.length, (function () {}).name === ""].join(" "));
  out.push(["prototype" in named, "prototype" in arrow, typeof named.prototype, arrow.prototype === undefined, obj.meth.prototype === undefined, named.prototype.constructor === named].join(" "));
  out.push([named.hasOwnProperty("name"), named.hasOwnProperty("length"), named.hasOwnProperty("prototype"), arrow.hasOwnProperty("prototype"), "name" in arrow, Object.keys(named.prototype).length].join(" "));
  named.extra = 5;
  out.push(Object.keys(named).join(","));
  let w = ""; try { set(named, "name", "x"); } catch (e) { w = e.name; }
  out.push(w + " " + named.name);
  let c = ""; try { make(arrow, 1, 2); } catch (e) { c = e.name; }
  out.push(c);
  const inst = new named(7);
  out.push([inst.a, Object.getPrototypeOf(inst) === named.prototype].join(" "));
  return out.join("\n");
}
