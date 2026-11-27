// Page values of every kind entering untyped compiled code: through property
// reads, method results, and as this and arguments of a callback the page
// calls. Each is described by what JS can observe about it.
const describe = (v) => {
  const t = typeof v;
  const parts = [];
  parts.push(t);
  if (t === "number") parts.push(Object.is(v, -0) ? "-0" : String(v), v === v, v + 1, v * 2, v | 0, Object.is(v, 0));
  else if (t === "string") parts.push(JSON.stringify(v), v.length, v + 1, v == 12, v === "12");
  else if (t === "boolean") parts.push(v, v + 1, !v);
  else if (t === "symbol") parts.push(String(v), v.description);
  else if (t === "bigint") parts.push(String(v), v === v);
  else if (t === "function") parts.push(v.name, v());
  else if (v === null) parts.push("null", v == undefined);
  else if (t === "object") parts.push(JSON.stringify(v), Array.isArray(v));
  else parts.push(v === undefined, v == null);
  parts.push(!!v);
  return parts.join(",");
};
export function readsAndCalls(page) {
  const kinds = page.classifyKinds(), props = page.classifyProps(), out = [];
  for (let i = 0; i < kinds.length; i++) {
    const a = kinds[i], b = props["k" + i], c = page.classifyAt(i);
    out.push(i + ":" + describe(a) + (a === b || (a !== a && b !== b) ? "" : " !b") + (Object.is(a, c) ? "" : " !c"));
  }
  return out.join("\n");
}
export function thisAndArguments(page) {
  const out = page.classifyEach(function (v, i, again, next, last) {
    return i + ":" + describe(this) + "|" + (Object.is(this, v) && Object.is(v, again) && Object.is(v, last)) + "|" + describe(next) + "|" + arguments.length;
  });
  return out.join("\n") + "\n" + page.classifyArity(function () { return this + ":" + arguments.length + ":" + [...arguments].map(String).join("/"); });
}
// Strict equality between page values of every kind (both sides from the page).
export function equalities(page) {
  const kinds = page.classifyKinds(), rows = [];
  for (let i = 0; i < kinds.length; i++) {
    let row = "";
    for (let j = 0; j < kinds.length; j++) row += kinds[i] === page.classifyAt(j) ? "1" : ".";
    rows.push(row);
  }
  return rows.join("\n");
}
// Compiled values crossing out and back keep their identity; page numbers
// meet compiled ones by value.
export function roundTrips(page) {
  const o = { n: 1 }, a = [1, 2], f = () => 3;
  const echo = (v) => page.classifyEcho(v);
  const out = [echo(o) === o, echo(a) === a, echo(f) === f, echo(f)(), echo(o).n, echo(a).length];
  const kinds = page.classifyKinds();
  out.push(kinds[4] === 0, kinds[5] === 0, Object.is(kinds[5], 0), kinds[9] === 2 ** 30, kinds[18] === kinds[18], kinds[19] !== kinds[19], typeof kinds[19]);
  out.push(kinds[24] === "12", kinds[24] === 12, kinds[24] == 12, kinds[2] === true, kinds[3] === false, kinds[0] === undefined, kinds[1] === null);
  out.push(echo(-0) === 0, Object.is(echo(-0), -0), Object.is(echo(0.5 - 0.5), 0), echo(2 ** 31) === 2147483648, echo(NaN) !== echo(NaN));
  return out.join(" ");
}
