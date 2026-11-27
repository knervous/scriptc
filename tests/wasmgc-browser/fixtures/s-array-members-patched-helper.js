export function probe(a, nested) {
  const AP = Array.prototype, at = AP.at, ts = AP.toSorted, fl = AP.flat;
  const line = () => "at=" + a.at(-1) + " toSorted=" + a.toSorted().join(",");
  const out = [line()];
  AP.at = function () { return "page"; }; AP.toSorted = function () { return "page"; };
  out.push("at=" + a.at(-1) + " toSorted=" + a.toSorted() + " findLast=" + a.findLast(function (x) { return x > 2; }) + " flat=" + nested.flat(Infinity).join(","));
  AP.at = at; AP.toSorted = ts;
  out.push(line() + " flat=" + nested.flat(Infinity).join(","));
  return out.join(" | ");
}
