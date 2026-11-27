// Untyped locals that mostly hold small integers: + - and comparisons with overflow, strings and fractions mixed in.
export function probe(rows) {
  const out = [];
  let s = 0;
  for (let i = 0; i < rows.length; i++) s = s + rows[i].n;
  out.push(s);
  let big = 2147483600;
  for (let j = 0; j < 100; j++) big = big + 1;
  out.push(big, big - 4294967296, big > 2147483647);
  let neg = -5;
  neg = neg - 2147483647;
  out.push(neg, neg < -2147483648);
  let mix = 1;
  mix = mix + rows[0].n;
  mix = mix + "x";
  out.push(mix);
  let frac = 3;
  frac = frac + 0.5;
  frac = frac - 1;
  out.push(frac, frac > 2);
  let c = 0, k = rows.length;
  while (c < k) c = c + 2;
  out.push(c, c <= k + 1, c - k);
  let z = 0;
  z = z - 0;
  out.push(Object.is(z, -0), 1 / z);
  let u = rows[0].n;
  u = u - rows[1].n;
  out.push(u, typeof u);
  return out.join(",");
}
