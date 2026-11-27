// @hits(native,native-any): dyn\.str\.member$
// Computed string keys on strings resolve String.prototype members
// (toUpperCase, slice, valueOf, Object.prototype's hasOwnProperty, ...) as
// well as length, canonical indices and index-like keys: in JS through the
// generic computed read and from TS any through the computed-key dispatcher.
import { report, KEYS, describe } from "./js-string-computed-key-helper.js";
console.log(report());
const t: any = " abc";
const lines: string[] = [];
for (const k of KEYS) lines.push(`${k}: ${describe(t, t[k], k)}`);
console.log(lines.join("\n"));
