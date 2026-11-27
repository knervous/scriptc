const a = new Float64Array([1.5, 2]);
const v = a[5];
console.log(v, `${a[7]}`, String(a[9]), a[1], a[3] + 1, (a[4] as number | undefined) === undefined, typeof a[6]);
let s = 0;
for (let i = 0; i < a.length; i++) s += a[i];
console.log(s, a[0] | 0, a[8] | 0, Math.fround(a[8]));
const h: any = globalThis; h.auditKeep(a[10]); console.log(h.auditKept() === undefined);
