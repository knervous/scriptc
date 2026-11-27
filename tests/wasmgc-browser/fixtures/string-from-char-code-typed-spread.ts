// `String.fromCharCode(...typedArray)` takes one code unit per element (the PNG chunk-tag probe the client's grass
// suitability decode uses); it passed the array as one argument and threw converting it to a number.
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x49, 0x48, 0x44, 0x52]);
console.log(String.fromCharCode(...bytes.subarray(4, 8)), String.fromCharCode(...bytes.subarray(1, 4)));
const wide = new Uint16Array([0x263a, 0x41]);
console.log(String.fromCharCode(...wide).length, String.fromCharCode(...new Uint8Array(0)) === "");
