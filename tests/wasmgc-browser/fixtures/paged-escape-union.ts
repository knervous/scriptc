// A closure returned through a union, called from untyped code with a page object.
interface EscD { n: number; }
function pick(flag: boolean): ((a: EscD) => number) | string { return flag ? (a: EscD) => a.n + 40 : "none"; }
const page: any = globalThis;
const u: any = pick(true);
console.log(u(page.auditMake()), pick(false));
