// instanceof against builtin constructors on untyped values: compiled
// values answer by kind and prototype chain, page values in the page.
function kinds(v) { return [v instanceof Object, v instanceof Array, v instanceof Function, v instanceof Map, v instanceof Set, v instanceof Promise].map(function (b) { return b ? 1 : 0; }).join(""); }
export function run() {
  var proto = { hello: 1 }, child = Object.create(proto), bare = Object.create(null);
  return [kinds({}), kinds([1]), kinds(function () {}), kinds(new Map()), kinds(new Set()), kinds(Promise.resolve(1)), kinds(1), kinds("s"), kinds(null), kinds(undefined),
    kinds(child), kinds(bare), /a/ instanceof RegExp, ({}) instanceof RegExp].join(",");
}
