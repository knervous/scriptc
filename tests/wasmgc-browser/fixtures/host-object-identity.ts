type P = { n: number; label: string };
const h: any = globalThis;
function bump(p: P): P { p.n = p.n + 1; return p; }
const o: P = h.auditMake2();
const same = bump(o);
h.auditTouch(o);
const copy = { ...o };
console.log(o.n, same.n, h.auditIs(same), copy.n, copy.label, h.auditIs(copy));
