// String constants holding U+0000 keep it (10-30: binaryen takes import names as C strings, so "a\0b" compiled as "a"):
// lengths, code units, split, switch dispatch, case conversion, JSON text and object keys.
const a = "a\0b";
const b = "x\u0000";
const c = "\0";
console.log(a.length, b.length, c.length, a.charCodeAt(1), b.charCodeAt(1), JSON.stringify(a));
console.log("q\0r\0".split("\0").length, "q\0r".split("\0").join("|"), "mixed\0tail".toUpperCase().length);
const pick = (s: string): string => {
  switch (s) {
    case "a\0b": return "nul";
    case "a": return "plain";
    default: return "other";
  }
};
console.log(pick("a\0b"), pick("a"), pick("a\0c"));
const keyed: Record<string, number> = { "k\0ey": 1, key: 2 };
console.log(Object.keys(keyed).map((k) => k.length).join(","), keyed["k\0ey"], JSON.stringify(keyed));
let s = "";
s += "m"; s += "\0"; s += "n";
console.log(s === "m\0n", s.length);
