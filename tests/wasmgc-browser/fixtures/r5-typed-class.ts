import { readClass } from './r5-helper.js';
class Holder { n = 7; }
console.log(readClass(new Holder()));
