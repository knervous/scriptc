type P = { n: number };
const h: any = globalThis;
const o: P = h.auditMake();
o.n = 3;
console.log(o.n, h.auditMadeN());
