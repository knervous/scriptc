// Numeric and string-numeric keys in an object literal typed any: canonical numeric strings, integer keys first and ascending.
const o: any = { 0: 7, 1: "x", b: 2, 10: "ten", 2: "two", "3": "three", a: 1 };
console.log(Object.keys(o).join(","), o[0], o["1"], o[10], o[3], o["2"], o.b);
console.log(JSON.stringify(o));
for (const k in o) console.log(k, typeof k, o[k]);
const p: any = { "0": 7, z: 1, 1.5: "f", "01": "lead", [5]: "c", 0x10: "hex", 1e3: "exp", .5: "half" };
console.log(Object.keys(p).join(","));
console.log(p[0], p["0"], p[1.5], p["01"], p[5], p[16], p["16"], p[1000], p["0.5"]);
const canon: any = { 1.0: "one", 2: "x" };
console.log(Object.keys(canon).join(","), canon[1], canon["1"], canon[2]);
const big: any = { 4294967294: "max index", 4294967295: "not index", 3: "three", zed: 0 };
console.log(Object.keys(big).join(","));

const mixed: any = { [4]: "computed", 4.5: "f", 0: "zero" };
console.log(Object.keys(mixed).join(","), mixed[4], mixed["4.5"]);
console.log(Object.entries(o).map(([k, v]) => k + "=" + v).join(";"), "1" in o, 5 in o, o.hasOwnProperty(10));
o[5] = "five";
o["04"] = "str";
o[0] = "changed";
console.log(Object.keys(o).join(","), o[0], o[5]);
