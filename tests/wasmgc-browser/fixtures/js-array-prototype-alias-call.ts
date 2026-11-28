// A captured Array.prototype method called with .call runs the receiver's own method when it is an array, and the generic
// algorithm on any other receiver.
import { includes, index_of, run } from "./js-array-prototype-alias-call-helper.js";
const typed: number[] = [10, 20, 30];
const x = { k: 1 };
console.log(run(typed, x));
console.log(index_of === Array.prototype.indexOf, includes.call([x], x));
