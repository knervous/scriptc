// Error.prepareStackTrace from compiled JavaScript addresses the page's Error.
import { stackHook } from './r4-typed-helper.js';
console.log(stackHook());
