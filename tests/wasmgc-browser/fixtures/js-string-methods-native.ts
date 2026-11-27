// @hits(native,native-any): \$dyn\.str\.indexOf\.1
// @hits(native,native-any): \$dyn\.str\.indexOf\.2
// @hits(native,native-any): \$dyn\.str\.includes\.
// @hits(native,native-any): \$dyn\.str\.slice\.
// @hits(native,native-any): \$dyn\.str\.concat\.
// @hits(native,native-any): ^\$str\.case\.lower$
// String methods on untyped strings compiled over the js-string builtins:
// positions (negative, fractional, NaN, Infinity, undefined), empty strings
// and searches, code units; other argument kinds take the page's own method
// (js-string-methods-native-helper.js).
import { make, probe } from "./js-string-methods-native-helper.js";
console.log(probe(make()));
