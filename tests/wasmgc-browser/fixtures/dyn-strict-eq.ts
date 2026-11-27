// Strict equality between untyped values: undefined only equals undefined,
// null boxes equal each other, strings by content, numbers by value (NaN,
// +-0), booleans by value, compiled references by identity, page values by
// the host's ===, and every mixed pair is unequal.
// @hits(native,native-any): ^\$dyn\.strictEq$
// @hits(native,native-any): ^\$dyn\.strictEq\.ne\.cold$
// @hits(native,native-any): ^\$dyn\.strictEq\.slow\.cold$
import { grid, values } from "./dyn-strict-eq-helper.js";
const h: any = globalThis;
const page = h.auditMake();
console.log(grid(values(page, h.auditIdentity(page), h.auditBigInt(), h.auditBigInt())));
