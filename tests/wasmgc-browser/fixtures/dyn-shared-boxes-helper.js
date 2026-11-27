// Untyped numbers, booleans and key strings may share boxes (constants,
// small integers, atom names). Sharing must stay unobservable.
export function boxes(n) {
  const out = [];
  // -0 and 0, computed and constant; NaN against itself.
  const negZero = 0 * -1, zero = n - n, lit = -0, nan = 0 / 0;
  out.push([Object.is(negZero, -0), Object.is(zero, 0), Object.is(lit, -0), Object.is(zero, -0), 1 / negZero, 1 / zero, nan === nan, nan !== nan, Object.is(nan, NaN)].join(","));
  // Small integers from different computations, beyond the small range, fractions.
  const a = 5, b = n + 3, c = 1024 + n, d = 1026, e = -128 - n, f = -130, g = 2.5 * n;
  out.push([a === b, c === d, e === f, g === 5, Object.is(b, 5), b + c + e + g, typeof b].join(","));
  const counts = new Map(), seen = new Set();
  for (let i = 0; i < 6; i++) { const k = i % 3; counts.set(k, (counts.get(k) ?? 0) + 1); seen.add(i * 0); seen.add(-0); }
  let cs = "", ss = "";
  counts.forEach(function (v, k) { cs += k + ":" + v + " "; });
  seen.forEach(function (x) { ss += Object.is(x, -0) ? "-0" : String(x); });
  out.push(cs + seen.size + " " + ss);
  // Booleans: constants, comparisons, negation.
  const t = n > 1, u = !t, v = true, w = n === 2;
  out.push([t === v, u === false, w === t, typeof u, String(u), JSON.stringify({ t, u, v, w })].join(","));
  // Key lists: fresh arrays over shared key strings.
  const o = { alpha: 1, beta: 2 };
  o.gamma = 3;
  const k1 = Object.keys(o);
  k1[0] = "changed";
  const k2 = Object.keys(o);
  let joined = "";
  for (const key in o) joined += key + "=" + o[key] + ";";
  out.push(k1.join("+") + " " + k2.join("+") + " " + (k2[0] === "alpha") + " " + joined);
  // Counters that run through the small range and out of it.
  let s = 0, last = 0;
  for (let i = -200; i < 1300; i += 7) { s += i; last = i; }
  out.push(s + " " + last);
  // Larger integers (flag words) share boxes through a small cache of recent
  // values: repeats, alternations, int32 limits, beyond int32, fractions.
  const flags = [1048576, 1048576 | n, 4194304 + n, -1048577 - n, 2147483647, -2147483648, 2147483648 + n, 1e15 + n, 0.5 * n + 1048576];
  let fs = "", acc = 0;
  for (let r = 0; r < 300; r++) { const f = flags[r % flags.length] + (r % 3) * 65536; acc = (acc + (f === flags[r % flags.length] + (r % 3) * 65536 ? 1 : 0)) | 0; if (r < flags.length) fs += f + ","; }
  out.push(fs + acc + " " + (flags[1] === 1048578) + " " + Object.is(flags[6] - 2147483650, 0));
  return out.join(" | ");
}
