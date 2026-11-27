// Switch dispatch: a string switch over many literal labels (length-bucketed),
// a duplicate label (first wins), non-BMP and empty strings, default; and case
// tests with side effects that stop at the first match.
function pick(s: string): string {
  switch (s) {
    case "click": return "C";
    case "close": return "L";
    case "copy": return "P";
    case "cut": return "T";
    case "click": return "dup";
    case "dblclick": return "D";
    case "😀x": return "E";
    case "": return "empty";
    case "keydown": return "K";
    case "keyup": return "U";
    default: return "?";
  }
}
const words: string[] = ["click", "close", "copy", "cut", "dblclick", "😀x", "", "keydown", "keyup", "kEyup", "clicks", "c"];
let out = "";
for (const w of words) out += pick(w) + ",";
console.log(out);
const seen: string[] = [];
function t(v: number): number { seen.push("t" + v); return v; }
function run(x: number): string {
  switch (x) {
    case t(1): return "one";
    case t(2): return "two";
    case t(3): return "three";
    default: return "none";
  }
}
console.log(run(2) + " " + seen.join(","));
