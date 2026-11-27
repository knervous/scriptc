// Regression (a9083d09): Object.keys(null) / Object.entries(undefined) on untyped values returned instead of throwing a TypeError.
import { run } from './w9-object-keys-nullish-helper.js';
console.log(run(null));
