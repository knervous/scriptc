// A closure in a class field of an instance converted to any, called from
// untyped code with a page object.
interface EscC { n: number; }
class EscHolder { f = (a: EscC): number => a.n * 3; }
const page: any = globalThis;
const x: any = new EscHolder();
console.log(x.f(page.auditMake()));
