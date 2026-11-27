/** @type {any} */
var g = globalThis;
/** @type {any} */
var P = Promise;
export function run() {
  var out = [g.Promise === P, typeof g.Promise, P.resolve === g.Promise.resolve];
  var page = g.Promise.resolve(1), mine = P.resolve(2);
  out.push(page instanceof P, mine instanceof g.Promise, mine instanceof P, new g.Promise(function (r) { r(3); }) instanceof P);
  out.push(g.Object.getPrototypeOf(mine) === g.Promise.prototype, P.prototype === g.Promise.prototype);
  return P.all([page, mine, new P(function (r) { r(3); }), g.Promise.resolve(4)]).then(function (v) { out.push(v.join()); return out.join("|"); });
}
