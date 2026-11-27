// @options: {"hostHandles": true}
// @native-any-only: the any-typed Sets and set-like arguments meet the page only in the native any model
// ES2025 Set methods (union, intersection, difference, symmetricDifference, isSubsetOf, isSupersetOf, isDisjointFrom), compiled, GetSetRecord semantics.
import { run, mkNative } from './s-set-methods-helper.js';
console.log(run(mkNative));
const typed = (arr: number[]): any => new Set<number>(arr);
console.log(run(typed));
