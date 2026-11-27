// Regression (a9083d09): a JS class program whose bridge helpers called an unreachable %dyn.class.properties (invalid module).
import { run } from './w9-class-bridge-reach-helper.js';
console.log(run());
