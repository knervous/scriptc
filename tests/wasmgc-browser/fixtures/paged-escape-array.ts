// Closures inside an array converted to any: an array of records holding them.
// (A bare array of closures has no untyped form: a baseline limitation.)
interface EscE { n: number; }
interface EscEItem { run: (a: EscE) => number; }
const items: EscEItem[] = [{ run: (a) => a.n + 10 }];
const page: any = globalThis;
const arr: any = items;
console.log(arr[0].run(page.auditMake()), arr.length);
