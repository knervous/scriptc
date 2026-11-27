// Symbol.for with a constant key in an untyped source: one registered symbol,
// fetched once and the same on every evaluation; computed keys still ask.
function list(...xs) { return xs; }
function same(a, b) { return a === b; }
export function sentinel() { return Symbol.for("app.memo_sentinel"); }
export function probe() {
  const seen = list();
  for (let i = 0; i < 3; i++) seen.push(Symbol.for("app.memo_sentinel"));
  const key = "app." + "memo_sentinel";
  const out = list(same(seen[0], seen[1]) && same(seen[1], seen[2]), same(seen[0], Symbol.for(key)), same(seen[0], sentinel()), typeof seen[0],
    same(Symbol.for("app.a"), Symbol.for("app.b")), same(Symbol.for("app.a"), Symbol.for("app.a")), seen[0].toString(), seen[0].description);
  // The React Compiler memo-cache pattern.
  const cache = Array(2).fill(Symbol.for("app.memo_sentinel"));
  let computed = 0;
  for (let i = 0; i < 3; i++) if (same(cache[0], Symbol.for("app.memo_sentinel"))) { cache[0] = i; computed++; }
  out.push(computed, cache[0]);
  const o = {}; o[Symbol.for("app.slot")] = 7;
  out.push(o[Symbol.for("app.slot")], same(Symbol.for(""), Symbol.for("")));
  return out.join(" ");
}
export function check(s) { return same(s, Symbol.for("app.memo_sentinel")); }
