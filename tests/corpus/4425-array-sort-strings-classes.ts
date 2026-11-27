// Array.prototype.sort and toSorted over counted references: strings without a
// comparator (built at run time, so each is its own allocation), and class
// instances with a comparator over their string keys. The inputs cover strictly
// descending runs, descending runs with ties, few keys, runs shorter than
// minRun, and the minRun boundaries. Each sort is repeated so an element
// released once too often by the sort is freed while the array still holds it.
class Tagged {
  key: string;
  id: number;
  constructor(key: string, id: number) {
    this.key = key;
    this.id = id;
  }
}

const byKey = (a: Tagged, b: Tagged): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

let seed = 777;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const patterns = ["sorted", "descending", "fewkeys", "random", "desc-ties", "organ"];
function keyOf(pattern: number, i: number, n: number): string {
  let k: number;
  if (pattern === 0) k = i;
  else if (pattern === 1) k = n - i;
  else if (pattern === 2) k = Math.floor(rnd() * 4);
  else if (pattern === 3) k = Math.floor(rnd() * 100000);
  else if (pattern === 4) k = Math.floor((n - i) / 3);
  else k = i < n / 2 ? i : n - i;
  // Zero-padded so the string order is the numeric order; a suffix keeps the
  // strings distinct allocations even when keys repeat.
  return "k" + String(100000 + k).slice(1);
}

function digest(xs: string[]): number {
  let h = 0;
  for (const x of xs) {
    for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) % 1000003;
  }
  return h;
}

function stringOrdered(xs: string[]): boolean {
  for (let i = 1; i < xs.length; i++) if (xs[i - 1]! > xs[i]!) return false;
  return true;
}

function taggedStable(xs: Tagged[]): string {
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]!;
    const b = xs[i]!;
    if (a.key > b.key || (a.key === b.key && a.id > b.id)) return "BAD@" + i;
  }
  return "ok";
}

const sizes = [0, 1, 2, 3, 15, 16, 17, 33, 100, 257, 600];
for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const n of sizes) {
    for (let pattern = 0; pattern < patterns.length; pattern++) {
      const strs: string[] = [];
      const tagged: Tagged[] = [];
      for (let i = 0; i < n; i++) {
        const key = keyOf(pattern, i, n);
        strs.push(key + ":" + (i % 3));
        tagged.push(new Tagged(key, i));
      }
      const ret = strs.sort();
      const copy = strs.toSorted();
      strs.sort();
      tagged.sort(byKey);
      const taggedCopy = tagged.toSorted(byKey);
      let ids = 0;
      for (const t of taggedCopy) ids += t.id;
      lines.push(
        patterns[pattern] + " " + n + " " + (ret === strs) + " " + stringOrdered(strs) + " " + digest(strs) + " " +
          (digest(copy) === digest(strs)) + " " + taggedStable(tagged) + " " + taggedStable(taggedCopy) + " " + ids +
          " " + (n === 0 ? "-" : tagged[0]!.key + "/" + tagged[n - 1]!.key),
      );
    }
  }
  if (round === 0) for (const line of lines) console.log(line);
  else console.log("round", round, lines.join("|").length);
}
