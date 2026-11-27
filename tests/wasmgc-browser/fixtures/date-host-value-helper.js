// A JavaScript source reads Date as a value (the page's / host's Date constructor), constructs through it, and tests against it.
/** @type {any} */
var D = Date;
export function run() {
  var log = [];
  var d = new D(5), e = new D(2020, 1, 3);
  log.push(typeof D, D === Date, d instanceof D, d instanceof Date, d.getTime(), e.getFullYear(), D.UTC(2020, 0, 1), D.parse("2020-01-01T00:00:00Z"), D.name, D.length);
  log.push(typeof D.now(), Object.prototype.toString.call(d), typeof D());
  /** @type {any} */
  var x = d;
  log.push(x instanceof Date, x.toISOString(), JSON.stringify(x), String(x) === d.toString(), +x, x < new D(9));
  return log.join("|");
}
