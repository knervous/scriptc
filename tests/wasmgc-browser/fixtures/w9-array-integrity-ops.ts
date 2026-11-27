// Regression (a9083d09 corpus): sealed/frozen guards refused no-op calls and skipped JS's partial effects (native-array-frozen-noops.js, -splice-*.js, -integrity.js).
import { run } from './w9-array-integrity-ops-helper.js';
console.log(run());
