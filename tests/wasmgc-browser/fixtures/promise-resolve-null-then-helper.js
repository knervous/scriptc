// react-dom's scheduleMicrotask: a TYPED binding of the Promise constructor (not `any`), resolve(null).then(cb).catch(h).
const localPromise = typeof Promise === "function" ? Promise : undefined;
const log = [];
export function run() {
  localPromise.resolve(null).then(function (v) { log.push("then " + v); }).catch(function (e) { log.push("catch " + e); });
  localPromise.resolve(undefined).then(function (v) { log.push("then2 " + v); });
  localPromise.resolve(3).then(function (v) { log.push("then3 " + v); });
  return localPromise.resolve(0).then(function () { return 0; }).then(function () { return 0; }).then(function () { return 0; }).then(function () { return log.join("|"); });
}
