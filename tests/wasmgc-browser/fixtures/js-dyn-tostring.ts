// toString(radix) and other primitive methods on untyped values: the runtime
// kind dispatches (Number/Boolean prototype on the host, arrays via join).
import { report } from "./js-dyn-tostring-helper.js";
const text: string = report();
console.log(text);
