const h: any = globalThis;
const xs: number[] = [1, 2];
h.auditKeep(xs);
h.auditPush(xs);
console.log(xs.length, h.auditKept() === xs);
