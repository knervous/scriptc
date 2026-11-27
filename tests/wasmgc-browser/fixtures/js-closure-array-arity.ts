// @known-defect(engine,native,native-any): an array literal of results from a call through a union of closure types (number | void | string returns) is typed string | undefined, so a number element throws a TypeError at run time
// Closures of different arities in one array keep their identity and results when called through it.
import { probe } from "./js-closure-array-arity-helper.js";
console.log(probe());
