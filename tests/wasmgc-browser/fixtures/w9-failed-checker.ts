// Regression (a9083d09): a refused $dyncheck helper stayed registered, so a second
// request from another function called a function never added (invalid module).
import { run } from './w9-failed-checker-helper.js';
console.log(run([].length > 0));
