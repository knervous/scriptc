// @native-any-only: class values and typed functions held by `any` (the other lanes refuse a class value in any)
class K { v = 1; }
const add = (a: number, b: number): number => a + b;
const greet = (s: string): string => "hi " + s;
const thunk = (): void => {};
function call2(f: any, a: any, b: any): any { return typeof f === "function" ? f(a, b) : "not a function"; }
console.log(call2(add, 1, 2), call2(greet, "x", 0), call2(thunk, 0, 0), call2(null, 0, 0), call2(5, 0, 0));
console.log(typeof add, typeof greet, typeof K, typeof (class {}), typeof Math.max);
console.log([1, 2, 3].map((x) => add(x, 1)).join());
const holder: Record<string, any> = { a: add, b: greet, c: K, d: 1 };
console.log(Object.keys(holder).map((k) => typeof holder[k]).join(","));
console.log(new holder.c().v, holder.a(2, 3), holder.b("z"));
const asFns: ((n: number) => number)[] = [(n) => n * 2, (n) => n + 1];
console.log(asFns.map((f) => f(5)).join(), asFns[0] === asFns[0], asFns[0] === asFns[1]);
