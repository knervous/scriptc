// React's createCache shape: a typeof-guarded alias whose fallback is a plain compiled function, then `new alias()`.
var AbortControllerLocal = /** @type {any} */ ("undefined" !== typeof globalThis.NoSuchAbortController ? globalThis.NoSuchAbortController : function () {
  this.signal = { aborted: false };
  this.abort = function () { this.signal.aborted = true; };
});
var PageCtor = /** @type {any} */ ("undefined" !== typeof globalThis.Map ? globalThis.Map : function () {});
var Returns = /** @type {any} */ (function () { this.a = 1; return { replaced: true }; });
var Plain = /** @type {any} */ (function (x, y) { this.sum = x + y; this.twice = function () { return this.sum * 2; }; });
class Klass { constructor(v) { this.v = v; } get double() { return this.v * 2; } }
export function cache() {
  var c = new AbortControllerLocal();
  var d = new AbortControllerLocal();
  c.abort();
  return [c instanceof AbortControllerLocal, typeof c.signal, c.signal.aborted, d.signal.aborted, c.signal === d.signal, Object.keys(c).join()];
}
export function viaPage(holder) {
  holder.Ctor = Plain;
  var p = new holder.Ctor(2, 3);
  return [p.sum, p.twice(), p instanceof Plain, p instanceof holder.Ctor];
}
export function viaArgs(C, a, b) { return new C(a, b); }
export function replaced() { var r = new Returns(); return [r.replaced, r instanceof Returns, r.a]; }
export function klass() { var k = new Klass(21); return [k.v, k.double, k instanceof Klass]; }
export function pageCtor() { var m = new PageCtor([[1, 2]]); return [m.size, m.get(1), m instanceof Map]; }
export function notCtor() { var f = /** @type {any} */ (() => 1); try { new f(); } catch (e) { return e instanceof TypeError; } return false; }
export { Plain };
