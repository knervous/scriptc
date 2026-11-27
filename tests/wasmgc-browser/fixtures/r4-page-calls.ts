// Page code calling compiled functions (the dynCallFromJs contract).
import { pageCallees } from './r4-typed-helper.js';
const h: any = globalThis;
console.log(h.auditCallWith(pageCallees.six, { tag: "T" }, 1, "two", true, null, 5, "six"));
console.log(h.auditCallWith(pageCallees.missing, undefined, "only"));
console.log(h.auditCallWith(pageCallees.missing, undefined));
