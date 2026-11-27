// Error.prototype chains: TypeError.prototype -> Error.prototype -> Object.prototype, with name, message and toString.
var Ctors = [Error, TypeError, RangeError];
export function run() {
  var out = [], T = Ctors[1], R = Ctors[2], E = Ctors[0];
  var t = new T("bad"), r = new R("range"), e = new E("plain");
  out.push(Object.getPrototypeOf(t) === T.prototype, Object.getPrototypeOf(r) === R.prototype, Object.getPrototypeOf(e) === E.prototype);
  out.push(Object.getPrototypeOf(T.prototype) === E.prototype, Object.getPrototypeOf(E.prototype) === Object.prototype, Object.getPrototypeOf(R.prototype) === E.prototype);
  out.push(T.prototype.isPrototypeOf(t), E.prototype.isPrototypeOf(t), R.prototype.isPrototypeOf(t), T.prototype.isPrototypeOf(e), Object.prototype.isPrototypeOf.call(Object.prototype, t));
  out.push(T.prototype.name, T.prototype.message === "", E.prototype.name, typeof E.prototype.toString, T.prototype.constructor === T, E.prototype.constructor === E);
  out.push(String(t), t.toString(), E.prototype.toString.call({ name: "N", message: "m" }), E.prototype.toString.call({}), E.prototype.toString.call({ name: "", message: "only" }), E.prototype.toString.call({ name: "OnlyName", message: "" }));
  out.push(t instanceof T, t instanceof E, t instanceof R, Object.prototype.hasOwnProperty.call(T.prototype, "name"), Object.prototype.hasOwnProperty.call(T.prototype, "toString"));
  return out.join("|");
}
