// @native-only: engine dyn fences Symbol() (sym.new); the copy under test is the native model's
// Regression (a9083d09 corpus): Object.assign dropped symbol-keyed properties of compiled objects (function-object-assign.js).
import { run } from './w9-assign-symbol-keys-helper.js';
console.log(run());
