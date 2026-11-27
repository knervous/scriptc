// Runtime keys are interned through a small direct-mapped cache (length and
// three code units). Keys that collide in it, keys built at runtime, keys
// that came from for-in, and computed writes to page objects must all keep
// their own property.
export function keys(n, page) {
  const out = [];
  // Same length, first, middle and last code unit: one cache slot.
  const names = [];
  for (let i = 0; i < 10; i++) names.push("k" + i + "z_" + (n - 2));
  const o = {};
  for (let r = 0; r < 3; r++) for (let i = 0; i < names.length; i++) o[names[i]] = (o[names[i]] ?? 0) + i;
  let sum = "";
  for (let i = 0; i < names.length; i++) sum += o[names[i]] + ",";
  out.push(sum + Object.keys(o).length + " " + Object.keys(o)[3]);
  // Keys from for-in copied to another object, read back by a fresh string.
  const copy = {};
  for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) copy[k] = o[k] * 2;
  out.push(copy["k7z_" + String(n - 2)] + " " + copy[names[9]] + " " + ("k1z_0" in copy) + " " + ("k1z_1" in copy));
  // Index-like and empty keys.
  const p = {};
  p[""] = "empty"; p["10"] = "ten"; p["2"] = "two"; p["x"] = "x";
  out.push(Object.keys(p).join("|") + " " + p[""] + p[String(5 * 2)]);
  // Computed writes to a page object (the global) take the string as is.
  const g = page, tag = "__wgcKey" + n;
  for (let i = 0; i < 3; i++) g[tag + i] = i * 10;
  g[tag + "1"] = g[tag + "1"] + 1;
  out.push(String(g[tag + "0"]) + "," + g[tag + "1"] + "," + g[tag + "2"] + " " + (tag + "2" in g));
  return out.join(" | ");
}
