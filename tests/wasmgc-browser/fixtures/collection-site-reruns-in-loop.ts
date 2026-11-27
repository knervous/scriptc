// Collection and string operations whose inline loop keeps a position in a temporary: each runs again at the same site in
// one function call (a loop body), which must start from the beginning every time.
const rows: string[][] = [["a", "b", "a"], ["c"], ["d", "e"]];
const out: string[] = [];
for (const xs of rows) {
  const s = new Set(xs);
  const spread = [...s];
  const clone = new Set(s);
  const m = new Map<string, number>(xs.map((x, i) => [x, i]));
  const keys = [...new Set(m.keys())];
  const mclone = new Map(m);
  let walked = "";
  m.forEach((v, k) => { walked += `${k}${v}`; });
  const chars = xs.join("").split("");
  out.push(`${s.size}:${spread.join("")}:${clone.size}:${keys.join("")}:${mclone.size}:${walked}:${chars.join(".")}`);
}
console.log(out.join(" | "));
