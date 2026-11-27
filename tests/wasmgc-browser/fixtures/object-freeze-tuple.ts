"use strict";
// @native-only: the engine dyn model has no runtime freeze of a compiled record
// A frozen tuple refuses element writes (loud TypeError), keeps its values, and reports frozen; the message text is V8's for a
// compiled tuple viewed through the page, so only the error kind is compared.
function mk(): [number, string] { return [1, "a"]; }
const t = mk();
t[0] = 5;
const q = Object.freeze(t);
console.log(q === t, Object.isFrozen(t), Object.isFrozen(mk()));
try { t[0] = 2; console.log("no throw"); } catch (e) { console.log((e as Error).name); }
console.log(t[0], t[1]);
