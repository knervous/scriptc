var log = [];
function show(label, f) { try { log.push(label + "=" + JSON.stringify(f())); } catch (e) { log.push(label + "!" + (e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : String(e && e.message))); } }
export function react(node, type) {
  show("nodeName", () => node.nodeName.toLowerCase());
  show("type-indexOf", () => type.toLowerCase().indexOf("on"));
  show("isInput", () => node.nodeName && node.nodeName.toLowerCase() === "input");
  show("typeof-member", () => [typeof node.nodeName.toLowerCase, typeof node.nodeName.length, typeof type.nope]);
  show("length-index", () => [node.nodeName.length, node.nodeName[0], node.nodeName[9], type[1], type.length]);
}
export function strings(s) {
  show("case", () => [s.toLowerCase(), s.toUpperCase(), s.toLocaleLowerCase(), s.toLocaleUpperCase()]);
  show("search", () => [s.indexOf("l"), s.indexOf("l", 4), s.lastIndexOf("l"), s.lastIndexOf("l", 2), s.includes("lo W"), s.includes("x"), s.startsWith("He"), s.startsWith("lo", 3), s.endsWith("ld"), s.endsWith("He", 2)]);
  show("search-regex", () => [s.search(/o/), s.search(/z/), s.match(/o/g), s.match(/(l+)(o)/) !== null, s.match(/q/), [...s.matchAll(/o/g)].map(function (m) { return m.index; })]);
  show("slicing", () => [s.slice(1, 4), s.slice(-3), s.slice(2, -2), s.substring(4, 1), s.substring(-1, 2), s.substr(1, 3), s.substr(-3, 2), s.at(0), s.at(-1), s.at(99), s.charAt(1), s.charAt(99), s.charCodeAt(1), s.charCodeAt(99), s.codePointAt(0), s.codePointAt(99)]);
  show("split", () => [s.split(" "), s.split(""), s.split("l", 2), s.split(/o/), s.split(), s.split(/(l)/)]);
  show("replace", () => [s.replace("l", "L"), s.replace(/l/g, "L"), s.replaceAll("l", "L"), s.replace(/(W)(o)/, "$2$1"), s.replace("o", function (m, off) { return "[" + m + off + "]"; }), s.replaceAll(/o/g, function (m, off) { return off; }), s.replace("l", "$&$&")]);
  show("replaceAll-bad", () => s.replaceAll(/o/, "x"));
  show("trim", () => ["  a b  ".trim() + "|", "  a b  ".trimStart() + "|", "  a b  ".trimEnd() + "|", s.padStart(14, "*"), s.padEnd(14, "ab"), s.padStart(2), "ab".repeat(3), "ab".repeat(0), s.concat("!", 1, null)]);
  show("repeat-bad", () => "a".repeat(-1));
  show("misc", () => ["Å".normalize("NFC").length, "a".localeCompare("b"), "b".localeCompare("a"), "a".localeCompare("a"), s.toString(), s.valueOf(), [...s].length, [...s][1], typeof s[Symbol.iterator]]);
  show("fn-values", () => { var up = s.toUpperCase; var sl = s.slice; return [up.call("abc"), sl.call("abcdef", 2, 4), typeof up, up.name, sl.length]; });
}
export function numbers(n) {
  show("toFixed", () => [n.toFixed(), n.toFixed(2), n.toFixed(10), (0.5).toFixed(0), (1.005).toFixed(2), (-1.5).toFixed(0), (1e21).toFixed(2)]);
  show("toFixed-range", () => n.toFixed(101));
  show("toPrecision", () => [n.toPrecision(), n.toPrecision(2), n.toPrecision(10), (123456).toPrecision(2), (0.000123).toPrecision(2)]);
  show("toExponential", () => [n.toExponential(), n.toExponential(2), n.toExponential(0), (n * 10000).toExponential(1)]);
  show("toString", () => [n.toString(), n.toString(2), n.toString(16), (255).toString(16), (-255).toString(36), (0.5).toString(2), NaN.toString(), (1 / 0).toString(), (1e21).toString()]);
  show("toString-radix-bad", () => n.toString(1));
  show("valueOf-toLocale", () => [n.valueOf(), n.toLocaleString("en-US"), n.toLocaleString()]);
  show("fn-values", () => { var f = n.toFixed; return [f.call(3.14159, 1), typeof f]; });
}
export function booleans(b) {
  show("bool", () => [b.toString(), b.valueOf(), (!b).toString(), typeof b.toString]);
}
export function symbols(sym) {
  show("symbol", () => [sym.toString(), sym.description, typeof sym.toString, sym.valueOf() === sym]);
}
export function dump() { return log.join("\n"); }
