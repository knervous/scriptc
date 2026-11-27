/** The host-backed Date members (browser target: a Date is the host's own Date, an opaque page value).
 *
 * Each member is one named, typed host import `js.date.<method>.<arity>(d: externref, ...args) -> result`; the web host implements it
 * as exactly `d.<method>(...args)`. The statics are `js.date.parse.1(s: js-string) -> f64` and `js.date.UTC.<n>(f64 * n) -> f64`
 * (no receiver); `js.date.now.0() -> f64` predates this table. Arguments are f64 (the setters), or externref page values (the
 * toLocale*String locales and options). Results are f64 or a js-string (toJSON answers null for an invalid time value, the one
 * externref result). */
export type DateHostArg = "f64" | "extern";
export type DateHostResult = "f64" | "string";
export interface DateHostMember { readonly arities: readonly number[]; readonly arg: DateHostArg; readonly ret: DateHostResult }

const mk = (arities: readonly number[], arg: DateHostArg, ret: DateHostResult): DateHostMember => ({ arities, arg, ret });
const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** Getter name -> the calendar field. */
const GETTERS = ["FullYear", "Month", "Date", "Day", "Hours", "Minutes", "Seconds", "Milliseconds"] as const;
/** Setter name -> the argument counts it takes (FullYear year[, month[, date]]; Hours h[, m[, s[, ms]]]; ...). */
const SETTERS: Record<string, readonly number[]> = {
  FullYear: range(1, 3), Month: range(1, 2), Date: [1], Hours: range(1, 4), Minutes: range(1, 3), Seconds: range(1, 2), Milliseconds: [1],
};

export const DATE_HOST_MEMBERS: Readonly<Record<string, DateHostMember>> = (() => {
  const out: Record<string, DateHostMember> = {
    getTime: mk([0], "f64", "f64"),
    valueOf: mk([0], "f64", "f64"),
    getTimezoneOffset: mk([0], "f64", "f64"),
    setTime: mk([1], "f64", "f64"),
    toISOString: mk([0], "f64", "string"),
    // (toJSON answers null for an invalid time value although the lib types it `string`: the emitter throws a TypeError there.)
    toJSON: mk([0], "f64", "string"),
    toString: mk([0], "f64", "string"),
    toDateString: mk([0], "f64", "string"),
    toTimeString: mk([0], "f64", "string"),
    toUTCString: mk([0], "f64", "string"),
    toLocaleDateString: mk([0, 1, 2], "extern", "string"),
    toLocaleTimeString: mk([0, 1, 2], "extern", "string"),
    toLocaleString: mk([0, 1, 2], "extern", "string"),
  };
  for (const f of GETTERS) {
    out[`get${f}`] = mk([0], "f64", "f64");
    out[`getUTC${f}`] = mk([0], "f64", "f64");
  }
  for (const [f, arities] of Object.entries(SETTERS)) {
    out[`set${f}`] = mk(arities, "f64", "f64");
    out[`setUTC${f}`] = mk(arities, "f64", "f64");
  }
  return out;
})();

/** hostHandles only: the locale formatters' JSON variants `js.date.<method>.2j(d, locales: externref, optionsJson: js-string) -> js-string`.
 * A native host cannot read a compiled object, so a compiled options object (plain data) crosses as its JSON text ("" when absent) and a
 * compiled locale list (a string array) as a JSON array text (a js-string starting with "["; locale tags never do). A locale string or a
 * page value passes as itself. The web host's variant is d.<method>(locales as parsed, options as parsed). A page-value options object
 * still uses the plain `.1` / `.2` member. */
export const DATE_LOCALE_METHODS: readonly string[] = ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"];

/** Date.UTC(year[, month[, date[, hours[, minutes[, seconds[, ms]]]]]]): `js.date.UTC.<n>`, n in 1..7. */
export const DATE_UTC_ARITIES: readonly number[] = range(1, 7);
/** `new Date(a, b, ...)` with 2..7 numbers: `js.construct.<n>(js.global.Date, ...)`. */
export const DATE_PARTS_ARITIES: readonly number[] = range(2, 7);
