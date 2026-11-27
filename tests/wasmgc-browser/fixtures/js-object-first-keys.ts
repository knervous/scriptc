// @hits(native, native-any): \$shape\.rootKids\.set
// Objects built from an empty object literal by computed and constant keys.
import { build, same } from "./js-object-first-keys-helper.js";
console.log(build(300), build(300), same(), same());
