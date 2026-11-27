var funcToString = Function.prototype.toString;
var objectProto = Object.prototype, hasOwn = objectProto.hasOwnProperty;
export function run() { return /\[native code\]/.test(funcToString.call(hasOwn)); }
