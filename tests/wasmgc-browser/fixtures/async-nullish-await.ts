// `a ?? await b` (and `a && await b`) in untyped code: the await runs only when JS evaluates its operand, and the
// statement's value is the operand JS picks.
// @ts-ignore: an untyped helper
import { open } from "./async-nullish-await-helper.js";
open(undefined).then((v: any) => console.log("a", v));
open({ device: { id: 1 }, other: { id: 2 }, flag: true }).then((v: any) => console.log("b", v));
