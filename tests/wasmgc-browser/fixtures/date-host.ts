// A Date is the host's own Date (an opaque page value): every constructor form, every member and the statics are host calls.
const out: string[] = [];
function log(label: string, ...v: (number | string | boolean)[]): void { out.push(label + " " + v.map((x) => String(x)).join(" ")); }

// Constructors: none (the clock is only compared), milliseconds, a string, another Date, 2..7 numbers.
const now = new Date();
log("now", now.getTime() > 1.5e12, Math.abs(now.getTime() - Date.now()) < 5000);
const ms = new Date(86400000 * 400 + 123);
const str = new Date("2020-02-03T04:05:06.789Z");
const copy = new Date(str);
const parts2 = new Date(2020, 1);
const parts3 = new Date(2020, 1, 29);
const parts7 = new Date(2020, 11, 31, 23, 59, 58, 999);
log("ctor", ms.getTime(), str.getTime(), copy.getTime(), parts2.getTime() > 0, parts3.getDate(), parts7.getMilliseconds());
log("copy", copy === str, copy.getTime() === str.getTime(), str === str);
log("overflow", new Date(2020, 12, 1).getFullYear(), new Date(99, 0, 1).getFullYear(), new Date(NaN).getTime(), new Date(8.64e15 + 1).getTime());

// Getters, local and UTC.
const d = new Date(Date.UTC(2021, 5, 15, 13, 14, 15, 161));
log("utc", d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
log("local", d.getFullYear() >= 2021, d.getMonth() >= 0, d.getDate() >= 1, d.getDay() >= 0, d.getHours() >= 0, d.getMinutes() >= 0, d.getSeconds(), d.getMilliseconds());
log("offset", d.getTimezoneOffset() === new Date(2021, 5, 15).getTimezoneOffset(), d.valueOf() === d.getTime());

// Setters return the new time value.
const s = new Date(Date.UTC(2000, 0, 31, 0, 0, 0, 0));
log("setUTC", s.setUTCMonth(1), s.toISOString(), s.setUTCDate(15), s.setUTCHours(1, 2, 3, 4), s.setUTCMinutes(30), s.setUTCSeconds(5, 6), s.setUTCMilliseconds(7), s.setUTCFullYear(2001, 2, 3));
log("setTime", s.setTime(0), s.toISOString(), s.setTime(NaN), s.getTime());
const l = new Date(2000, 0, 1, 0, 0, 0, 0);
l.setFullYear(2010); l.setMonth(5, 20); l.setDate(3); l.setHours(4, 5, 6, 7); l.setMinutes(8); l.setSeconds(9); l.setMilliseconds(10);
log("setLocal", l.getFullYear(), l.getMonth(), l.getDate(), l.getHours(), l.getMinutes(), l.getSeconds(), l.getMilliseconds());

// Formatting that does not depend on the time zone.
const f = new Date(Date.UTC(2021, 0, 2, 3, 4, 5, 6));
log("fmt", f.toISOString(), f.toJSON(), f.toUTCString());
log("locale", f.toLocaleDateString("en-US", { timeZone: "UTC" }), f.toLocaleTimeString("en-US", { timeZone: "UTC" }), f.toLocaleString("en-US", { timeZone: "UTC" }));
log("locale-list", f.toLocaleDateString(["en-US", "de-DE"], { timeZone: "UTC" }), f.toLocaleTimeString(["de-DE"], { timeZone: "UTC", hour12: false }), f.toLocaleString(["en-GB"]));
log("locale1", f.toLocaleDateString("en-GB", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }), f.toLocaleTimeString("de-DE", { timeZone: "UTC", hour12: false }));
log("strings", f.toString().length > 20, f.toDateString().length === 15, f.toTimeString().length > 10, String(f) === f.toString(), `${f}` === f.toString());
try { new Date(NaN).toISOString(); } catch (e) { log("invalid", (e as Error).name, (e as Error).message); }
log("invalid2", String(new Date(NaN)), new Date(NaN).toUTCString());

// Statics.
log("static", Date.UTC(2020), Date.UTC(2020, 1), Date.UTC(2020, 1, 2), Date.UTC(2020, 1, 2, 3), Date.UTC(2020, 1, 2, 3, 4), Date.UTC(2020, 1, 2, 3, 4, 5), Date.UTC(2020, 1, 2, 3, 4, 5, 6));
log("parse", Date.parse("2020-01-01T00:00:00Z"), Date.parse("2020-01-01"), Date.parse("nonsense"), Date.parse("Thu, 01 Jan 1970 00:00:00 GMT"));

// The language-level behaviour of a Date value.
const a = new Date(5), b = new Date(9);
log("typeof", typeof a, a instanceof Date, a === a, a === new Date(5), a !== b);
log("primitive", +a, -a, a < b, a <= b, a > b, a >= b, Number(a));
log("json", JSON.stringify(a), JSON.stringify(new Date(NaN)), JSON.stringify({ at: a, n: 1 }), JSON.stringify([a, b]));

// Dates in containers, fields, parameters and optional slots.
class Event { at = new Date(1000); when(): number { return this.at.getTime(); } }
log("class", new Event().when(), new Event().at instanceof Date);
const list = [new Date(3), new Date(1), new Date(2)];
list.sort((x, y) => x.getTime() - y.getTime());
log("array", list.map((x) => x.getTime()).join(), list.length, JSON.stringify(list));
const byName = new Map<string, Date>();
byName.set("a", new Date(4));
log("map", byName.get("a")!.getTime(), byName.has("b"));
function ms0(x?: Date): number { return x ? x.getTime() : -1; }
log("optional", ms0(), ms0(new Date(2)));
const rec = { at: new Date(7) };
log("record", rec.at.getTime(), JSON.stringify(rec));
console.log(a);
console.log(out.join("\n"));
