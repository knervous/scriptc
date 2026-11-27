// Untyped code asking for prototypes and constructors of compiled values.
function isPlainObject(obj) {
  if (typeof obj !== "object" || obj === null) return false;
  let proto = obj;
  while (Object.getPrototypeOf(proto) !== null) proto = Object.getPrototypeOf(proto);
  return Object.getPrototypeOf(obj) === proto;
}
export function probe(tn, tr, tt) {
  const arr = [1], obj = {}, out = [];
  out.push(Object.getPrototypeOf(arr) === Array.prototype, Object.getPrototypeOf(obj) === Object.prototype);
  out.push(Object.getPrototypeOf(tn) === Array.prototype, Object.getPrototypeOf(tr) === Object.prototype, Object.getPrototypeOf(tt) === Array.prototype);
  out.push(arr.constructor === Array, obj.constructor === Object, tn.constructor === Array, tr.constructor === Object, tt.constructor === Array);
  out.push(Object.getPrototypeOf(Array.prototype) === Object.prototype, Object.getPrototypeOf(Object.prototype) === null);
  out.push(Object === globalThis.Object, Array === globalThis.Array, Object !== Array);
  out.push(Array.prototype.isPrototypeOf(arr), Object.prototype.isPrototypeOf(obj));
  out.push([isPlainObject(obj), isPlainObject(arr), isPlainObject(tn), isPlainObject(tr), isPlainObject(tt)].join("/"));
  return out.join(" ");
}
