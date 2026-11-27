// node_modules/fake-probe/index.js
var undeclaredProbe = typeof someUndeclaredName == "undefined" ? "absent" : someUndeclaredName;
function guarded() { return typeof anotherMissingName === "function" ? anotherMissingName() : "fallback"; }
export function run() { return [undeclaredProbe, guarded()].join(","); }
