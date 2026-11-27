// @options: {"hostHandles": true}
// String.fromCharCode through apply / call / Reflect.apply with array-likes and arrays.
const codes = [72, 105, 33];
console.log(String.fromCharCode.apply(null, codes));
console.log(String.fromCharCode.apply(null, [104, 101]));
console.log(String.fromCharCode.apply(undefined, []));
console.log(String.fromCharCode.call(null, 72, 105));
console.log(String.fromCharCode.call(null));
console.log(Reflect.apply(String.fromCharCode, null, codes));
console.log(Reflect.apply(String.fromCharCode, undefined, [65, 66]));
const dynCodes: any = [67, 68];
console.log(String.fromCharCode.apply(null, dynCodes));
const nothing: any = globalThis.undefined_x_;
console.log(String.fromCharCode.apply(null, nothing) === "");
try { String.fromCharCode.apply(null, 5 as any); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
