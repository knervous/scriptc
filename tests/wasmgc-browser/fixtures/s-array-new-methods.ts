// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled arrays meet the page only in the native any model
// Array.prototype.at / with / toReversed / toSorted / toSpliced / findLast / findLastIndex / reduceRight / flat / flatMap / copyWithin, compiled, spec-exact.
import { run } from './s-array-new-methods-helper.js';
console.log(run());
