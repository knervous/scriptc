// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled functions and Function.prototype meet the page only in the native any model
// Function.prototype is a compiled object (call / apply / bind as compiled members of compiled functions).
import { run, f } from './s-function-proto-helper.js';
console.log(run(f as any));
