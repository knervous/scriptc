// @options: {"hostHandles": true}
// String.fromCharCode: one unit per argument (ToUint16 of ToNumber), a spread over a
// compiled number[] loops in Wasm, nothing crosses as an array.
const SPACEBAR_CHAR = String.fromCharCode(32);
console.log(JSON.stringify(SPACEBAR_CHAR), String.fromCharCode(), String.fromCharCode(72, 105));
console.log(String.fromCharCode(65601, -1 + 65537, 1.9 + 64, NaN + 66, Infinity).length, String.fromCharCode(65601) === "A");
const lone = String.fromCharCode(0xd83d, 0xde00);
console.log(lone === "\u{1F600}", lone.length);
const codes = [104, 101, 108, 108, 111];
console.log(String.fromCharCode(...codes), String.fromCharCode(...[]));
const dyn: any = 66;
console.log(String.fromCharCode(dyn, 67));
let n = 0;
const next = () => 70 + n++;
console.log(String.fromCharCode(next(), next(), next()));
