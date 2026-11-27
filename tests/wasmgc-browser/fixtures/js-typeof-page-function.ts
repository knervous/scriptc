// `typeof v === "function"` in JS is true for a page function held in dyn
// (as `typeof v` already says), not only for compiled functions.
import { kinds, callIfFunction } from "./js-typeof-page-function-helper.js";
const h: any = globalThis;
const values: any[] = [h.auditFn(), h.auditIdentity, (x: number) => x + 1, h.auditMake(), h.auditMakeArray(), {}, [], null, undefined, "s", 1];
for (const v of values) console.log(kinds(v));
console.log(callIfFunction(h.auditIdentity, "page"), callIfFunction((x: string) => x + "!", "compiled"), callIfFunction(h.auditMake(), 1));
