// ToPropertyKey of computed keys in untyped object literals: strings,
// numbers (including -0, NaN, exponents), booleans, null, undefined,
// and a symbol (the fast paths of js.propertyKey).
import { keyedAll } from './host-property-keys-helper.js';
console.log(keyedAll());
