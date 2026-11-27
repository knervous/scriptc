/** @type {any} */
var P = Promise;
var AE = AggregateError, EC = Error, TC = TypeError;
export function run() {
  var log = [], inner = new Error("inner");
  var e = new AE([1, 2, inner], "multi", { cause: "c" });
  log.push(e.name, e.message, e.errors.length, Array.isArray(e.errors), e.errors[2] === inner, e.cause, e instanceof AE, e instanceof EC, e instanceof TC);
  log.push(Object.prototype.hasOwnProperty.call(e, "errors"), Object.prototype.propertyIsEnumerable.call(e, "errors"), "errors" in e, Object.keys(e).length, String(e));
  log.push(Object.getPrototypeOf(e) === AE.prototype, Object.getPrototypeOf(AE.prototype) === EC.prototype, AE.prototype.name, typeof AE.prototype.toString);
  var viaCall = AE(new Set([4, 5]), undefined); log.push(viaCall.errors.join(), viaCall.message === "", Object.prototype.hasOwnProperty.call(viaCall, "message"));
  P.any([P.reject(1), P.reject(2), P.reject(3)]).catch(function (err) { log.push("any:" + (err instanceof AE) + "," + err.name + "," + err.message + "," + err.errors.join()); });
  P.any([P.reject("a"), P.resolve("b")]).then(function (v) { log.push("any-ok:" + v); });
  P.any([]).catch(function (err) { log.push("any-empty:" + err.errors.length + "," + err.message); });
  return P.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () { return log.join("|"); });
}
