// Regression (a9083d09): `arr.length = -1` on a native dyn array trapped (array element access out of bounds) instead of throwing a RangeError.
import { run } from './w9-dyn-array-length-range-helper.js';
console.log(run());
