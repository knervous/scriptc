// ToPrimitive of typed records and typed arrays reaching JavaScript as
// native dyn values, and == against page objects (the host's ==; it used
// to recurse without end).
import { conv, pageEq } from "./audit-js-to-primitive-helper.js";
const h: any = globalThis;
console.log(conv({ a: 1 }));
console.log(conv({ valueOf() { return 9; } }));
console.log(conv({ toString() { return "7"; } }));
console.log(conv([1, 2]));
console.log(conv([4]));
console.log(conv(JSON.parse('{"a":1}')));
console.log(pageEq(h.auditMake()));
