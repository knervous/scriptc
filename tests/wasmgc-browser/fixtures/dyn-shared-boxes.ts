// Shared dyn boxes (constants, small integers, booleans, atom-name keys) are
// unobservable: -0, NaN, Map/Set keys, booleans and fresh key arrays.
// @hits(native,native-any): ^\$box\.num$
// @hits(native,native-any): ^\$atoms\.box$
import { boxes } from './dyn-shared-boxes-helper.js';
console.log(boxes(2));
