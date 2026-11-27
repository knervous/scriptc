var A = Array;
var arr = [1, 2, 3];
export function probe() {
  return [typeof Array, typeof A, A === Array, A.name, A.length, typeof Array.isArray, Array.isArray === A.isArray, Array.from === A.from, Array.of === A.of];
}
export function statics() {
  return [Array.isArray(arr), A.isArray({}), A.from("ab").join(), A.from({ length: 2 }, function (_, i) { return i * 2; }).join(), A.of(7, 8).join(), A.of(3).length, Array.of(1, 2).length];
}
export function ctor() {
  var a = A(3), b = new A(3), c = A(1, 2), d = new A("x"), e = A.apply(null, [4, 5]);
  return [a.length, 0 in a, b.length, c.join(), d.join(), e.join(), Array.isArray(a), a instanceof A, a instanceof Array, [] instanceof A];
}
export function viaConstructor() {
  var x = [].constructor, y = arr.constructor;
  return [x === A, y === Array, x === Object, new y(2).length, y.from(arr).join(), arr.constructor.name, Object.keys(A).length, "from" in A];
}
function threw(f, E) { try { f(); return false; } catch (e) { return e instanceof E; } }
export function bad() {
  return [threw(function () { A(-1); }, RangeError), threw(function () { A.from(1, 2); }, TypeError), threw(function () { new A(1.5); }, RangeError)];
}
