// Regression (a9083d09): strIntrinsic slice evaluated its end expression twice (valueOf ran twice: silent wrong side effects).
import { run } from './w9-string-slice-end-once-helper.js';
console.log(run());
