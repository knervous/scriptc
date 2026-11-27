// An untyped function stored in a typed function slot stays the same
// function: identity on the way back, and dynamic calls receive every
// argument and their receiver.
import { keep, kept_, same, dynFn, withThis, call3, callOn } from "./js-typed-function-slot-helper.js";
const d: (x: number) => number = dynFn();
keep(d);
console.log(d(1), call3(d), same(kept_(), d), same(d, d));
const w: (x: string) => string = withThis();
console.log(w("?"), callOn(w, { tag: "T" }));
const fns: ((x: number) => number)[] = [dynFn()];
console.log(fns[0]!(5), call3(fns[0]!));
const e: any = dynFn();
const t: (x: number) => number = e;
console.log(t === e, t(1), call3(t));
