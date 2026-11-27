// Compiled errors read from untyped JS: name, message and stack (React's frame
// description reads x.stack); JS functions specialized with unknown arguments.
import { caughtErrors, unknownOps } from './r4-helper.js';
const r: string = caughtErrors();
const u: unknown = 7;
const v: unknown = "7";
const s: string = unknownOps(u, v);
console.log(r, s);
