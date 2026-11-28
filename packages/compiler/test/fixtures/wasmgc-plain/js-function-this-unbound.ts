// The plain WasmGC lane passes no receiver: a JavaScript function that never reads `this` compiles and runs (its own
// `this` binding is undefined there), where it made an invalid module before.
import { label, twice } from "./js-function-this-unbound-helper.js";

console.log(twice(21), label(4));
