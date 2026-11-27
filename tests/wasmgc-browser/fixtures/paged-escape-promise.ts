// A closure carried by a promise handed to untyped code.
interface EscG { n: number; }
const page: any = globalThis;
const p: any = Promise.resolve((a: EscG): number => a.n + 2);
p.then((f: any) => console.log(f(page.auditMake())));
