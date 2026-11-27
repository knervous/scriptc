var freeSelf = typeof globalThis == "object" && globalThis;
var root = freeSelf || eval("this");
var none = null;
var kept = none && eval("1");
var dflt = none ?? 5;
var picked = typeof freeSelf == "object" ? "page" : eval("'none'");
export function probe() { return [typeof root, kept, dflt, picked].join(","); }
export function taken() { var zero = 0; return zero || eval("this"); }
export function takenArm(flag) { return flag ? eval("1") : 2; }
