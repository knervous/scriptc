// Array.prototype.sort and toSorted with a comparator over objects whose
// elements are counted references: an interface two record shapes implement
// (optional fields, one shape with a string), a union of two object types, and
// class instances. Every input shape the natural merge sort treats specially
// appears: strictly descending runs (reversed in place), ascending runs,
// descending runs with ties, few keys, runs shorter than minRun (insertion),
// and the minRun boundaries. Each sort is repeated so an element released
// once too often by the sort is freed while the array still holds it.
interface Item {
  order: number;
  id: number;
  mesh?: object;
}
type Plain = { order: number; id: number; mesh?: object; bind: number };
type Batched = { order: number; id: number; mesh?: object; count: number; extra: string };

type Circle = { kind: "circle"; order: number; r: number };
type Box = { kind: "box"; order: number; w: number; h?: number };
type Shape = Circle | Box;

class Node3 {
  order: number;
  id: number;
  tag: string;
  constructor(order: number, id: number, tag: string) {
    this.order = order;
    this.id = id;
    this.tag = tag;
  }
}

let seed = 12345;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const patterns = ["sorted", "descending", "fewkeys", "nearly", "random", "desc-ties", "saw", "organ", "allsame"];
function keyOf(pattern: number, i: number, n: number): number {
  if (pattern === 0) return i;
  if (pattern === 1) return n - i;
  if (pattern === 2) return Math.floor(rnd() * 4);
  if (pattern === 3) return i % 5 === 0 ? Math.floor(rnd() * n) : i;
  if (pattern === 4) return Math.floor(rnd() * 1000);
  if (pattern === 5) return Math.floor((n - i) / 3);
  if (pattern === 6) return (i % 7 === 0 ? 100 : 0) - i;
  if (pattern === 7) return i < n / 2 ? i : n - i;
  return 5;
}

function makeItems(n: number, pattern: number): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < n; i++) {
    const order = keyOf(pattern, i, n);
    if (i % 3 === 0) {
      const b: Batched = { order, id: i, count: i, extra: "b" + i };
      if (i % 2 === 0) b.mesh = { i };
      out.push(b);
    } else {
      const p: Plain = { order, id: i, bind: i };
      out.push(p);
    }
  }
  return out;
}

function makeShapes(n: number, pattern: number): Shape[] {
  const out: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const order = keyOf(pattern, i, n);
    if (i % 2 === 0) out.push({ kind: "circle", order, r: i });
    else if (i % 4 === 1) out.push({ kind: "box", order, w: i, h: i + 1 });
    else out.push({ kind: "box", order, w: i });
  }
  return out;
}

function makeNodes(n: number, pattern: number): Node3[] {
  const out: Node3[] = [];
  for (let i = 0; i < n; i++) out.push(new Node3(keyOf(pattern, i, n), i, "n" + i));
  return out;
}

const byOrder = (a: Item, b: Item): number => a.order - b.order;
const byShapeOrder = (a: Shape, b: Shape): number => a.order - b.order;
const byNodeOrder = (a: Node3, b: Node3): number => a.order - b.order;

function shapeId(x: Shape): number {
  return x.kind === "circle" ? x.r : x.w + (x.h === undefined ? 0 : 0.5);
}

/** Ordered, stable (ids rise within equal keys), and a digest of the order. */
function summarize<T extends { order: number }>(xs: T[], idOf: (x: T) => number): string {
  let h = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    if (i > 0) {
      const prev = xs[i - 1]!;
      if (prev.order > x.order || (prev.order === x.order && idOf(prev) > idOf(x))) return "BAD@" + i;
    }
    h = (h * 31 + x.order * 7 + Math.floor(idOf(x))) % 1000003;
  }
  return "ok " + h;
}

const sizes = [0, 1, 2, 3, 5, 15, 16, 17, 31, 33, 64, 100, 257, 600];
for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const n of sizes) {
    for (let pattern = 0; pattern < patterns.length; pattern++) {
      const items = makeItems(n, pattern);
      const ret = items.sort(byOrder);
      const shapes = makeShapes(n, pattern);
      shapes.sort(byShapeOrder);
      const nodes = makeNodes(n, pattern);
      const sortedNodes = nodes.toSorted(byNodeOrder);
      // Sorting a sorted array again takes the presorted path over the same elements.
      items.sort(byOrder);
      let meshes = 0;
      for (const x of items) if (x.mesh !== undefined) meshes++;
      let tags = 0;
      for (const x of sortedNodes) tags += x.tag.length;
      lines.push(
        patterns[pattern] + " " + n + " " + (ret === items) + " " + summarize(items, (x) => x.id) + " " +
          summarize(shapes, shapeId) + " " + summarize(sortedNodes, (x) => x.id) + " " +
          (n === 0 || nodes[0]!.id === 0) + " " + meshes + " " + tags,
      );
    }
  }
  if (round === 0) for (const line of lines) console.log(line);
  else console.log("round", round, lines.join("|").length);
}
