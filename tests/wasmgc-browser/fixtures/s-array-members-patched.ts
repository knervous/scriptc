// @native-any-only: the any-typed compiled arrays meet the page only in the native any model
// A compiled dyn array runs the new Array members (at, toSorted, ...) compiled while the page's Array.prototype member is still the engine's own;
// once the page replaces one, that member is the page's (run on the array); restored, the compiled member runs again.
import { probe } from './s-array-members-patched-helper.js';
console.log(probe([3, 1, 2] as any, [[1], [2, [3]]] as any));
