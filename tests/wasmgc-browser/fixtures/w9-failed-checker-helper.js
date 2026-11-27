// JSDoc-cast Maps: their checked-dynamic conversion (dynCheck to map) is
// refused, and is requested from more than one function. Neither runs here:
// the regression was at compile time (and a fence, once thrown, is not catchable).
function fresh() { return /** @type {Map<string, number>} */ (new Map()); }
function other() { return /** @type {Map<string, number>} */ (new Map([["b", 2]])); }
export function run(go) {
  if (!go) return "compiled";
  const t = fresh(); t.set("a", 1);
  return "ok " + t.get("a") + " " + other().get("b");
}
