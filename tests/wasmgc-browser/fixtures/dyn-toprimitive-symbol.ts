// Symbol.toPrimitive on compiled objects: + asks "default", template literals and String() "string",
// unary plus, arithmetic and < "number"; a non-callable method or an object result is a TypeError.
import { make, run } from "./dyn-toprimitive-symbol-helper.js";
console.log(run(make()));
