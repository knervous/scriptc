// `let x = a; x++` in untyped JS: the local stays dynamic until the
// increment applies ToNumeric (strings, null, undefined, booleans, arrays).
import { report } from "./js-increment-helper.js";
const text: string = report();
console.log(text);
