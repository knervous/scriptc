// @expect: base true true false false
// @expect: undefined-valued true
// @expect: deleted false true
// @expect: index keys true true false
// @expect: declared true true true false
// @expect: empty false
// @expect: loop 2000
// `k in r` with a run-time string key over an index-signature record answers from the overflow map's lookup: present
// keys (an explicitly undefined value included), deleted keys gone, integer-like keys, keys added later, declared fields.
const uniformTypes: Record<string, string> = { tint: "vec3", time: "float" };
function has(name: string): boolean { return name in uniformTypes; }
console.log("base", has("tint"), has("time"), has("fog"), has("color"));

const loose: Record<string, number | undefined> = {};
loose["gone"] = undefined;
const key = (s: string) => s;
console.log("undefined-valued", key("gone") in loose);

uniformTypes["fog"] = "vec4";
delete uniformTypes["tint"];
console.log("deleted", has("tint"), has("fog"));

const slots: Record<string, number> = {};
slots["2"] = 1; slots["10"] = 2; slots["x"] = 3;
const probe = (k: string) => k in slots;
console.log("index keys", probe("2"), probe("10"), probe("02"));

interface Named { label: string; note?: string; [k: string]: string | undefined }
const named: Named = { label: "a", extra: "b" };
named.note = "n";
const inNamed = (k: string) => k in named;
console.log("declared", inNamed("label"), inNamed("note"), inNamed("extra"), inNamed("missing"));

const empty: Record<string, boolean> = {};
console.log("empty", key("a") in empty);

const names: string[] = [];
for (let i = 0; i < 40; i++) { uniformTypes["u" + i] = "float"; names.push("u" + i, "v" + i); }
let hits = 0;
for (let round = 0; round < 50; round++) for (const n of names) if (has(n)) hits++;
console.log("loop", hits);
