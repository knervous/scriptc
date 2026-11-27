// @native-refuses: compiled arrays and functions inherit only the standard Array.prototype / Function.prototype members (as their method calls do, and as compiled objects see only Object.prototype's): names the page adds to those prototypes read undefined; a replaced standard member is still the page's
// @expect-native: undefined undefined undefined false false replaced number 1 undefined
// Members the page adds to builtin prototypes, read through compiled arrays
// and functions (the native-model rule; engine dyn reads the page's).
import { make, probe } from "./js-builtin-proto-additions-helper.js";
console.log(probe(make()));
