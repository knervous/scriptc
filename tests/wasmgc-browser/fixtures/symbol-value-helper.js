// Symbol read as a value: a (non-constructor) function minting unique symbols, with for / keyFor and the well-known symbols.
/** @type {any} */ var S = Symbol;
/** @type {any} */ var S2 = Symbol;
export function run() {
  var out = [];
  var a = S("x"), b = S("x"), c = S(), d = S(undefined), e = S(5);
  out.push([typeof S, S === Symbol, S.name, S.length, a === b, a === a, typeof a, String(a), a.description, c.description, String(c), d.description, String(e), e.description].join());
  out.push([S.for("k") === S.for("k"), S.for("k") === S.for("j"), S.keyFor(S.for("k")), S.keyFor(a), String(S.for("k")), S.for(1) === S.for("1")].join());
  var wk = ["iterator", "asyncIterator", "hasInstance", "isConcatSpreadable", "match", "matchAll", "replace", "search", "species", "split", "toPrimitive", "toStringTag", "unscopables"];
  out.push(wk.map(function (n) { return typeof S[n] + ":" + (S[n] === S2[n]) + ":" + String(S[n]); }).join("|"));
  var o = {}; o[a] = 1; o[S.iterator] = 2;
  out.push([o[a], o[b], o[Symbol.iterator], Object.getOwnPropertySymbols(o).length, a in o, b in o].join());
  try { new S("y"); out.push("no throw"); } catch (err) { out.push(err.name + ":" + err.message); }
  try { out.push(String(S.keyFor("str"))); } catch (err) { out.push(err.name); }
  try { out.push(a + ""); } catch (err) { out.push(err.name); }
  try { out.push(+a); } catch (err) { out.push(err.name); }
  out.push([S.iterator.description, S.for("k").description, typeof S.prototype].join());
  return out.join("\n");
}
