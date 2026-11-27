// Cached add transitions at property-write sites stay exact under prototype
// setters, prototype changes, getter-only inherited keys, growth and dictionaries.
// @hits(native,native-any): ^\$obj\.setIC$
import { transitions } from './shape-transitions-helper.js';
console.log(transitions());
