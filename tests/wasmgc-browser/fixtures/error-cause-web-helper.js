/** @type {any} */
var g = globalThis;
export function run() {
  var e = new TypeError("t", { cause: 9 }), none = new TypeError("n");
  var d = g.Object.getOwnPropertyDescriptor(e, "cause");
  var out = [d.value, d.enumerable, d.writable, d.configurable, g.Object.getOwnPropertyDescriptor(none, "cause") === undefined];
  var page = new g.RangeError("p", { cause: e });
  out.push(page.cause === e, page.cause.cause, g.Object.prototype.hasOwnProperty.call(e, "cause"));
  return out.join("|");
}
