type P = { n: number; tag: string };
const h: any = globalThis;
const r: P = { n: 1, tag: "a" };
const back: P = h.auditIdentity(r);
back.n = 5;
console.log(r.n, back === r, h.auditKeys(r));
