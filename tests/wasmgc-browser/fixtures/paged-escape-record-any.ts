// A record holding a closure converted to any (untyped code reads the field and calls it).
interface EscH { n: number; }
interface EscHBox { run: (a: EscH) => number; }
const page: any = globalThis;
const box: EscHBox = { run: (a) => a.n + 100 };
const any: any = box;
console.log(any.run(page.auditMake()));
