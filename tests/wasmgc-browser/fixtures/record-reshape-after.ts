export {};
type P = { n: number; s: string };
const h: any = globalThis;
const a: P = { n: 1, s: "x" };
h.auditDelete(a);
console.log(a.n, a.s, Object.keys(a).join(","));
const b: P = { n: 2, s: "y" };
h.auditFreeze(b);
try { b.n = 5; console.log("wrote", b.n); } catch (e) { console.log("frozen write threw"); }
console.log(b.n, h.auditIs2(b, b));
