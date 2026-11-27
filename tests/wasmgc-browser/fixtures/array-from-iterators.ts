// @native-only: the engine dyn model keeps its fence for Array.from over page iterators and generator objects
// Array.from over every iterator source, with and without a mapper.
function* gen(): Generator<number> { yield 1; yield 2; yield 3; }
const sp = new URLSearchParams("a=1&b=2&a=3");
console.log(Array.from(sp.keys()).join(), Array.from(sp.values()).join(), Array.from(sp.entries()).map(([k, v]) => k + v).join());
console.log(Array.from(sp).length, Array.from(sp, ([k]) => k.toUpperCase()).join());
const seg = new Intl.Segmenter("en", { granularity: "word" });
console.log(Array.from(seg.segment("hi there")).map((s) => s.segment).join("|"), Array.from(seg.segment("a b"), (s) => s.isWordLike).join());
const m = new Map([["k1", 1], ["k2", 2]]);
console.log(Array.from(m.keys()).join(), Array.from(m.values()).join(), Array.from(m.entries()).join(";"), Array.from(m, ([k, v]) => k + v).join());
const s = new Set([3, 4]);
console.log(Array.from(s.values()).join(), Array.from(s.entries()).join(";"), Array.from(s, (x) => x * 2).join());
console.log(Array.from(gen()).join(), Array.from(gen(), (x) => x + 1).join());
console.log(Array.from("héy").join(), Array.from("ab", (c) => c + c).join(), Array.from(new Uint8Array([1, 2])).join(), Array.from(new Float32Array([1.5]), (x) => x * 2).join());
console.log(Array.from({ length: 3 }, (_, i) => i * i).join(), Array.from(new Map([[1, "a"]]).entries(), ([k, v]) => v + k).join());
console.log(Array.from(Object.entries({ p: 1, q: 2 })).join(";"), Array.from(Object.keys({ z: 1 })).join());
const re = Array.from("a1b2".matchAll(/\d/g), (match) => match[0]);
console.log(re.join(), Array.from(new Set("hello")).join(""));
const matches = Array.from("a1b2".matchAll(/\d/g), (match) => match[0]);
console.log(matches.join(), Array.from(new Set("hello")).join(""));
