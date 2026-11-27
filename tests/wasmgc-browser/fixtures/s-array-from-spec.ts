// @options: {"hostHandles": true}
// @native-any-only: the untyped Array.from sources meet the page only in the native any model
// Array.from(items, mapfn, thisArg) per ECMA-262 23.1.2.1 on untyped sources: iterables run the iteration protocol (closing the
// iterator when the mapper throws), array-likes read ToLength(length) then each index, mapper and thisArg checks come first.
import { run } from './s-array-from-spec-helper.js';
console.log(run());
