// The WHATWG text codecs are compiled builtins (UTF-8): encode, encodeInto, decode with BOM handling, replacement and fatal.
const encoder = new TextEncoder();
const show = (b: Uint8Array): string => Array.from(b).join(",");
const u8 = (xs: number[]): Uint8Array => {
  const u = new Uint8Array(xs.length);
  for (let i = 0; i < xs.length; i++) u[i] = xs[i];
  return u;
};
console.log(encoder.encoding, show(encoder.encode("hé€😀")), encoder.encode().length);
console.log(show(encoder.encode("a\uD800b\uDC00")));
const out = new Uint8Array(8);
const r1 = encoder.encodeInto("hé€", out.subarray(1, 7));
console.log(r1.read, r1.written, show(out));
const small = new Uint8Array(5);
const r2 = encoder.encodeInto("ab😀c", small);
console.log(r2.read, r2.written, show(small));
const decoder = new TextDecoder();
console.log(decoder.encoding, decoder.fatal, decoder.ignoreBOM);
console.log(JSON.stringify(decoder.decode(u8([0xEF, 0xBB, 0xBF, 0x68, 0x69]))));
console.log(JSON.stringify(new TextDecoder("utf-8", { ignoreBOM: true }).decode(u8([0xEF, 0xBB, 0xBF, 0x68]))));
const bad: number[][] = [[0xC3], [0xE0, 0x80, 0x41], [0xED, 0xA0, 0x80], [0xF0, 0x9F, 0x98], [0xF4, 0x90, 0x80, 0x80], [0xC0, 0xAF], [0x80, 0x41], [0xE2, 0x82, 0x41, 0xE2, 0x82, 0xAC]];
for (const b of bad) {
  const s = decoder.decode(u8(b));
  console.log(s.length, Array.from(s, (c) => c.codePointAt(0)!.toString(16)).join(" "));
}
console.log(decoder.decode(encoder.encode("hé€😀 ok")));
const strict = new TextDecoder("utf-8", { fatal: true });
try {
  strict.decode(u8([0x61, 0xFF]));
  console.log("no throw");
} catch (e) {
  console.log(e instanceof TypeError, (e as Error).message);
}
console.log(strict.decode(u8([0x61, 0xE2, 0x82, 0xAC])));
let long = "";
for (let i = 0; i < 9000; i++) long += String.fromCharCode(0x41 + (i % 26)) + (i % 7 === 0 ? "é" : "");
const round = decoder.decode(encoder.encode(long));
console.log(round.length, round === long, round.slice(4090, 4100));
console.log(new TextDecoder().decode(new Uint8Array(0)).length, new TextDecoder().decode().length);
