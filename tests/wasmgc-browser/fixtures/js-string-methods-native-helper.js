// String.prototype methods called on untyped strings. indexOf,
// includes, slice and concat (names arrays share) run compiled when their
// arguments are strings / numbers / undefined and the page's own otherwise;
// the string-only names lower to the string intrinsics.
// The strings arrive untyped (parsed), as props and attributes do.
export function make() {
  return JSON.stringify(["hello world", "", "a,b,,c,", " ﻿  mid dle 　\n\t\r     \v\f", "​z᠎", "MiXeD Case 123",
    "😀x😀", "ÄÖü ß İ", "abcabc", "null undefined 1", "lower case", "x"]);
}
const show = (x) => (typeof x === "string" ? JSON.stringify(x) : String(x));
export function probe(text) {
  const v = JSON.parse(text);
  const s = v[0], e = v[1], csv = v[2], ws = v[3], zw = v[4], mixed = v[5], emoji = v[6], intl = v[7], rep = v[8], words = v[9], lower = v[10], x = v[11];
  const out = [];
  const row = (label, xs) => out.push(label + ": " + xs.map(show).join(" "));
  const o = { toString() { return "o"; } };
  row("indexOf", [s.indexOf("o"), s.indexOf("o", 5), s.indexOf("o", -3), s.indexOf("o", 99), s.indexOf("o", NaN), s.indexOf("o", 4.9), s.indexOf("o", Infinity), s.indexOf("o", -Infinity),
    s.indexOf(""), s.indexOf("", 99), s.indexOf("", 3), s.indexOf("zz"), e.indexOf(""), e.indexOf("a"), s.indexOf("world", undefined), emoji.indexOf("\ude00"), rep.indexOf("bc", 2), s.indexOf("o", 4, "extra")]);
  row("indexOf.page", [words.indexOf(null), words.indexOf(undefined), words.indexOf(1), s.indexOf(o), s.indexOf("o", "5"), s.indexOf("o", null), s.indexOf("o", true), s.indexOf()]);
  row("lastIndexOf", [s.lastIndexOf("o"), s.lastIndexOf("o", 5), s.lastIndexOf("o", 4), s.lastIndexOf("o", -1), s.lastIndexOf("h", -1), s.lastIndexOf("o", NaN), s.lastIndexOf("o", undefined),
    s.lastIndexOf(""), s.lastIndexOf("", 3), s.lastIndexOf("", 99), s.lastIndexOf("hello world!"), e.lastIndexOf(""), e.lastIndexOf("a"), rep.lastIndexOf("abc"), rep.lastIndexOf("abc", 2),
    rep.lastIndexOf("c", Infinity), rep.lastIndexOf("a", 0.5), rep.lastIndexOf("a", -Infinity), emoji.lastIndexOf("\ud83d")]);
  row("lastIndexOf.page", [words.lastIndexOf(null), words.lastIndexOf(1), s.lastIndexOf("o", "5"), s.lastIndexOf()]);
  row("includes", [s.includes("lo w"), s.includes("lo w", 4), s.includes(""), e.includes(""), s.includes("x"), s.includes("h", -5), s.includes("d", 11), s.includes("d", 10), words.includes(null), words.includes(1)]);
  row("slice", [s.slice(), s.slice(6), s.slice(-5), s.slice(2, 4), s.slice(4, 2), s.slice(-3, -1), s.slice(0, -20), s.slice(NaN, 3), s.slice(1, NaN), s.slice(undefined, 2), s.slice(2, undefined),
    s.slice(3.7, 5.2), s.slice(-3.7), s.slice(-Infinity, Infinity), s.slice(99), emoji.slice(0, 1), e.slice(0, 5), s.slice(0, 2, 9)]);
  row("slice.page", [s.slice("2"), s.slice(1, "3"), s.slice(null, 2), s.slice(true)]);
  row("concat", [s.concat("!"), s.concat("", "a", "b"), e.concat(""), e.concat(), s.concat(1, null), s.concat(o), x.concat("y", "z", "w", "v")]);
  row("intrinsics", [s.charAt(1), s.charCodeAt(1), s.startsWith("hell"), s.endsWith("world"), s.substring(4, 2), ws.trim(), ws.trimStart(), ws.trimEnd(), zw.trim(),
    mixed.toLowerCase(), mixed.toUpperCase(), lower.toLowerCase(), intl.toLowerCase(), intl.toUpperCase(), emoji.toUpperCase(), csv.split(",").join("|"), csv.split("").join("/"), e.split(",").join("/")]);
  let msg = ""; try { s.includes(/o/); } catch (err) { msg = err.name; }
  row("errors", [msg]);
  return out.join("\n");
}
