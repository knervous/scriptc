// @native-only: engine dyn refuses member reads of a typed function value (name, length) at run time
// Compiled functions carry their own name, length and (for ordinary
// functions only) prototype; arrows and methods are not constructors.
import { probe } from "./js-function-own-props-helper.js";
console.log(probe());
