// Regression (formerly a known defect): a compiled array used as a computed key is its ToString ("1,2") in the native lanes.
// @native-only: engine dyn refuses this computed key at compile time (SC1090)
import { arrayKey } from './defect-dyn-array-computed-key-helper.js';
console.log(arrayKey());
