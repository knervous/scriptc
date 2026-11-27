// @native-any-only: TypeScript `arguments` compiles only under native TS any (other lanes refuse it)
// `arguments` in a TypeScript function value called from untyped code holds
// every actual argument, not just the declared ones.
import { callWith3, mapIt, callMethod } from "./ts-any-arguments-callback-helper.js";
console.log(callWith3(function (a: number) { return a + arguments.length; }));
console.log(mapIt([5, 6], function (x: number) { return x + arguments.length + arguments[1]; }).join(","));
const anyArr: any = [7, 8];
console.log(anyArr.map(function (x: number) { return x * 10 + arguments.length; }).join(","));
console.log(callMethod({ m(a: number) { return a + arguments.length; } }));
