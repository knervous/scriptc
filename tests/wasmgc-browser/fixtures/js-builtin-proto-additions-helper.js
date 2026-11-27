// The page adds members to Array.prototype and Function.prototype, and
// replaces a standard one; compiled arrays and functions then read them.
export function make() { return [[1], function g() {}, {}]; }
export function probe(vals) {
  const a = vals[0], f = vals[1], o = vals[2];
  const AP = Object.getPrototypeOf(a), FP = Object.getPrototypeOf(f), at = AP.at;
  AP.extraA = 6; FP.extraF = 7; AP.at = function () { return "replaced"; };
  const k = "extra" + "A";
  const out = ["" + a.extraA, "" + a[k], "" + f.extraF, "extraA" in a, "extraF" in f, a.at(0), typeof AP.extraA];
  delete AP.extraA; delete FP.extraF; AP.at = at;
  out.push(a.at(0), "" + o.extraA);
  return out.join(" ");
}
