// Math's transcendentals compiled into the module (fdlibm): special values exactly, other results to 11 places (V8 built for
// arm64 fuses multiply-adds, so its last bit differs from plain IEEE by host; the module's answer is the same everywhere).
const specials = [0, -0, 1, -1, 0.5, 2, 10, 1e-310, 5e-324, 709.5, -745.5, 1e22, 1e300, Infinity, -Infinity, NaN, Math.PI / 2, Math.PI, 2 ** 20 * Math.PI];
const names = ["sin", "cos", "tan", "asin", "acos", "atan", "exp", "expm1", "log", "log1p", "log2", "log10", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt"];
const fns: ((x: number) => number)[] = [Math.sin, Math.cos, Math.tan, Math.asin, Math.acos, Math.atan, Math.exp, Math.expm1, Math.log, Math.log1p, Math.log2, Math.log10, Math.sinh, Math.cosh, Math.tanh, Math.asinh, Math.acosh, Math.atanh, Math.cbrt];
const show = (v: number): string => (Number.isFinite(v) && v !== 0 && Math.abs(v) > 1e-9 && Math.abs(v) < 1e9 ? v.toFixed(11) : String(v));
const lines: string[] = [];
const direct: number[][] = [
  [Math.sin(0.5), Math.cos(0.5), Math.tan(0.5), Math.asin(0.5), Math.acos(0.5), Math.atan(0.5), Math.exp(0.5), Math.expm1(0.5), Math.log(0.5), Math.log1p(0.5), Math.log2(0.5), Math.log10(0.5)],
  [Math.sinh(0.5), Math.cosh(0.5), Math.tanh(0.5), Math.asinh(0.5), Math.acosh(1.5), Math.atanh(0.5), Math.cbrt(0.5), Math.atan2(1, 2), Math.pow(2, 0.5), 2 ** 10, 3 ** 0.5, 10 ** -3],
];
for (const row of direct) lines.push(row.map(show).join(" "));
for (let i = 0; i < names.length; i++) lines.push(names[i] + ": " + specials.map(x => show(fns[i]!(x))).join(" "));
lines.push("atan2: " + [[0, 0], [-0, 0], [0, -0], [-0, -0], [1, -1], [-1, -1], [Infinity, Infinity], [-Infinity, 5], [3, Infinity], [NaN, 1], [1, 1e-300]].map(([y, x]) => show(Math.atan2(y!, x!))).join(" "));
lines.push("pow: " + [[2, 10], [0, 0], [NaN, 0], [1, Infinity], [-1, Infinity], [-8, 1 / 3], [-8, 3], [-2, 1075], [2, -1075], [2, -1074], [10, 308], [10, 309], [0, -1], [-0, -3], [Infinity, -2], [0.5, 1e10], [1.0000001, 1e9]].map(([x, y]) => show(Math.pow(x!, y!))).join(" "));
let acc = 0;
for (let i = 1; i <= 2000; i++) { const x = i * 0.37; acc += Math.sin(x) * Math.cos(x * 1.3) + Math.atan2(x, 3) + Math.exp(-x / 400) + Math.log(x) + (x ** 1.7) / 1e4; }
lines.push("sum: " + acc.toFixed(6));
console.log(lines.join("\n"));
