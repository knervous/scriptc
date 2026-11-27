var freeSelf = typeof globalThis == "object" && globalThis;
var root = freeSelf || Function("return this")();
export function run() { return typeof root; }
