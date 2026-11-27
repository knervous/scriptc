// @native-any-only: a function with trailing optional unknown/any parameters is assignable to a function type taking fewer (the omitted ones are undefined).
let impl = function (fn: (a: unknown) => unknown, a: unknown): unknown { return fn(a); };
function batched(fn: (a: unknown) => unknown, a: unknown): unknown { return impl(fn, a); }
const twice = (x: unknown, y?: unknown): unknown => (x as number) * 2 + (y === undefined ? 0 : 1);
const g: (x: unknown) => unknown = twice;
const withAny = (x: number, extra?: any): string => x + ":" + typeof extra;
const h: (x: number) => string = withAny;
console.log(g(4), batched((v) => (v as number) + 1, 1), batched(twice, 5), h(3));
impl = (fn, a, b?: unknown) => fn(a) + ":" + typeof b;
console.log(batched((v) => v, "x"));
