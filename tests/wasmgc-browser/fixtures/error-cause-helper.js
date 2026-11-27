// InstallErrorCause: an own, non-enumerable data `cause`, present only when the options object has a `cause` property.
var Ctors = [Error, TypeError, RangeError];
function describe(e) {
  return [e.cause, "cause" in e, Object.prototype.hasOwnProperty.call(e, "cause"), Object.prototype.propertyIsEnumerable.call(e, "cause"), Object.keys(e).length].join(",");
}
export function run() {
  var out = [], inner = new Error("inner");
  out.push(describe(new Error("a", { cause: 7 })));
  out.push(describe(new Error("a", { cause: undefined })));
  out.push(describe(new Error("a", {})));
  /** @type {any} */ var five = 5; out.push(describe(new Error("a", five)));
  out.push(describe(new Error("a")));
  out.push(describe(new Ctors[1]("b", { cause: "c" })));
  out.push(describe(Ctors[2]("c", { cause: null })));
  out.push(new Ctors[0]("d", { cause: inner }).cause === inner);
  var e = new Ctors[0]("f", { cause: 1 }); e.cause = 2; out.push(e.cause);
  return out.join("|");
}
