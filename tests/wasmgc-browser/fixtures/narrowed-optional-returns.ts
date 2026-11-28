// A function returning a binding whose declared type admits undefined, where a runtime test has removed undefined,
// returns its declared type unboxed; a binding the checker types without undefined (an array read past the end) still
// returns the runtime undefined.

const free: number[] = [7];
const nodes: (object | null)[] = [null];

function allocate(): number {
  const h = free.pop();
  if (h !== undefined) return h;
  nodes.push(null);
  return nodes.length - 1;
}

function popOr(xs: number[], fallback: number): number {
  const v = xs.pop();
  if (v === undefined) return fallback;
  return v;
}

function truthy(xs: number[]): number {
  const v = xs.pop();
  if (v) return v;
  return 100;
}

function byTypeof(xs: (number | string)[]): number {
  const v = xs.shift();
  if (typeof v === "number") return v;
  return -1;
}

function defaulted(xs: number[]): number {
  let v = xs.pop();
  v ??= 9;
  return v;
}

// The checker types `xs[i]` as number: past the end it is undefined all the same, and so is the result.
function at(xs: number[], i: number): number {
  const v = xs[i];
  return v;
}

const got: unknown[] = [];
for (let i = 0; i < 3; i++) got.push(allocate());
got.push(popOr([1, 2], 0), popOr([], 5), truthy([0]), truthy([3]), truthy([]));
got.push(byTypeof([4, "a"]), byTypeof(["a", 4]), byTypeof([]), defaulted([]), defaulted([2]));
got.push(at([1, 2], 1), at([1, 2], 5));
console.log(got.map((v) => String(v)).join(" "));
console.log(typeof at([], 0), allocate() + 1);
