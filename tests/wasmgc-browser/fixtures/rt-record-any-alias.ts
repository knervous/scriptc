// @native-any-only: the production object model (native any); the legacy lanes model any differently
// @refuse: typed view(s) of an `any` value that would copy it
// A record- or array-typed view of an `any` object is a copy in compiled code, where TypeScript aliases: writes
// through the typed view would not reach the original. Where the original binding is still read after the conversion,
// the compiler refuses (agent RT, 10-28; owner rule: TypeScript semantics wherever the difference is observable;
// docs/plans/wasmgc-runtime-speed-2026-10-28.md). rt-record-any-copy-ok holds the conversions that stay allowed.
interface Doc { a: number; tags: string[]; name?: string }
const raw: any = JSON.parse('{"a":1,"tags":["x"]}');
const doc: Doc = raw;
doc.a = 5;
console.log("const typed", raw.a, doc === raw);
function bump(d: Doc): void { d.a++; d.name = "n"; }
bump(raw);
console.log("param typed", raw.a, raw.name);
