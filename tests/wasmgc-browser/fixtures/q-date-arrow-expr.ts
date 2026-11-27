// @options: {"hostHandles": true}
// An arrow function whose EXPRESSION body is `new g.Date(5)` (g = globalThis as any) returns the construction, as the block form does.
const g = globalThis as any;
const expr = (): unknown => new g.Date(5);
const block = (): unknown => { return new g.Date(5); };
const a = expr() as any, b = block() as any;
console.log(a.getTime(), b.getTime(), a instanceof g.Date, typeof a);
const viaAny = (): any => new g.Date(7);
console.log(viaAny().getTime());
const arr = [1, 2].map((n): unknown => new g.Date(n * 10));
console.log(arr.length, (arr[1] as any).getTime());
