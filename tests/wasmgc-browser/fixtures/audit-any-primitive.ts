// @native-only: engine dyn throws "Cannot convert object to primitive value" for compiled Errors (engine Error facades lack toString)
// ToPrimitive, ToNumber and ToString of compiled values held as dyn: typed
// arrays and records (TS literals nested in any, or typed values passed to
// JS), Errors, page values; loose equality and relational operators on them.
import { coerce, pageValues } from "./audit-any-primitive-helper.js";
const t0: any = { n: [7], m: [1, 2], r: { a: 1, b: "x" }, s: "x", e: [] as number[] };
console.log(t0.n * 2, t0.m * 2);
console.log(t0.n + 1, 1 + t0.n, t0.m + "", "" + t0.r);
console.log(`${t0.n}|${t0.m}|${t0.r}|${t0.e}`);
console.log(String(t0.n), String(t0.m), String(t0.r), String(t0.e));
console.log(t0.m.toString(), t0.r.toString(), t0.n.join("-"));
console.log(coerce(t0));
const typed = { n: [7], m: [1, 2], r: { a: 1, b: "x" }, s: "x", e: [] as number[] };
console.log(coerce(typed));
const err = new Error("boom"), bad = new TypeError("bad"), blank = new Error("");
console.log(err.toString(), String(bad), `${blank}|${err}`, err + "!");
console.log(pageValues(globalThis, typed, err));
