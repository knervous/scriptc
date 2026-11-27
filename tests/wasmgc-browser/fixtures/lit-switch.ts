// Switch over literal unions: fallthrough, default in the middle, case labels that look alike
// ("a", "a ", "A"), a case for a non-member (reached through a type lie), nested switches, and a
// switch over a value built at run time.
type Key = "a" | "a " | "A" | "b" | "c" | "";

function classify(k: Key): string {
  let out = "";
  switch (k) {
    case "a":
      out += "lower;";
    // falls through
    case "a ":
      out += "spaced;";
      break;
    default:
      out += "default;";
    // falls through
    case "A":
      out += "upper;";
      break;
    case "b":
    case "c":
      out += "bc;";
      break;
  }
  return out;
}

const keys: Key[] = ["a", "a ", "A", "b", "c", ""];
for (const k of keys) console.log(JSON.stringify(k), classify(k));
console.log(classify(("zz" as string) as Key), classify(("a" + " ") as Key), classify("A".toLowerCase() as Key));

type Outer = "x" | "y";
type Inner = "p" | "q";
function nested(o: Outer, i: Inner): number {
  switch (o) {
    case "x":
      switch (i) { case "p": return 1; case "q": return 2; }
      break;
    case "y":
      switch (i) { case "q": return 4; default: return 3; }
  }
  return -1;
}
console.log(nested("x", "p"), nested("x", "q"), nested("y", "p"), nested("y", "q"), nested(("z" as string) as Outer, "p"));

// Switch on a runtime-built string compared against literal cases.
function code(s: string): number {
  switch (s) {
    case "walk": return 1;
    case "run": return 2;
    case "": return 0;
    default: return -1;
  }
}
const built = ["wa" + "lk", String.fromCharCode(114, 117, 110), "xrunx".slice(1, 4), `${""}`, "WALK".toLowerCase(), "walk "];
console.log(built.map(code).join(","));

// Switch with a returned value and no default over every member.
type Phase = "dawn" | "day" | "dusk" | "night";
function hours(p: Phase): number {
  switch (p) { case "dawn": return 2; case "day": return 10; case "dusk": return 2; case "night": return 10; }
}
const phases: Phase[] = ["dawn", "day", "dusk", "night"];
let total = 0;
for (const p of phases) total += hours(p);
console.log(total);

// Switch(true) with literal comparisons inside the cases.
function band(p: Phase): string {
  switch (true) {
    case p === "dawn" || p === "dusk": return "twilight";
    case p === "day": return "light";
    default: return "dark";
  }
}
console.log(phases.map(band).join(" "));
