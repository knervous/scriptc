// @native-any-only: typed functions called through `any` need native any
// Closure calls (typed, through any, bound, captured, rest, recursive, stored in records and arrays) all dispatch through the closure code slots.
function makeAdder(k: number): (x: number) => number { return (x) => x + k; }
const add5 = makeAdder(5), add7 = makeAdder(7);
console.log(add5(1), add7(1), [add5, add7].map((f) => f(10)).join());
function twice(f: (x: number) => number, x: number): number { return f(f(x)); }
console.log(twice(add5, 1), twice((x) => x * 3, 2));
const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
console.log(fact(6));
function sum(...xs: number[]): number { let t = 0; for (const x of xs) t += x; return t; }
console.log(sum(), sum(1, 2, 3), (sum as any)(4, 5));
const rec = { double: (x: number) => x * 2, name: "r" };
console.log(rec.double(4), (rec as any).double(5));
const table: Record<string, (a: number, b: number) => number> = { add: (a, b) => a + b, mul: (a, b) => a * b };
console.log(Object.keys(table).map((k) => table[k]!(3, 4)).join());
function dynCall(f: any, a: any, b: any): any { return f(a, b); }
console.log(dynCall(add5, 10, 0), dynCall(sum, 1, 2), dynCall((s: string) => s + "!", "hey", 0));
class P { v: number; constructor(v: number) { this.v = v; } get(): number { return this.v; } }
const p = new P(9);
const g = p.get;
console.log(g.call(p), (p as any).get(), dynCall(P.prototype.get.bind(p), 0, 0));
const later: (() => void)[] = [];
for (let i = 0; i < 3; i++) later.push(() => console.log("later", i));
later.forEach((f) => f());
Promise.resolve(3).then((x) => x + 1).then((x) => console.log("then", x));
async function asyncSum(a: number, b: number): Promise<number> { await null; return a + b; }
asyncSum(2, 3).then((x) => console.log("async", x));
console.log([1, 2, 3].reduce((a, b) => a + b, 0));
