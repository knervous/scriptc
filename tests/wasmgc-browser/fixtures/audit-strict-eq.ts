// Strict equality across dyn kinds, in JS and through TS any.
import { pairsEq, searches, sw } from "./audit-strict-eq-helper.js";
const h: any = globalThis;
const page = h.auditMake();
console.log(pairsEq(page, h.auditMake(), h.auditFn(), h.auditSymbol(), h.auditNaNBits()));
console.log(searches());
console.log([0, "0", null, undefined, false, -0, NaN, ""].map(sw).join(","));
const tsEq = (a: any, b: any) => (a === b ? "1" : "0") + (a !== b ? "1" : "0");
const obj: any = { a: 1 };
const sym = h.auditSymbol();
const pairs: any = [[NaN, NaN], [0, -0], ["ab", "a" + "b"], [null, undefined], [undefined, undefined], [true, true], [true, 1], [page, page], [obj, obj], [obj, { a: 1 }], [sym, sym], [1, "1"]];
let out = "";
for (let i = 0; i < pairs.length; i++) out += tsEq(pairs[i][0], pairs[i][1]) + " ";
console.log(out);
