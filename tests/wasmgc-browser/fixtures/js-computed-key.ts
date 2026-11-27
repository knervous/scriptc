// @native-only: engine object literals write computed __proto__ through assignment instead of defining an own property
import { report } from './js-computed-key-helper.js';
console.log(report());
