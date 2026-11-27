// toString() and other primitive methods on untyped values (React's minified
// code calls `.toString(32)` on a reused variable): numbers with a radix,
// strings, booleans, arrays, objects, user methods, and the error cases.
export function str(x, r) { return x.toString(r); }
export function plain(x) { return x.toString(); }
export function fixed(x, d) { return x.toFixed(d); }
export function value(x) { return x.valueOf(); }
export function report() {
  const out = [];
  out.push([str(255, 16), str(255, 36), str(-7.5, 2), str("ab", 2), str(true, 2), str([1, [2, 3]], 8)].join(" | "));
  out.push([plain(7.5), plain(1e21), plain(false), plain([]), plain({}), plain({ toString() { return "mine"; } })].join(" | "));
  out.push([fixed(3.14159, 2), fixed(2, 0), value(12), value(true)].join(" | "));
  for (const [x, r] of [[null, 2], [undefined, 2], [5, 1], [5, 37]]) {
    try { out.push("no error " + str(x, r)); } catch (e) { out.push(`${e.name}: ${e.message}`); }
  }
  let reused = "pre";
  reused = 42;
  out.push("reused " + reused.toString(32));
  return out.join("\n");
}
