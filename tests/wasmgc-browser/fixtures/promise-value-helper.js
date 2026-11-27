// react-dom's shapes: localPromise = "function" === typeof Promise ? Promise : void 0; localPromise.resolve(null).then(cb); new Promise(function (resolve, reject) {...}).
// (The constructor is used through an untyped binding, so every call is a dyn call on the compiled constructor value.)
/** @type {any} */
var P = "function" === typeof Promise ? Promise : void 0;
var log = [];
export function run() {
  log.push(typeof P, P === Promise);
  P.resolve(null).then(function (v) { log.push("microtask:" + v); });
  var p = new P(function (resolve, reject) { log.push("executor"); resolve(5); });
  p.then(function (v) { log.push("then:" + v); return v + 1; }).then(function (v) { log.push("chain:" + v); });
  new P(function (resolve, reject) { reject(new Error("boom")); }).catch(function (e) { log.push("caught:" + e.message); }).finally(function () { log.push("finally"); });
  new P(function () { throw new TypeError("thrown"); }).then(null, function (e) { log.push("rejected:" + e.name); });
  P.reject(7).then(function () { log.push("no"); }, function (r) { log.push("reject:" + r); });
  P.all([1, P.resolve(2), new P(function (r) { r(3); })]).then(function (v) { log.push("all:" + v.join()); });
  P.allSettled([P.resolve(1), P.reject(2)]).then(function (v) { log.push("settled:" + v.map(function (x) { return x.status; }).join()); });
  P.race([new P(function () {}), P.resolve("fast")]).then(function (v) { log.push("race:" + v); });
  P.all([]).then(function (v) { log.push("empty:" + v.length); });
  var thenable = { then: function (res) { res("thenable"); } };
  P.resolve(thenable).then(function (v) { log.push("adopted:" + v); });
  log.push("sync-end", p instanceof P, P.resolve(p) === p);
  return P.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {}).then(function () { return log.join("|"); });
}
