// Constructor structs with i32 fields under experimentalDynI31: small
// integers store as they stand; other numbers (int32 beyond i31, -0,
// fractions, beyond int32) are stored exactly as boxed numbers would be.
function Counter(start) { this.count = 0; this.flags = 0; this.label = start; }
Counter.prototype.bump = function (by) { this.count += by; this.flags |= by; return this.count; };
function show(x) { return Object.is(x, -0) ? "-0" : String(x); }
export function fields(n) {
  const out = [];
  const top = 1073741821 + n, over = top + 1, negZero = 0 * -n;
  const vals = [n, -n, top, over, -over, -over - 1, 2147483645 + n, -2147483650 + n, 2147483646 + n, negZero, n / 4, 1e21];
  for (let i = 0; i < vals.length; i++) {
    const c = new Counter("c" + i);
    c.count = vals[i]; c.flags = vals[i] | 0;
    out.push(show(c.count) + "/" + show(c.flags) + "/" + (c.count === vals[i]) + "/" + Object.is(c.count, vals[i]) + "/" + typeof c.count);
  }
  const k = new Counter("k");
  for (let i = 0; i < 5; i++) k.bump(top);
  out.push(show(k.count) + " " + show(k.flags) + " " + JSON.stringify(k) + " " + Object.keys(k).join(","));
  const z = new Counter("z"); z.count = negZero; z.count += 0; out.push(show(z.count), show(z.count * -1));
  return out.join(" | ");
}
