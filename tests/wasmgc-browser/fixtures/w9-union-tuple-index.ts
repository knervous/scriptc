// Regression (a9083d09): unionKeyGet with a number key over array arms emitted an
// invalid module, and a union box converted between unions whose arm tags differ
// passed unchanged (2 read back as true).
import { run } from './w9-union-tuple-index-helper.js';
console.log(run());
