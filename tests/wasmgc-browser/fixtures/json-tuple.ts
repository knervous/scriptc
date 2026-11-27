// JSON.stringify of a typed tuple writes a JSON array (it is a JS array),
// nested in records and arrays and with an indent too.
const t: [number, string] = [1, "a"];
console.log(JSON.stringify(t));
console.log(JSON.stringify(t, null, 2));
const nested: { p: [number, [boolean, string]]; q: [string, number][] } = { p: [1, [true, "x"]], q: [["k", 2]] };
console.log(JSON.stringify(nested));
console.log(JSON.stringify(nested, null, 1));
const u: [number, undefined] = [1, undefined];
console.log(JSON.stringify(u));
