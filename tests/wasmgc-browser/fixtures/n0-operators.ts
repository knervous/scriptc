// Native dyn operators against JS: numbers, strings, booleans, null and
// undefined, ToInt32 wrap-around, string comparison, ++/--, compound flags.
import { grid, extras } from "./n0-operators-helper.js";
const vals: unknown[] = [0, 1, -1, 2.5, "3", "x", true, false, null, undefined, 2 ** 31, -(2 ** 32) + 5];
const g: string = grid(vals);
console.log(g);
const x: string = extras();
console.log(x);
