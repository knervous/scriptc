// Untyped helpers for the corpus-triage families (r7-*).
export function callbacks() {
  const out = [];
  const tryIt = (f) => { try { out.push(String(f())); } catch (e) { out.push(e.name + ": " + e.message); } };
  const xs = JSON.parse("[3,1,2]");
  tryIt(() => xs.filter());
  tryIt(() => xs.map(5));
  tryIt(() => [].forEach({}));
  tryIt(() => xs.reduce(null, 0));
  tryIt(() => xs.sort("nope"));
  tryIt(() => xs.sort(undefined).join(""));
  return out.join(" | ");
}
export function searches() {
  const xs = JSON.parse("[0,1,0,1,0]");
  const out = [];
  for (const p of [undefined, -Infinity, -9, -1, 0, 2, 4, 99, Infinity, NaN, "1.9"]) out.push(xs.lastIndexOf(0, p) + "/" + xs.indexOf(0, p) + "/" + xs.includes(1, p));
  out.push(xs.lastIndexOf(0), xs.lastIndexOf(1, void 0));
  let conversions = 0;
  const from = { valueOf() { conversions++; return 0; } };
  const empty = JSON.parse("[]");
  out.push(empty.indexOf(1, from), empty.lastIndexOf(1, from), empty.includes(1, from), conversions);
  return out.join(" ");
}
export function sparseSearch(sparse) { return [sparse.lastIndexOf(undefined), sparse.lastIndexOf(undefined, 1), sparse.indexOf(undefined), sparse.includes(undefined)].join(","); }
export function callWithout(f) { return f(); }
