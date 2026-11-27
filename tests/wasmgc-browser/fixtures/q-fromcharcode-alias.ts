// @options: {"hostHandles": true}
// A stored String.fromCharCode called through its TS `(...codes: number[])` type: the rest items are the call's arguments.
const f = String.fromCharCode;
console.log(JSON.stringify(f(65)), JSON.stringify(f(65, 66)), JSON.stringify(f(65, 66, 67)), JSON.stringify(f()));
const nums = [72, 105];
console.log(f(...nums), f.apply(null, nums), f.call(null, 33));
