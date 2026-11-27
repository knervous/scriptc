// Iterable<T> parameters fed by arrays and a string (the shapes engine dyn can box).
function total(xs: Iterable<number>): number { let t = 0; for (const x of xs) t += x; return t; }
console.log(total([1, 2, 3]), total([]));
function words(xs: Iterable<string>): number { let n = 0; for (const w of xs) { if (w.length > 1) n++; } return n; }
console.log(words(["hi", "x", "abc"]), words("abc"));
