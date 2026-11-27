// Object.is taken as a value is a compiled closure under native dyn (no page
// call per use): SameValue (NaN, ±0), identity, objects, missing and extra
// arguments, call/apply/bind, storage in objects, length and name.
// @hits(native,native-any): ^\$builtin\.Object\.is$
import { pairs, sameRow, shapes } from "./builtin-object-is-helper.js";
const o = { a: 1 }, arr = [1];
console.log(pairs([NaN, 0, -0, 1, "1", null, undefined, true, false, "", o, arr]));
console.log(sameRow(o, o), sameRow(o, { a: 1 }), sameRow(arr, arr), sameRow("x", "x"), sameRow(NaN, 0 / 0), sameRow(-0, 0));
console.log(shapes());
const f = Object.is;
const g: (a: unknown, b: unknown) => boolean = Object.is;
const vals: any[] = [NaN, 0, -0, "x"];
console.log(f(NaN, NaN), f(0, -0), g(vals[1], vals[2]), g(vals[0], vals[0]), [1, 2].map((x) => Object.is(x, 1)).join(","));
