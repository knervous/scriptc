// Regression (a9083d09 corpus): Object.getOwnPropertyDescriptor on a sealed/frozen native array answered configurable/writable true (native-array-integrity.js).
import { run } from './w9-array-integrity-descriptors-helper.js';
console.log(run());
