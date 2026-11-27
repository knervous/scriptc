// Function own properties read before anything created the function's property object
// (name and length from the function itself, other keys from Function.prototype), and every
// path that creates it afterwards (writes, defineProperty, delete, enumeration, prototype).
// @native-only: native function property objects (the engine lane reads page wrappers and refuses delete)
// @hits(native,native-any): ^\$dyn\.fnGet$
import { run } from "./js-fn-props-lazy-helper.js";
console.log(run());
