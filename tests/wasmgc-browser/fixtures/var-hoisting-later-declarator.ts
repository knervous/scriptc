// A `var` read by a later declarator of its own statement is stored by then (react-dom-src's mediaEventTypes);
// a read before the statement still sees undefined.
import { before, report } from "./var-hoisting-later-declarator-helper.js";
console.log(before, report);
