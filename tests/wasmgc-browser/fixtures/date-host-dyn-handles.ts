// @options: {"hostHandles": true}
// @native-only: a Date read back from an unknown value is a native-dyn check (the engine lane has no typed exit for it)
// A Date crossing into dyn is a page value; instanceof Date and the narrowing back are the host's.
const out: string[] = [];
function log(label: string, ...v: (number | string | boolean)[]): void { out.push(label + " " + v.map((x) => String(x)).join(" ")); }
const a = new Date(5);
function isDate(v: unknown): boolean { return v instanceof Date; }
log("unknown", isDate(a), isDate({}), isDate(3), isDate(null), isDate("2020"), isDate([]), isDate(new Date(NaN)));
const u: unknown = a;
if (u instanceof Date) log("narrow", u.getTime());
const items: unknown[] = [a, 1, "x", new Date(9)];
log("scan", items.filter((x) => x instanceof Date).length, items.map((x) => (x instanceof Date ? x.getTime() : -1)).join());
function when(v: unknown): number { return v instanceof Date ? v.getTime() : Number.NaN; }
log("when", when(new Date(11)), when(12));
console.log(out.join("\n"));
