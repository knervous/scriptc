// Relational operators and ++/-- on untyped values (see the helper).
import { loops, cmpAll, cmpNum, incs, values, bigObj } from "./codegen-dyn-compare-helper.js";
console.log(String(loops([1, 2, 3], 5)));
const h: any = globalThis;
const vals: any[] = values(h.auditBigInt());
let out = "";
for (const a of vals) for (const b of vals) { try { out += cmpAll(a, b); } catch (e: any) { out += "E"; } out += " "; }
console.log(out);
let out2 = "";
for (const a of vals) { try { out2 += cmpNum(a); } catch (e: any) { out2 += "E"; } out2 += " "; }
console.log(out2);
const order: string[] = [];
const vo = { valueOf() { order.push("L"); return 1; } }, vo2 = { valueOf() { order.push("R"); return 2; } };
console.log(cmpAll(vo, vo2), order.join(""));
console.log(incs(bigObj(10)));
const o2: any = bigObj(1); o2.v = 2 ** 53; o2.s = "x"; o2.t = [4]; o2.u = 0.5;
console.log(incs(o2));
