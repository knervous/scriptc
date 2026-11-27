// instanceof against every builtin made a compiled value (Map, Set, WeakMap, WeakSet, Promise, the Error family, AggregateError), with compiled
// and page left-hand sides, and against the names that are decided by kind (Object, Array, Function). The native host has no page globals for these.
/** @type {any} */
var g = globalThis;
/** @type {any} */
var P = Promise;
/** @type {any} */
var AE = AggregateError;
/** @type {any} */
var rhs = { Map: Map, Set: Set, WeakMap: WeakMap, WeakSet: WeakSet, Promise: P, Error: Error, TypeError: TypeError, RangeError: RangeError, SyntaxError: SyntaxError, ReferenceError: ReferenceError, EvalError: EvalError, URIError: URIError, AggregateError: AggregateError };
/** @type {any[]} */
var lefts = [
  ["Map", new Map()], ["Set", new Set()], ["WeakMap", new WeakMap()], ["WeakSet", new WeakSet()], ["Promise", P.resolve(1)],
  ["Error", new Error("e")], ["TypeError", new TypeError("t")], ["RangeError", new RangeError("r")], ["SyntaxError", new SyntaxError("s")],
  ["ReferenceError", new ReferenceError("f")], ["EvalError", new EvalError("v")], ["URIError", new URIError("u")], ["AggregateError", new AE([], "a")],
  ["object", {}], ["array", [1]], ["function", function () {}], ["number", 5], ["string", "s"], ["null", null], ["undefined", undefined],
];
/** @type {any} */ var nul = null, und = undefined;
/** @param {any} a @param {any} b */
function inst(a, b) { return a instanceof b; }
export function run() {
  var rows = [];
  for (var i = 0; i < lefts.length; i++) {
    var cells = [];
    for (var name in rhs) cells.push(lefts[i][1] instanceof rhs[name] ? 1 : 0);
    rows.push(lefts[i][0] + ":" + cells.join(""));
  }
  var names = [lefts[13][1] instanceof Object, lefts[14][1] instanceof Array, lefts[15][1] instanceof Function, lefts[14][1] instanceof Object, lefts[5][1] instanceof Object, lefts[0][1] instanceof Object, lefts[4][1] instanceof Object, lefts[17][1] instanceof Object, lefts[13][1] instanceof Array].map(function (b) { return b ? 1 : 0; }).join("");
  var errs = [];
  var pageErr = new g.TypeError("page");
  errs.push(pageErr instanceof TypeError ? 1 : 0, pageErr instanceof Error ? 1 : 0, pageErr instanceof RangeError ? 1 : 0);
  try {  errs.push(inst({}, {}) ? 1 : 0); } catch (e) { errs.push(e.name); }
  try { errs.push(inst({}, nul) ? 1 : 0); } catch (e) { errs.push(e.name); }
  try { errs.push(inst({}, und) ? 1 : 0); } catch (e) { errs.push(e.name); }
  try { errs.push(inst(pageErr, nul) ? 1 : 0); } catch (e) { errs.push(e.name); }
  try { errs.push(inst(pageErr, und) ? 1 : 0); } catch (e) { errs.push(e.name); }
  try { errs.push(inst(pageErr, {}) ? 1 : 0); } catch (e) { errs.push(e.name); }
  return rows.join("\n") + "\n" + names + "\n" + errs.join(",");
}
