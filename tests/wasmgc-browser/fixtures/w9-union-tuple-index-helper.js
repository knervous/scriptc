// Number-keyed reads across a union of tuple types: each element must surface
// into the join union (bool | number | string) under its own arm's tag.
function same(left, right) { return left == right; }
function show(v) { return String(v); }
export function run() {
  const out = [];
  for (const pair of [[2, 2], [2, "2"], [false, ""], [1, true], ["x", 1]]) out.push(show(pair[0]) + "/" + show(pair[1]) + "/" + same(pair[0], pair[1]));
  return out.join(" ");
}
