// Typed functions called with omitted arguments from untyped code: optional
// union parameters receive undefined.
import { callWithout } from './r7-helper.js';
function opt(x?: number): string { return x === undefined ? "none" : String(x); }
function maybe(x: number | undefined): string { return typeof x; }
console.log(callWithout(opt), callWithout(maybe));
