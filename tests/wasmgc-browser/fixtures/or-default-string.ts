// `a || d` keeps the left operand when it is truthy and otherwise answers the right one.
function k(a: string | undefined): string { return a || "d"; }
const xs: (string | undefined)[] = ["x", "", undefined];
const n = (v: number | undefined): number => v || 7;
const pick = (arr: string[], i: number): string => arr[i] || "none";
console.log(k("a"), k(""), k(undefined), xs.map((x) => x || "-").join(","), n(0), n(3), n(undefined), pick(["p", ""], 1), pick(["p"], 0));
