export function symbolIn() {
  const arr = JSON.parse("[1,2]");
  const obj = JSON.parse("{}");
  const sym = Symbol.for("corpus.k");
  obj[sym] = 1;
  const keyOf = (k) => k;
  const r = [Symbol.iterator in arr, keyOf(Symbol.iterator) in obj, sym in obj, Symbol.for("corpus.other") in obj, keyOf("length") in arr, "Symbol(corpus.k)" in obj];
  let err = "none";
  try { return r.join(",") + " " + (Symbol.iterator in JSON.parse("null")); } catch (e) { err = e.name; }
  return r.join(",") + " " + err;
}
