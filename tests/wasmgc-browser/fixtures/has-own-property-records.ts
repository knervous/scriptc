// @native-any-only: `x.hasOwnProperty(k)` on records, index-signature records and optional-field records (the method form, not Object.hasOwn).
const idx: Record<string, string> = { a: "1" };
const idx2: { [key: string]: boolean } = { $x: true };
const registry: { [name: string]: string[] } = { onClick: ["click"] };
type Style = { display?: string; marginTop?: string };
const s: Style = { display: "block" };
const t: Style = {};
console.log(idx.hasOwnProperty("a"), idx.hasOwnProperty("b"), idx2.hasOwnProperty("$x"), idx2.hasOwnProperty("y"));
console.log(registry.hasOwnProperty("onClick"), registry.hasOwnProperty("toString"));
console.log(s.hasOwnProperty("display"), s.hasOwnProperty("marginTop"), t.hasOwnProperty("display"));
const key = "$" + "x";
console.log(idx2.hasOwnProperty(key));
