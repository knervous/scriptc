// Character reads of untyped strings (`s[i]`): values, comparisons, keys and out-of-range reads.
// @hits(native,native-any): ^\$dyn\.str\.char$
import { chars } from './alloc-string-chars-helper.js';
console.log(chars());
