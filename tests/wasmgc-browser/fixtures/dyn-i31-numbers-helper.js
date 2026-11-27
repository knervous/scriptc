// Untyped numbers under experimentalDynI31: integers in [-2^30, 2^30) other
// than -0 are i31refs, every other number a box. The split must be
// unobservable at every boundary: -0, the i31 limits (computed and literal),
// NaN, large integers, fractions, equality across forms, arithmetic that
// crosses the limits, keys, JSON, Map/Set keys, switch labels and page round trips.
function show(x) { return Object.is(x, -0) ? "-0" : String(x); }
function list(a) { let s = ""; for (let i = 0; i < a.length; i++) s += (i ? "," : "") + show(a[i]); return s; }
function types(a) { let s = ""; for (let i = 0; i < a.length; i++) s += (i ? "," : "") + typeof a[i]; return s; }
export function edges(n) {
  const out = [];
  const top = 1073741821 + n, over = top + 1, low = -top - 1, under = low - 1;
  const negZero = 0 * -n, zero = n - n, nan = 0 / zero, inf = n / zero, half = n / 2;
  const vals = [zero, negZero, n, -n, top, over, low, under, 2147483645 + n, 2147483646 + n, -2147483650 + n, 2 ** 53 + n - 2, half, -half, nan, inf, -inf];
  out.push(list(vals));
  out.push(types(vals));
  // Literals equal their computed twins (both forms, both sides of each limit).
  out.push([top === 1073741823, over === 1073741824, low === -1073741824, under === -1073741825, over - 1 === top, low + 1 === -1073741823,
    negZero === 0, 0 === negZero, Object.is(negZero, 0), Object.is(negZero, -0), Object.is(zero, 0), nan === nan, Object.is(nan, NaN),
    half === 1, half * 2 === n * 1, 2 ** 30 === over, -(2 ** 30) === low].join(","));
  // Loose equality and relational operators across forms.
  out.push([top == "1073741823", over == "1073741824", negZero == "0", zero == false, n == true, half == "1", over > top, under < low, top < over, negZero < zero, negZero <= zero, nan < 1, nan >= 1].join(","));
  // Arithmetic crossing the limits in both directions.
  out.push(list([top + 1, top + top, over - 1, low - 1, low * 2, under + 1, top * 2, -low, low / 2, over / 2, top % 7, low % 7, top ** 1, 1 / negZero, 1 / zero, -zero, zero * -1, negZero + 0, negZero - 0]));
  // Remainders (-0 for a zero remainder of a negative dividend, NaN for a zero
  // divisor), products past the limits and signed zeros, quotients.
  out.push(list([-n % n, -4 % n, 5 % -3, -5 % 3, top % zero, zero % 5, negZero % 5, low % -1, under % 2, top % top, low % low, n % half,
    top * top, low * low, low * -1, zero * -n, -n * zero, n * half, top * -1, low / -1, -n / n, zero / -n, top / top, 7 / n]));
  // Relational operators within and across forms.
  out.push([top < over, low > under, half < n, negZero < zero, nan < nan, zero <= negZero, n >= half + 1, over > 2147483646 + n, low <= -1073741824, under < -1073741824, -n < negZero].join(","));
  let c = top - 3, steps = "";
  for (let i = 0; i < 6; i++) { steps += show(c) + (c === 1073741820 + i ? "" : "!") + " "; c++; }
  let d = low + 2; for (let i = 0; i < 4; i++) { steps += show(d) + " "; d--; }
  out.push(steps.trim());
  // Bitwise and shifts over boundary values (ToInt32 of both forms).
  out.push(list([top | 0, over | 0, over << 1, top << 1, low >> 1, under >> 0, under >>> 0, (2147483646 + n) | 0, -1 >>> 0, ~top, ~over, top & over, over ^ low, negZero | 0, half | 0, nan | 0, inf | 0]));
  // Keys: an i31 index, its string twin, a large integer key, -0, fractions.
  const arr = [10, 20, 30];
  arr[n + 1] = 40; arr[zero] = 11; arr[negZero + 1] = 21;
  const o = {};
  o[n] = "a"; o[top] = "b"; o[over] = "c"; o[negZero] = "z"; o[half + 0.5] = "h"; o[under] = "u";
  out.push(arr.join("/") + " " + arr[3] + " " + arr[n + 1] + " " + arr["1"] + " " + arr[over] + " " + arr[-n] + " " + arr[half] + " " + (n in arr) + " " + (over in arr));
  out.push(Object.keys(o).join("/") + " " + o["1"] + o["1073741823"] + o["1073741824"] + o["0"] + o[zero] + o["1.5"] + o[-1073741825] + " " + (top in o) + (over in o) + ("-0" in o));
  // JSON in both directions.
  const parsed = JSON.parse('[0,-0,1,1073741823,1073741824,-1073741824,-1073741825,1.5,1e21,2147483648]');
  out.push(JSON.stringify([zero, negZero, n, top, over, low, under, half, nan, inf, 2 ** 53]) + " " + JSON.stringify({ [top]: over, k: negZero }));
  out.push(list(parsed) + " " + [parsed[3] === top, parsed[4] === over, parsed[1] === 0, Object.is(parsed[1], -0), parsed[2] === n - 1, parsed[9] === 2147483648].join(","));
  // Map and Set keys mixing forms: SameValueZero (-0 is 0, NaN is NaN).
  const m = new Map(), s = new Set();
  m.set(n, "one"); m.set(over, "over"); m.set(top, "top"); m.set(negZero, "zero"); m.set(nan, "nan"); m.set(half, "half");
  s.add(zero); s.add(negZero); s.add(over); s.add(1073741824); s.add(top); s.add(1073741823); s.add(nan); s.add(0 / 0); s.add(half); s.add(1);
  out.push([m.get(1), m.get(half * 2), m.get(1073741824), m.get(top), m.get(0), m.get(-0), m.get(NaN), m.get(1), m.has(2 ** 30), m.has(over - 1), m.size, s.size].join(","));
  let ks = ""; m.forEach((v, k) => { ks += show(k) + ":" + v + " "; });
  let ss = ""; s.forEach((k) => { ss += show(k) + " "; });
  out.push(ks.trim() + " | " + ss.trim());
  // Switch labels over both forms (0 matches -0; a box label; NaN never matches).
  const sw = (x) => { switch (x) { case 0: return "zero"; case 1: return "one"; case 1073741823: return "top"; case 1073741824: return "over"; case -1073741825: return "under"; case 1.5: return "frac"; case NaN: return "nan"; default: return "other"; } };
  const swIn = [zero, negZero, n, top, over, under, half + 0.5, nan, "1", 2, low]; let swOut = "";
  for (let i = 0; i < swIn.length; i++) swOut += (i ? "," : "") + sw(swIn[i]);
  out.push(swOut);
  const swNeg = (x) => { switch (x) { case -0: return "negzero"; case 7: return "seven"; case -7: return "minus"; default: return "other"; } };
  const negIn = [zero, negZero, 7, -7, 7.5]; let negOut = "";
  for (let i = 0; i < negIn.length; i++) negOut += (i ? "," : "") + swNeg(negIn[i]);
  out.push(negOut);
  // Number methods and conversions on both forms.
  out.push([top.toString(16), over.toString(2).length, (n).toFixed(2), half.toFixed(1), String(negZero), `${negZero}`, negZero.toString(), parseFloat("1073741824") === over, parseInt("-1073741825") === under, +"1073741823" === top, +"-0" === 0, Math.max(top, over), Math.min(low, under)].join(","));
  return out.join("\n");
}
/** Numbers crossing to the page and back: a page Map, a page array, page JSON. */
export function page(n, PageMap, PageArray, pageJSON) {
  const out = [];
  const top = 1073741821 + n, over = top + 1, negZero = 0 * -n, half = n / 4;
  const pm = new PageMap();
  pm.set(n, "one"); pm.set(over, "over"); pm.set(negZero, "zero"); pm.set(half, "half"); pm.set(top, "top");
  out.push([pm.get(1), pm.get(1073741824), pm.get(0), pm.get(0.5), pm.get(top), pm.size].join(","));
  let ks = ""; pm.forEach(function (v, k) { ks += show(k) + "=" + v + ":" + (k === 2 || k === over || k === 0 || k === 0.5 || k === top) + " "; });
  out.push(ks.trim());
  const pa = PageArray.of(0, negZero, n, top, over, -over, -over - 1, half, 2 ** 53);
  const back = [];
  for (let i = 0; i < pa.length; i++) back.push(pa[i]);
  out.push(list(back) + " " + [back[3] === top, back[4] === over, back[4] - 1 === top, Object.is(back[1], -0), back[2] + back[3], typeof back[4]].join(","));
  const round = pageJSON.parse(pageJSON.stringify({ a: top, b: over, c: negZero, d: half, e: [n, -over - 1] }));
  out.push([round.a === top, round.b === over, round.c === 0, Object.is(round.c, 0), round.d === half, round.e[1] === -1073741825, round.a + round.b].join(","));
  return out.join("\n");
}
