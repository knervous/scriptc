// A literal union of 24 members: switch and if-chain dispatch over all of them, a full
// round trip through arrays, Map, Set, records, JSON and a JS-shaped runtime source, and a dense
// loop that walks the members with a wrapping counter.
type Tree = "ash" | "birch" | "cedar" | "dogwood" | "elm" | "fir" | "ginkgo" | "hazel" | "ironwood" | "juniper" | "kapok" | "larch" | "maple" | "nutmeg" | "oak" | "pine" | "quince" | "rowan" | "spruce" | "teak" | "umbrella" | "viburnum" | "willow" | "yew";
const TREES: Tree[] = ["ash", "birch", "cedar", "dogwood", "elm", "fir", "ginkgo", "hazel", "ironwood", "juniper", "kapok", "larch", "maple", "nutmeg", "oak", "pine", "quince", "rowan", "spruce", "teak", "umbrella", "viburnum", "willow", "yew"];

function index(t: Tree): number {
  switch (t) {
    case "ash": return 0;
    case "birch": return 1;
    case "cedar": return 2;
    case "dogwood": return 3;
    case "elm": return 4;
    case "fir": return 5;
    case "ginkgo": return 6;
    case "hazel": return 7;
    case "ironwood": return 8;
    case "juniper": return 9;
    case "kapok": return 10;
    case "larch": return 11;
    case "maple": return 12;
    case "nutmeg": return 13;
    case "oak": return 14;
    case "pine": return 15;
    case "quince": return 16;
    case "rowan": return 17;
    case "spruce": return 18;
    case "teak": return 19;
    case "umbrella": return 20;
    case "viburnum": return 21;
    case "willow": return 22;
    case "yew": return 23;
    default: return -1;
  }
}
function hard(t: Tree): string {
  if (t === "ironwood") return "very";
  else if (t === "oak" || t === "teak" || t === "yew") return "yes";
  else if (t === "pine" || t === "fir" || t === "spruce" || t === "larch" || t === "cedar") return "no";
  else if (t === "maple" || t === "ash" || t === "elm") return "medium";
  return "?";
}

console.log(TREES.length, TREES.map(index).join(","));
console.log(TREES.map(hard).join(" "));
console.log(TREES.map((t) => t.length).join(""), TREES.map((t) => t[0]).join(""));

let i = 0;
let sum = 0;
let hardCount = 0;
for (let n = 0; n < 500; n++) {
  const t = TREES[i];
  sum += index(t);
  if (hard(t) === "yes") hardCount++;
  i++;
  if (i === TREES.length) i = 0;
}
console.log(sum, hardCount, i);

const byLetter = new Map<string, Tree>();
for (const t of TREES) byLetter.set(t[0], t);
console.log(byLetter.get("q"), byLetter.get("q") === "quince", index(byLetter.get("w")!));
const set = new Set<Tree>(TREES);
console.log(set.size, set.has("yew"), set.has(("ye" + "w") as Tree), set.has("palm" as string as Tree));

const counts = new Map<Tree, number>();
for (let n = 0; n < 60; n++) { const t = TREES[(n * 7) % TREES.length]; counts.set(t, (counts.get(t) ?? 0) + 1); }
console.log(JSON.stringify([...counts]));
const parsed: Tree[] = JSON.parse(JSON.stringify(TREES.slice().reverse()));
console.log(parsed.map(index).join(","), parsed[0] === "yew", parsed.indexOf("oak"));
const fromKeys: Tree[] = [...counts.keys()];
console.log(fromKeys.map(index).join(","), fromKeys.filter((t) => hard(t) !== "?").join(","));
console.log([...TREES].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, 5).join(","));
