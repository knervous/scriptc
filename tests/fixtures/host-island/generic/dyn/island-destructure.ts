// Declaration-position destructuring over island values: plain-name array patterns step the island's iterator
// (dynIterN) instead of an engine-compiled pattern; defaults keep the engine path (here: none needed natively).
const g: any = globalThis;
g.pairs = [["a", 1], ["b", 2], ["c", 3]];
const seen: string[] = [];
for (const [k, v] of g.pairs) seen.push(`${k}${v}`);
const [first, second] = g.pairs;
const [x, y, z] = g.pairs[0].concat([9]);
console.log(seen.join(","), JSON.stringify(first), JSON.stringify(second), x, y, z);
let count = 0;
for (const [only] of g.pairs) count += only.length;
console.log(count);
