// Runtime-interned keys through the intern cache: colliding slots, for-in
// keys, index-like keys, and computed writes to a page object.
// @hits(native,native-any): ^\$dyn\.setKeyStr$
import { keys } from './dyn-key-intern-helper.js';
const page: any = globalThis;
console.log(keys(2, page));
