/** @type {any} */
var P = Promise;
export function run() {
  var log = [], p = P.resolve(3), proto = P.prototype;
  log.push(Object.getPrototypeOf(p) === proto, proto.constructor === P, Object.prototype.toString.call(p), Object.prototype.toString.call(proto), typeof proto.then, typeof proto.catch, typeof proto.finally);
  log.push(proto.isPrototypeOf(p), Object.getPrototypeOf(new P(function () {})) === proto);
  try { proto.then.call({}, function () {}); log.push("no"); } catch (e) { log.push(e.name); }
  try { proto.catch.call(5); log.push("no"); } catch (e) { log.push(e.name); }
  var viaCall = proto.then.call(p, function (v) { log.push("then.call:" + v); return v * 2; });
  viaCall.then(function (v) { log.push("chained:" + v); });
  proto.catch.call(P.reject(new Error("x")), function (e) { log.push("catch.call:" + e.message); });
  proto.finally.call(p, function () { log.push("finally.call"); });
  log.push("sync");
  return P.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () { return log.join("|"); });
}
