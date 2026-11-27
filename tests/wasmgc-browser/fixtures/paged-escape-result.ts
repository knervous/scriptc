// A closure that returns a closure: the returned closure reaches untyped code
// only through the first one's result.
interface EscF { n: number; }
const make = (k: number) => (a: EscF): number => a.n + k;
const page: any = globalThis;
const g: any = make;
console.log(g(5)(page.auditMake()));
