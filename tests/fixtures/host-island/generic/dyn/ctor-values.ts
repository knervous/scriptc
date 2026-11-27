// Builtin constructors read as values on the native host (dyn.arrayConstructorValue, objectConstructorValue,
// symbolConstructorValue, constructorStatics, builtinFunction "Object.is"): from JavaScript (lib/ctor-values.js) and
// TypeScript's primitive constructors handed to untyped code.
import { arrays, kinds, objects, symbols } from "./lib/ctor-values.js";
console.log(kinds());
console.log(arrays([1, 2], {}));
console.log(objects({ a: 1, b: 2 }));
console.log(symbols());
function numbers(N: any, S: any): string {
  return [typeof N, N.name, N.isInteger(5), N.isInteger(5.5), N.MAX_SAFE_INTEGER, N.parseFloat("2.5"), N.EPSILON > 0,
    typeof S, S.name, S.fromCharCode(72, 105), S(42), N("7") + 1].join(" ");
}
console.log(numbers(Number, String));
function same(is: any): string { return [is(1, 1), is("a", "b"), is(NaN, NaN)].join(" "); }
console.log(same(Object.is));
