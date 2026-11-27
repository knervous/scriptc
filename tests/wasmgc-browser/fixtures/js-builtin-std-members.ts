// @hits(native,native-any): \$dyn\.builtinStd
// Untyped reads of non-standard names on arrays and functions are undefined
// without a page lookup; standard Array/Function.prototype members are the
// page's own (js-builtin-std-members-helper.js).
import { make, probe } from "./js-builtin-std-members-helper.js";
const typed: number[] = [3, 4, 5];
console.log(probe(make(), typed));
