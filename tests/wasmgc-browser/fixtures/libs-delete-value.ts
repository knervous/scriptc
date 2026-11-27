// A value-position delete in strict JavaScript is constant true after the delete (lodash hashDelete:
// `this.has(key) && delete this.__data__[key]`), and Function("return this") boxes a primitive receiver.
import { run } from "./libs-delete-value-helper.js";
console.log(run());
