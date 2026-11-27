// A module-level const read before its initializer runs throws ReferenceError (TDZ).
function early(): string { return later("x"); }
let caught = "";
try { early(); } catch (e) { caught = e instanceof ReferenceError ? "ReferenceError: " + e.message : "other"; }
const later = (s: string): string => s + "!";
console.log(caught, early());
