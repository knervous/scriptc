// @native-only: engine dyn has no dynCheck to a tuple record (the Map constructor entries)
// Unions that reach themselves through a container arm (after upstream 9946-class-field-self-reaching-union):
// `type Nest = Nest[] | null` is one array reference or null, so the backend's question about the union is a
// question about an array of itself; `type Tags = Map<string, Tags> | undefined` the same through a Map. The
// compiler ended with a stack overflow; these compile, and the values read, write, print and serialize as in Node.
type Outline = string | number | Outline[];
type Row = number | Column[];
type Column = string | Row[];
type Nest = Nest[] | null;
type Tags = Map<string, Tags> | undefined;
type Mixed = number | (string | Mixed)[];

function outline(v: Outline): string {
  if (typeof v === "number") return "n" + v;
  if (typeof v === "string") return "s" + v;
  return "[" + v.map(outline).join(",") + "]";
}
function row(v: Row): string { return typeof v === "number" ? "n" + v : "(" + v.map(column).join(",") + ")"; }
function column(v: Column): string { return typeof v === "string" ? "s" + v : "<" + v.map(row).join(",") + ">"; }
function depth(v: Nest): number {
  if (v === null) return 0;
  let most = 0;
  for (const inner of v) most = Math.max(most, depth(inner));
  return most + 1;
}
function tally(t: Tags): number {
  if (t === undefined) return 0;
  let n = t.size;
  for (const inner of t.values()) n += tally(inner);
  return n;
}
function mixed(v: Mixed): string {
  if (typeof v === "number") return "n" + v;
  return "[" + v.map((e) => (typeof e === "string" ? "s" + e : mixed(e))).join(",") + "]";
}

class Burrow {
  den: Nest = null;
  marks: Tags = undefined;
  side: Nest;
  constructor(side: Nest) { this.side = side; }
}
const burrow = new Burrow([null]);
burrow.den = [null, [[null]]];
burrow.marks = new Map<string, Tags>([["a", new Map<string, Tags>([["b", undefined]])], ["c", undefined]]);
console.log(depth(burrow.den), depth(burrow.side), tally(burrow.marks), JSON.stringify(burrow.den));
burrow.den = null;
console.log(depth(burrow.den), burrow.den === null, JSON.stringify(burrow.side));

class Ledger {
  rows: Row;
  readonly head: Column;
  constructor(rows: Row, head: Column) { this.rows = rows; this.head = head; }
}
const ledger = new Ledger(["a", [1, ["b"]]], [2, ["c", [3]]]);
console.log(row(ledger.rows), column(ledger.head));
ledger.rows = 9;
console.log(row(ledger.rows), JSON.stringify(ledger.head));

class Folder {
  body: Outline = 0;
  extra: Mixed = 0;
}
const folder = new Folder();
const chapters: Outline = [1, "two", [3, ["four"]]];
folder.body = chapters;
folder.extra = [1, "two", [3, "four", [5]]];
console.log(folder.body === chapters, outline(folder.body), mixed(folder.extra), JSON.stringify(folder.body), JSON.stringify(folder.extra));

class Crate<T> {
  item: T;
  constructor(item: T) { this.item = item; }
}
const crate = new Crate<Nest>([[], [null]]);
console.log(depth(crate.item));
crate.item = null;
console.log(depth(crate.item));
const nests: Nest[] = [null, [], [[]]];
console.log(nests.map(depth).join(","));
export {};
