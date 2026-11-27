// for-of over compiled (native dyn) arrays: a pristine array iterates natively (length read each
// step, holes undefined, growth and shrinking seen), with break/continue/labels/return/throw,
// per-iteration bindings and destructuring heads; strings, Maps, Sets, custom
// iterables take the iterator protocol, and a `return` added to the array iterator prototype
// mid-loop is called on an early exit (the real iterator, replayed to the loop's position).
// @native-only: native dyn arrays (the engine lane iterates page arrays)
// @hits(native,native-any): ^\$dyn\.arr\.patternAt$
import { basics, control, others, patched } from "./js-for-of-native-array-helper.js";
console.log(basics());
console.log(control());
console.log(others());
console.log(patched());
