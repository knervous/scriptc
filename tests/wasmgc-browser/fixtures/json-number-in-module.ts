// JSON.parse's numbers decided in the module (json-number.ts), the host asked only past its table: every value prints
// with its sign and 17 digits, so a last-bit or -0 difference from the engine shows.
const texts = ["0", "-0", "-0.0e5", "1", "-1", "0.1", "0.30000000000000004", "123.456", "-123.456e-7", "1e22", "1e23", "1e-23",
  "9007199254740993", "4503599627370497.5", "12345678901234567890", "1234567890123456789012", "1.7976931348623157e308", "5e-324",
  "2.2250738585072014e-308", "1e-400", "1e400", "3.141592653589793", "0.000001", "100e-2", "7.2057594037927933e16"];
const show = (x: number): string => (Object.is(x, -0) ? "-0" : x.toPrecision(17));
const lines: string[] = [];
for (const t of texts) lines.push(`${t} -> ${show(JSON.parse(t) as number)}`);
const doc = JSON.parse('{"pos":[1234.5678,-0.25,1e-7],"n":[0.1,0.2,1.0000000000000002,-5e-324],"deep":{"x":-0,"y":9.999999999999999e22}}') as { pos: number[]; n: number[]; deep: { x: number; y: number } };
lines.push(doc.pos.map(show).join(" "), doc.n.map(show).join(" "), `${show(doc.deep.x)} ${show(doc.deep.y)}`);
let sum = 0;
for (let i = 1; i <= 3000; i++) sum += JSON.parse(String(i * 0.37 + 1 / i)) as number;
lines.push(`sum: ${show(sum)}`);
console.log(lines.join("\n"));
