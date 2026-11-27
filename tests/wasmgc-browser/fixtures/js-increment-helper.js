// Untyped locals initialized from untyped values and then incremented: JS
// applies ToNumeric at the increment, so the local keeps whatever it was
// given until then (a string "4" becomes 5, null 1, undefined NaN).
export function postInc(a) { let x = a; x++; return x; }
export function postDec(a) { let x = a; x--; return x; }
export function preInc(a) { let x = a; return ++x; }
export function postValue(a) { let x = a; const old = x++; return [old, x]; }
export function plusEq(a) { let x = a; x += 1; return x; }
export function minusEq(a) { let x = a; x -= 1; return x; }
export function beforeInc(a) { let x = a; const seen = typeof x; x++; return seen + " " + typeof x; }
export function loopCount(a) { let i = a; let n = 0; for (; i < 3; i++) n++; return n; }
export function report() {
  const inputs = ["4", "x", "", null, undefined, true, false, 7, 2.5, [], [3], {}];
  const lines = [];
  for (const v of inputs) {
    const label = v === null ? "null" : Array.isArray(v) ? `[${v}]` : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" ? "{}" : String(v);
    lines.push(`${label}: ++ ${postInc(v)} -- ${postDec(v)} pre ${preInc(v)} old/new ${postValue(v).join("/")} += ${plusEq(v)} -= ${minusEq(v)} types ${beforeInc(v)}`);
  }
  lines.push(`loop from "1": ${loopCount("1")} from null: ${loopCount(null)}`);
  return lines.join("\n");
}
