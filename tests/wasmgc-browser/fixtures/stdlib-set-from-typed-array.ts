// @options: {"interfaceClassArms": true}
// new Set(typedArray ?? []) : a Set built from a Uint32Array element read.
const lists: Uint32Array[] = [new Uint32Array([1, 2, 2]), new Uint32Array([5])];
const prototype = 0;
const have = new Set(lists[prototype] ?? []);
const missing = [2, 3, 4].filter((s) => !have.has(s));
console.log(have.size, missing.join(","));
const none = new Set(lists[9] ?? []);
console.log(none.size);
