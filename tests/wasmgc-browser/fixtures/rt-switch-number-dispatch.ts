// Switch code shapes the runtime pass changed (agent RT, 10-28): a number switch over int32 literal labels dispatches
// once on the exact int32 (-0 matches 0, NaN and fractions match nothing, the first of a repeated label wins, default
// anywhere), and every switch enters its bodies by one table (fall-through, break, continue and return from a body,
// nested and labeled switches, an empty switch).
function filter(f: number): string {
  let out = "";
  switch (f) {
    case 0: out += "none"; break;
    case 1: out += "sub";
    case 2: out += "up"; break;
    case 3: out += "avg"; break;
    case 1: out += "dup"; break;
    default: out += "?";
    case 4: out += "paeth"; break;
  }
  return out;
}
console.log([0, -0, 1, 2, 3, 4, 5, -1, 1.5, NaN, Infinity, 2 ** 32, 2 ** 31 - 1].map(filter).join(" "));
function sparse(v: number): number {
  switch (v) { case -100: return 1; case 7: return 2; case 1000: return 3; case 2147483647: return 4; case -2147483648: return 5; }
  return 0;
}
console.log([-100, 7, 1000, 2147483647, -2147483648, 8, -2147483649].map(sparse).join(","));
function loop(): string {
  const seen: string[] = [];
  outer: for (let i = 0; i < 6; i++) {
    switch (i % 4) {
      case 0: seen.push("z"); continue;
      case 1: seen.push("o");
      case 2: { seen.push("t"); switch (i) { case 2: seen.push("inner"); break outer; default: seen.push("d"); } break; }
      case 3: seen.push("three"); break;
    }
    seen.push(`after${i}`);
  }
  return seen.join(" ");
}
console.log(loop());
let evaluated = 0;
const disc = () => { evaluated++; return 3; };
switch (disc()) {}
switch (disc()) { default: evaluated += 10; }
console.log("evaluated", evaluated);
const words = ["a", "b", "c", "zz"];
for (const w of words) {
  switch (w) { case "a": console.log("A"); break; case "b": case "c": console.log("B or C"); break; default: console.log("other", w); }
}
const kinds: (string | number)[] = [1, "1", 2];
for (const k of kinds) switch (k) { case 1: console.log("num one"); break; case "1": console.log("str one"); break; default: console.log("neither"); }
