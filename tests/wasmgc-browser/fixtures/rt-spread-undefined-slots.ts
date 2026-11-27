// A spread copies an undefined slot or a hole of its source as an undefined element (10-30: `[...match]` read an
// unmatched capture group as "").
const m = /(a)(b)?(c)/.exec("ac")!;
const copy = [...m];
console.log(copy.length, copy[2] === undefined, JSON.stringify(copy), JSON.stringify([..."x".match(/(x)(y)?/)!]));
const holes: (string | undefined)[] = ["p"];
holes[3] = "q";
const spread = [...holes, "r"];
console.log(spread.length, spread[1] === undefined, spread.map((x) => (x === undefined ? "U" : x)).join(","));
const plain = [1, 2, 3];
console.log([0, ...plain, 4].join(","));
