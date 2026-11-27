// @options: {"hostHandles": true}
const g = globalThis as any;
const a: () => unknown = () => new g.Date(5);
const b: () => unknown = () => { return new g.Date(6); };
console.log((a() as any).getTime(), (b() as any).getTime());
function run(f: () => unknown): unknown { return f(); }
console.log((run(() => new g.Date(8)) as any).getTime());
const c: () => unknown = () => g.Math.max(1, 2);
console.log(c(), typeof (() => g.Date)());
