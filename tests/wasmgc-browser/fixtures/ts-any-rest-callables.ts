// A typed function or class method with a rest parameter, called through TS
// any or from untyped code, packs the trailing arguments into its array
// (the uniform invoker used to check the first trailing argument as the array).
import { callIt } from "./ts-any-rest-callables-helper.js";
const count = (...xs: number[]): number => xs.length;
const tag = (a: string, ...xs: number[]): string => a + ":" + xs.join("+");
const af: any = count, at: any = tag;
console.log(af(), af(1, 2, 3), at("t"), at("u", 1, 2), callIt(count), callIt((...xs: number[]) => xs.reduce((p, q) => p + q, 0)));
class Calc {
  sum(...xs: number[]): number { return xs.reduce((p, q) => p + q, 0); }
  pre(a: string, ...xs: number[]): string { return a + xs.length; }
}
const c: any = new Calc();
console.log(c.sum(1, 2, 3), c.sum(), c.pre("a", 1, 2), c.pre("b"));
