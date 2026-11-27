// Outward uses of literal values: console output, concatenation and templates, .length,
// .toUpperCase(), charCodeAt, codePointAt, indexOf on the string, split, typeof, String(),
// as object keys and `in`, JSON.stringify of records, sort and join, localeCompare, and
// string methods called through a union-typed variable.
type Color = "red" | "green" | "blue" | "amber";
const colors: Color[] = ["red", "green", "blue", "amber"];
const c: Color = "green";

console.log(c);
console.log("color: " + c, `<${c}>`, c + c, [c, c].join(""));
console.log(c.length, c.toUpperCase(), c.charCodeAt(0), c.codePointAt(1), c.at(-1), c[2], c.charAt(3));
console.log(c.indexOf("e"), c.includes("ree"), c.startsWith("gr"), c.endsWith("n"), c.split("e").join("|"), c.replace("e", "E"));
console.log(typeof c, String(c), c.toString(), c.repeat(2), c.padStart(7, "."), c.slice(-3), c.substring(1, 3));
console.log(c.localeCompare("blue"), c < "red", c > "amber", colors.map((x) => x.localeCompare(c)).join(","));

// As keys.
const obj: Partial<Record<Color | "other", number>> = {};
// Filled in sorted key order: see lit-defect-partial-record-order.
const sortedColors = [...colors].sort();
for (let i = 0; i < sortedColors.length; i++) obj[sortedColors[i]] = i;
console.log(JSON.stringify(obj), c in obj, "red" in obj, "other" in obj, obj[c], obj[colors[3]]);
const rec = { [c]: true, other: colors[0] };
console.log(JSON.stringify(rec), Object.keys(rec).join(","));

// Sorting and joining.
console.log([...colors].sort().join(","), [...colors].sort((a, b) => b.localeCompare(a)).join(" "), colors.join());
console.log([...colors].sort((a, b) => a.length - b.length).map((x) => x.length).join(""));

// Iterating the characters of a literal value.
const chars: string[] = [];
for (const ch of colors[3]) chars.push(ch);
console.log(chars.join("."), colors[2].split("").reverse().join(""));

// String concatenation building a key from two literals, then compared to a literal.
type Size = "s" | "l";
const s: Size = "l";
const key = c + "/" + s;
console.log(key, key === "green/l", key.length, JSON.stringify({ key, c, s }));

// A literal used as a regex input and a number conversion.
console.log(/e+/.test(c), c.match(/[aeiou]/g)?.join(""), Number(c), parseInt(c, 36));

// Object.entries of a record with literal values, then mapped through string methods.
const theme: { primary: Color; accent: Color } = { primary: "blue", accent: "amber" };
console.log(Object.entries(theme).map(([k, v]) => `${k.toUpperCase()}=${v.toUpperCase()}`).join(";"), JSON.stringify(theme));
