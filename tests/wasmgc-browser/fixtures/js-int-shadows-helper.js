// Int shadows (native dyn): untyped locals and parameters that mostly hold
// int32s keep an unboxed copy. Every value JS can put in them still behaves
// exactly: objects with valueOf (called once per use, in order), strings,
// -0, NaN, fractions, unsigned >>> results, undefined, and throws midway.

// A bitwise definition, int uses, other uses, then a definition of another kind.
export function bits(a, b) {
  var x = a & b, out = [];
  if (x & 1) out.push("odd");
  out.push(x === 4 ? "four" : "not4", x !== 0, x === "4", String(x));
  x = a;
  out.push(x | 0, x === 4, typeof x, x & 3);
  return out.join(" ");
}

// Parameters used as int words: tested once at entry.
export function lanes(render, a, b) {
  var r = 0;
  if ((a & render) !== render) r |= 1;
  if ((b & render) === render) r |= 2;
  if (render === 3) r |= 4;
  return r + ":" + (render & 7) + ":" + (render ^ a);
}

// A switch over a bitwise value: dense labels (one table), a duplicate
// label (the first wins), shared bodies and a default before the last label.
export function dense(n) {
  var out = "", k = n & 15;
  if (n === "x") k = n;
  switch (k) {
    case 0: out += "zero"; break;
    case 1: case 2: out += "one-two"; break;
    case 3: out += "three"; break;
    case 3: out += "dup"; break;
    case 5: case 6: out += "five-six"; break;
    case 9: out += "nine"; break;
    default: out += "default"; break;
    case 12: out += "twelve";
  }
  return out;
}

// Sparse and negative labels: compares, not a table.
export function sparse(n) {
  var k = n | 0;
  if (n === "x") k = n;
  switch (k) {
    case -5: return "neg";
    case 1: return "one";
    case 1000: return "thousand";
    case 40000: return "big";
    case 2147483647: return "max";
    default: return "other";
  }
}

// A local defined as an int and as anything else; ToPrimitive runs once per
// use, left to right.
export function mixed(n, obj, log) {
  var x = n & 255;
  if (obj) x = obj;
  var y = obj ? obj : n & 15;
  return (x & 6) + "," + (x ^ y) + "," + (x === y) + "," + (x === 6);
}

// >>> past 2^31 - 1, -0, NaN and fractions written to an int-used local.
export function edges(a) {
  var u = a >>> 0, out = [];
  out.push(u, u === 4294967295, u & 1, u === -1);
  u = a * 0;
  out.push(Object.is(u, -0), u === 0, u | 0);
  u = a / 0 - a / 0;
  out.push(u === u, u | 0);
  u = a + 0.5;
  out.push(u, u === a + 0.5, u & 3);
  return out.join(" ");
}

// A throw inside a definition leaves the old value; a closure sees the box.
export function throwing(n, bad) {
  var x = n & 3;
  try { x = bad.flags & 1; } catch (e) { return "caught " + x + " " + (x & 2); }
  return "ok " + x;
}
export function captured(n) {
  var x = n & 3;
  var f = function () { return x & 1; };
  x = n & 12;
  return f() + ":" + x;
}

// A loop: int defs and uses, a non-int value at the end, the last value read as dyn.
export function loop(arr) {
  var acc = 0, x;
  for (var i = 0; i < arr.length; i++) {
    x = arr[i] & 255;
    if (x === 0) continue;
    acc = (acc ^ x) | 0;
  }
  return acc + ":" + x;
}

// Copies between shadowed locals.
export function copies(a, b) {
  var x = a & 7, y = x, z;
  if ((y & 1) === 1) z = y; else z = b;
  return (z | 0) + ":" + (y === x) + ":" + (z === y) + ":" + z;
}
