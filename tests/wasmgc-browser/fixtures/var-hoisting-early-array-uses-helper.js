// A var read early (typeof before its statement) that holds an array: every later use takes its array value.
function early() { return typeof xs; }
export const before = early();
var xs = "a b c".split(" "), ys = "z".split(" ").concat(xs);
var nums = [3, 1, 2];
function probe() { return typeof nums + nums.length; }
export const probeEarly = probe();
var sorted = nums.slice().sort();
export const report = [
  ys.join(","), xs.length, early(), xs.indexOf("b"), xs.includes("c"),
  [...xs, ...ys].length, xs.map((x) => x + "!").join(""), sorted.join(""),
  nums.reduce((a, b) => a + b, 0), xs.slice(1).join("")
].join(" ");
let seen = "";
for (const x of xs) seen += x;
for (let i = 0; i < nums.length; i++) seen += nums[i];
xs.push("d");
nums[1] = 9;
export const after = seen + " " + xs.join("") + " " + nums.join("") + " " + probe();
