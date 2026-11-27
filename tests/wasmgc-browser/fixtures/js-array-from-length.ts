// @hits(native,native-any): dyn\.arr\.fromLength$
// @known-defect(engine): Array.from({ length }) in JS throws "undefined is not a function" (%builtin.Array.fromDirect drives the array-like through the iterator protocol)
// Array.from({ length }) in untyped JS builds a native dyn array directly.
import { report } from "./js-array-from-length-helper.js";
console.log(report());
