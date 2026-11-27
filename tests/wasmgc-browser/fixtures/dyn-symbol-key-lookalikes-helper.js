const show = (k) => typeof k === "symbol" ? String(k) : Array.from({ length: k.length }, (_, i) => {
  const c = k.charCodeAt(i);
  return c >= 0xD800 && c <= 0xDFFF ? "<" + c.toString(16) + ">" : k[i];
}).join("");
export function run() {
  const a = Symbol("k"), b = Symbol("k");
  const o = {};
  o[a] = "A";
  o[b] = "B";
  // Every encoded name these symbols could have had, spelled as strings.
  const names = [];
  for (let i = 0; i < 48; i++) names.push("\uDFFF" + i + ":Symbol(k)");
  names.forEach((n, i) => { o[n] = "s" + i; });
  const looks = ["\uDFFF0junk", "\uDFFF1", "\uDFFF", "\uDFFF\uDFFF0:Symbol(k)", "\uDFFF\uDFFF", "\uDFFFx"];
  looks.forEach((n, i) => { o[n] = "L" + i; });
  console.log(o[a], o[b], o[names[0]], o[names[1]], o[names[47]]);
  console.log(looks.map((n) => o[n]).join(","));
  console.log(Object.keys(o).length, Object.getOwnPropertySymbols(o).length, Reflect.ownKeys(o).length);
  console.log(Object.keys(o).filter((k) => k.charCodeAt(0) !== 0xDFFF || !/^\uDFFF\d+:Symbol\(k\)$/.test(k)).map(show).join(" "));
  let forIn = 0, stringKeys = 0;
  for (const k in o) { forIn++; if (typeof k === "string") stringKeys++; }
  console.log(forIn, stringKeys);
  // Writes and deletes stay on their own key.
  o[a] = "A2";
  delete o[names[0]];
  delete o[looks[0]];
  console.log(o[a], o[b], names[0] in o, a in o, looks[0] in o, looks[1] in o, Object.prototype.hasOwnProperty.call(o, names[1]));
  o[names[1]] = "s1b";
  delete o[b];
  console.log(o[a], o[b], o[names[1]], b in o, Object.getOwnPropertySymbols(o).map(show).join(","));
  // Copies carry each key as itself.
  const c = Object.assign({}, o);
  console.log(Object.keys(c).length, Object.getOwnPropertySymbols(c).length, c[a], c[names[1]], c[looks[3]]);
  const e = Object.entries(o).find(([k]) => k === looks[3]);
  console.log(e ? show(e[0]) + "=" + e[1] : "missing");
}
