// @native-any-only: the production object model (native any); the legacy lanes model any differently
// Conversions of an `any` value into a record or array type that stay allowed (agent RT, 10-28): a fresh value
// (JSON.parse, a call's result) converted once, a dyn binding never read again after the conversion (reads in the
// other arm of a conditional do not follow it), and a value that already is a compiled record of the type, which
// passes through as itself (aliasing, as TypeScript does).
interface Doc { a: number; tags: string[] }
function load(text: string): Doc { const doc: Doc = JSON.parse(text); doc.a += 1; return doc; }
console.log("fresh", JSON.stringify(load('{"a":1,"tags":["x"]}')));
function once(text: string): number {
  const raw: any = JSON.parse(text);
  const doc: Doc = raw;
  doc.tags.push("y");
  return doc.tags.length + doc.a;
}
console.log("once", once('{"a":2,"tags":[]}'));
function branchy(raw: any, typed: boolean): string {
  if (typed) { const d: Doc = raw; return `typed ${d.a}`; }
  return `raw ${raw.a}`;
}
console.log("branch", branchy({ a: 3, tags: [] }, true), branchy({ a: 4, tags: [] }, false));
const r: Doc = { a: 1, tags: [] };
const viaAny: any = r;
const back: Doc = viaAny;
back.a = 9;
console.log("record via any", r.a, back === r);
const list: Doc[] = JSON.parse('[{"a":1,"tags":[]},{"a":2,"tags":["q"]}]');
console.log("array", list.length, list[1]!.tags[0]);
