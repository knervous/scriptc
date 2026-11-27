export function ctors(num, bool, str, fn, plain, arr, map, set) {
  return [num.constructor === Number, bool.constructor === Boolean, str.constructor === String, fn.constructor === Function, plain.constructor === Object, arr.constructor === Array,
    map.constructor === Map, set.constructor === Set, num.constructor.name, str.constructor.name, fn.constructor.name, typeof String, String === str.constructor, Number(" 42 "), Boolean(""), String(12)];
}
export function protos(plain, arr, map, set) {
  var OP = Object.getPrototypeOf(plain);
  return [OP === Object.prototype, Object.getPrototypeOf(OP) === null, plain.__proto__ === Object.prototype, OP.constructor === Object, typeof OP.hasOwnProperty, OP.hasOwnProperty.call(plain, "a"),
    Object.getPrototypeOf(arr) === Array.prototype, Object.getPrototypeOf(map) === Map.prototype, Object.getPrototypeOf(set) === Set.prototype, map.__proto__ === Map.prototype,
    Map.prototype.constructor === Map, Set.prototype.constructor === Set, typeof Map.prototype.get, Map.prototype[Symbol.iterator] === Map.prototype.entries, Set.prototype.keys === Set.prototype.values,
    Object.prototype.valueOf.call(plain) === plain, Object.prototype.propertyIsEnumerable.call(plain, "a"), Object.prototype.toString.call(arr)];
}
