// @native-any-only: a rest parameter annotated `any` (not `any[]`) takes the surplus arguments as a dynamic array.
function shim(...args: any): never { throw new Error("shim " + args.length); }
function sum(...args: any): number { let n = 0; for (const a of args) n += a; return n; }
function first(a: number, ...rest: any): string { return a + ":" + rest.join("|"); }
try { shim(1, 2); } catch (e) { console.log((e as Error).message); }
console.log(sum(), sum(1, 2, 3), first(1), first(1, "x", 2));
const f: (...args: any) => number = sum;
console.log(f(4, 5));
