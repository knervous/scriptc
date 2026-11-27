// Typed records reshaped by the page (a new key, a delete, a defineProperty):
// compiled reads, keys, `in` and writes must agree with what the page sees.
import { inspect, write } from "./audit-record-page-reshape-helper.js";
const page: any = globalThis;
const r = { a: 1, b: "x" };
page.auditMutate(r);
console.log(inspect(r), r.a, r.b);
const s = { a: 2, n: 1 };
page.auditDelete(s);
console.log(inspect(s), s.a);
const t = { a: 3, b: "y" };
page.auditDeleteKey(t, "a");
console.log(inspect(t), t.b);
write(t, "a", 30); write(t, "z", 4);
console.log(inspect(t), page.auditKeys(t), t.a);
const u = { a: 5, n: 2 };
page.auditTouch(u);
console.log(inspect(u), u.n);
