// A compiled generator returned through a dynamic call is a page iterator: spread, for-of with break, next/return/throw.
import { run } from './generator-dyn-facade-helper.js';
console.log(run());
