// `a.localeCompare(b)` follows the host's collation (the page's ICU), not code units (10-30: "a" sorted after "B").
const pairs: [string, string][] = [["a", "B"], ["B", "a"], ["a", "a"], ["é", "f"], ["resume", "résumé"], ["10", "9"], ["", "a"]];
console.log(pairs.map(([x, y]) => Math.sign(x.localeCompare(y))).join(","));
const names = ["bob", "Alice", "carol", "Émile", "dave"];
console.log(names.slice().sort((x, y) => x.localeCompare(y)).join(","));
