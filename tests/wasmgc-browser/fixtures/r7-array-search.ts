// indexOf / lastIndexOf / includes: fromIndex conversion (explicit undefined,
// ±Infinity, strings), empty arrays answering before conversion, and holes
// in typed arrays seen by untyped code.
import { searches, sparseSearch } from './r7-helper.js';
console.log(searches());
const sparse: (number | undefined)[] = [1, , undefined, 1];
console.log(sparseSearch(sparse));
