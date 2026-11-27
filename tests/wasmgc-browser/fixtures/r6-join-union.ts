// join over arrays of union / mixed elements (null and undefined join as "").
const mixed: (string | number | boolean | null | undefined)[] = ["a", 1, true, null, undefined, 2.5, false];
console.log(mixed.join("|"));
const opt: (string | undefined)[] = ["x", undefined, "z"];
console.log(opt.join(), [[1, 2], [3]].join(";"));
