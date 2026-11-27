// JS `%` on untyped numbers: the exact remainder (fmod) for every class of operand.
var fmt = function (v) { return Object.is(v, -0) ? "-0" : String(v); };
export var EDGES = [0, -0, 1, -1, 2, -2, 3, -3, 7, -7, 0.5, -0.5, 1.5, 5.5, -5.5, 0.1, 0.3, -0.3, 1e-300, 5e-324, -5e-324, 1e-310, 2.2250738585072014e-308,
  2.225073858507201e-308, 9007199254740991, 9007199254740992, -9007199254740993, 4503599627370496.5, 1e15 + 0.25, 2147483647, -2147483648, 4294967296,
  1e21, 1e300, -1e300, 1.7976931348623157e308, -1.7976931348623157e308, Infinity, -Infinity, NaN, Math.PI, Math.E, 123456789.123, 6.02214076e23];
export function table(mod) {
  var out = [];
  for (var i = 0; i < EDGES.length; i++) { var row = []; for (var j = 0; j < EDGES.length; j++) row.push(fmt(mod(EDGES[i], EDGES[j]))); out.push(row.join(",")); }
  return out.join("\n");
}
export function dynMod(a, b) { return a % b; }
// Pseudo-random operands over the whole exponent range (both signs, subnormals): a checksum of the exact results.
export function sweep(mod, n) {
  var seed = 7, h = 0, zeros = 0, nans = 0;
  var next = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  var num = function () { var m = next() / 2147483648 + next() / 4611686018427387904; var e = next() % 2150 - 1075; var s = next() % 2 ? -1 : 1; return s * m * Math.pow(2, e); };
  for (var i = 0; i < n; i++) {
    var a = num(), b = i % 5 === 0 ? Math.floor(num() / Math.pow(2, 40)) : num();
    var r = mod(a, b), str = fmt(r);
    if (r === 0) zeros++; if (r !== r) nans++;
    for (var k = 0; k < str.length; k++) h = (h * 31 + str.charCodeAt(k)) | 0;
  }
  // Integral operands (the i64 path), including negative dividends with zero remainders.
  for (var q = -60; q <= 60; q++) for (var d = -7; d <= 7; d++) { var s2 = fmt(mod(q * 3, d)); for (var k2 = 0; k2 < s2.length; k2++) h = (h * 31 + s2.charCodeAt(k2)) | 0; }
  return [h, zeros, nans].join(" ");
}
// Loop-carried: an int counter mod a constant (the common shape).
export function counters() { var s = 0; for (var i = -1000; i < 1000; i++) s += i % 7 + (i * 0.5) % 3; return s; }
