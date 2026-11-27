// Symbol keys are keys by identity, never by their description.
const named = Symbol("x"), other = Symbol("x"), shared = Symbol.for("shared");
class Holder { [shared] = 1; plain = 2; }
export function run() {
  const o = {};
  o[named] = "sym"; o["Symbol(x)"] = "str"; o[other] = "other";
  const keys = [];
  for (const k in o) keys.push(k);
  const copy = { ...o };
  const h = { ...new Holder() };
  return [
    o[named], o["Symbol(x)"], o[other],
    Object.keys(o).join(","), keys.join(","), JSON.stringify(o),
    Object.getOwnPropertySymbols(o).length, Object.getOwnPropertySymbols(copy).length,
    copy[named], copy[other], copy["Symbol(x)"],
    Object.hasOwn(copy, named), named in copy, delete copy[named], named in copy, copy[other],
    h[shared], h.plain, Object.keys(h).join(","), Object.getOwnPropertySymbols(h).length,
  ].join(" ");
}
