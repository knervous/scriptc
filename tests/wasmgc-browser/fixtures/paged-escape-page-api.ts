// A closure passed straight to a page API, which calls it with a page object.
interface EscB { n: number; tag?: string; }
const page: any = globalThis;
const cb = (a: EscB): number => a.n * 7;
console.log(page.auditCallWith(cb, undefined, page.auditMake()));
