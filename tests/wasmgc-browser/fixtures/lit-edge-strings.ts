// Edge-case literal members: the empty string, a lone low surrogate at the start ("\uDFFFx"),
// a lone high surrogate, non-ASCII, astral characters, number-looking strings ("0", "1", "01"),
// and strings that differ only in case or a trailing space. Each must keep its exact code units
// through comparison, switch, Map/Set keys, JSON, length and charCodeAt.
type Odd = "" | "\uDFFFx" | "\uD800" | "café" | "\u{1F600}" | "\u{1F600}!" | "0" | "1" | "01" | "a" | "A" | "a ";
const ODD: Odd[] = ["", "\uDFFFx", "\uD800", "café", "\u{1F600}", "\u{1F600}!", "0", "1", "01", "a", "A", "a "];

function tag(o: Odd): number {
  switch (o) {
    case "": return 0;
    case "\uDFFFx": return 1;
    case "\uD800": return 2;
    case "café": return 3;
    case "\u{1F600}": return 4;
    case "\u{1F600}!": return 5;
    case "0": return 6;
    case "1": return 7;
    case "01": return 8;
    case "a": return 9;
    case "A": return 10;
    case "a ": return 11;
  }
}
function countPoints(s: string): number { let n = 0; for (const _ of s) n++; return n; }
function codes(s: string): string { const out: number[] = []; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); return out.join("."); }

console.log(ODD.map(tag).join(","));
console.log(ODD.map((o) => o.length).join(","));
console.log(ODD.map(codes).join(" "));
console.log(ODD.map((o) => JSON.stringify(o)).join(" "));

// Pairwise equality: exactly the diagonal matches.
let eq = 0, ne = 0;
for (const a of ODD) for (const b of ODD) { if (a === b) eq++; if (a !== b) ne++; }
console.log(eq, ne);

// Runtime-built equivalents compare equal to the literals.
const built: string[] = ["", String.fromCharCode(0xdfff) + "x", String.fromCharCode(0xd800), "cafe".slice(0, 3) + "é", String.fromCodePoint(0x1f600), String.fromCodePoint(0x1f600) + "!", String(0), (1).toString(), "0" + 1, "A".toLowerCase(), "a".toUpperCase(), "a" + " "];
console.log(built.map((b) => ODD.indexOf(b as Odd)).join(","), built.every((b, i) => b === ODD[i]), built.map((b) => tag(b as Odd)).join(","));

// Number-looking members are strings, not numbers.
const zero: Odd = "0";
const one: Odd = "1";
console.log(typeof zero, zero + one, (zero as string) === "0", zero.length, JSON.stringify([zero, one]), Number(one) + 1);

// As Map and Set keys, as object keys (number-like keys enumerate first).
const m = new Map<Odd, number>();
for (const o of ODD) m.set(o, tag(o));
console.log(m.size, m.get(""), m.get("\uDFFFx"), m.get(String.fromCharCode(0xdfff, 120) as Odd), m.get("\u{1F600}!"));
const s = new Set<string>(ODD);
s.add(built[1]);
s.add(built[4]);
console.log(s.size);
const o: Record<string, number> = {};
for (const k of ODD) o[k] = tag(k);
console.log(Object.keys(o).map((k) => JSON.stringify(k)).join(","), Object.keys(o).includes(""), Object.keys(o).indexOf("01"), o["1"]);

// Sorting by code units and joining.
console.log([...ODD].sort().map((x) => JSON.stringify(x)).join(""));
console.log(ODD.join("|").length, ODD.filter((x) => x.length === 0).length, countPoints(ODD[4]), ODD[5].codePointAt(0));

// Lone surrogate held in a field and a local, round-tripped.
class Holder { v: Odd = "\uDFFFx"; }
const h = new Holder();
let local: Odd = h.v;
console.log(local === "\uDFFFx", codes(local), JSON.stringify(h), local.charCodeAt(0) === 0xdfff);
local = "\uD800";
h.v = local;
console.log(h.v === "\uD800", codes(h.v), JSON.stringify(h.v));
